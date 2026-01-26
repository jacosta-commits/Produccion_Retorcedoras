// backend/src/controllers/programaciones.controller.js
import { getPool, sql } from '../config/db.js';

/* --------------------------------- Utils --------------------------------- */
function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}

// Helper para obtener la hora actual de Perú como "Face Value" en UTC.
function getNowFaceValue() {
  const s = new Date().toLocaleString('en-CA', {
    timeZone: 'America/Lima',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  }).replace(', ', 'T');
  return new Date(s + 'Z');
}

/* ---------------------- GET /api/programaciones/vigente ------------------- */
export const getPlanVigente = async (req, res) => {
  try {
    const maquina_id = parseInt(req.query.maquina_id, 10);
    const lado_id = parseInt(req.query.lado_id, 10);
    if (!Number.isInteger(maquina_id) || !Number.isInteger(lado_id)) {
      return res.status(400).json({ ok: false, error: 'maquina_id y lado_id requeridos' });
    }

    const pool = await getPool();
    const nowFace = getNowFaceValue();

    const { recordset: act } = await pool.request()
      .input('maquina_id', sql.Int, maquina_id)
      .input('lado_id', sql.Int, lado_id)
      .input('now', sql.DateTime, nowFace)
      .query(`
        SELECT TOP 1 p.programacion_id, p.otcod, MAX(pd.fh_fin_plan) AS ultimo_fin
        FROM dbo.RET_DGT_PROGRAMACIONES p
        JOIN dbo.RET_DGT_PLAN_DESCARGAS pd ON pd.programacion_id = p.programacion_id
        WHERE p.maquina_id=@maquina_id AND p.lado_id=@lado_id
          AND pd.fh_fin_plan > @now
        GROUP BY p.programacion_id, p.otcod
        ORDER BY ultimo_fin DESC;
      `);

    let programacion_id = null;
    let otcod = null;
    let ultimo_fin = null;
    let ocupado = false;

    if (act.length) {
      ocupado = true;
      programacion_id = act[0].programacion_id;
      otcod = act[0].otcod;
      ultimo_fin = act[0].ultimo_fin;
    } else {
      const { recordset: next } = await pool.request()
        .input('maquina_id', sql.Int, maquina_id)
        .input('lado_id', sql.Int, lado_id)
        .input('now', sql.DateTime, nowFace)
        .query(`
          SELECT TOP 1 p.programacion_id, p.otcod
          FROM dbo.RET_DGT_PROGRAMACIONES p
          JOIN dbo.RET_DGT_PLAN_DESCARGAS pd ON pd.programacion_id = p.programacion_id
          WHERE p.maquina_id=@maquina_id AND p.lado_id=@lado_id
            AND pd.fh_inicio_plan > @now
          ORDER BY pd.fh_inicio_plan ASC;
        `);

      if (next.length) {
        programacion_id = next[0].programacion_id;
        otcod = next[0].otcod;
      }
    }

    let plan = [];
    if (programacion_id) {
      const { recordset: rows } = await pool.request()
        .input('programacion_id', sql.Int, programacion_id)
        .query(`
          SELECT
            plan_descarga_id,
            secuencia,
            fh_inicio_plan AS fh_inicio,
            fh_fin_plan    AS fh_fin
          FROM dbo.RET_DGT_PLAN_DESCARGAS
          WHERE programacion_id=@programacion_id
          ORDER BY secuencia;
        `);
      plan = rows;
    }

    return res.json({
      ok: !!programacion_id,
      programacion_id: programacion_id ?? null,
      otcod: otcod ?? null,
      ultimo_fin: ultimo_fin ? new Date(ultimo_fin).toISOString() : null,
      ocupado,
      plan
    });
  } catch (e) {
    console.error('getPlanVigente ERROR:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

/* ------------------------ POST /api/programaciones ------------------------ */
export const crearProgramacion = async (req, res) => {
  const {
    maquina_id,
    lado_id,
    otcod,
    titulo_id,
    fecha_hora_inicio,
    descargas_programadas
  } = req.body || {};

  if (!maquina_id || !lado_id || !otcod || !titulo_id || !fecha_hora_inicio || !descargas_programadas) {
    return res.status(400).json({ ok: false, error: 'Faltan campos' });
  }

  const pool = await getPool();

  try {
    // 0) Validar y Normalizar OT (Smart Search)
    // El usuario puede digitar "OT36992" pero en BD es "OT00036992"
    let otInput = otcod.trim().toUpperCase();
    let otPadded = otInput;

    // Si tiene formato OT + numeros, intentamos rellenar con ceros hasta 8 dígitos
    const match = otInput.match(/^OT(\d+)$/);
    if (match) {
      const num = match[1];
      // Asumimos 8 dígitos para el número (basado en OT00036371)
      otPadded = 'OT' + num.padStart(8, '0');
    }

    const { recordset: otMatch } = await pool.request()
      .input('otInput', sql.VarChar(25), otInput)
      .input('otPadded', sql.VarChar(25), otPadded)
      .query(`
        SELECT TOP 1 otcod 
        FROM Medidores_2023.dbo.VIEW_PRD_SCADA005 
        WHERE LTRIM(RTRIM(otcod)) IN (@otInput, @otPadded)
      `);

    if (!otMatch.length) {
      return res.status(400).json({
        ok: false,
        error: `La OT '${otInput}' (o '${otPadded}') no existe en el sistema.`
      });
    }
    const otExacto = otMatch[0].otcod;

    // 1) Validar solapamiento
    const { recordset: tit } = await pool.request()
      .input('titulo_id', sql.Int, titulo_id)
      .query(`SELECT minutos_por_descarga FROM dbo.RET_DGT_TITULOS WHERE titulo_id=@titulo_id;`);
    if (!tit.length) {
      return res.status(400).json({ ok: false, error: 'Título no existe' });
    }
    const mins = parseInt(tit[0].minutos_por_descarga, 10);
    if (!Number.isFinite(mins) || mins <= 0) {
      return res.status(400).json({ ok: false, error: 'Minutos inválidos para el título' });
    }

    const parts = fecha_hora_inicio.split('T');
    const ymd = parts[0].split('-');
    const hm = parts[1].split(':');

    const inicio = new Date(Date.UTC(
      parseInt(ymd[0], 10),
      parseInt(ymd[1], 10) - 1,
      parseInt(ymd[2], 10),
      parseInt(hm[0], 10),
      parseInt(hm[1], 10)
    ));

    const n = parseInt(descargas_programadas, 10);
    const duracionTotal = n * mins;
    const fin = new Date(inicio.getTime() + duracionTotal * 60000);

    const { recordset: overlap } = await pool.request()
      .input('maquina_id', sql.Int, maquina_id)
      .input('lado_id', sql.Int, lado_id)
      .input('ini', sql.DateTime, inicio)
      .input('fin', sql.DateTime, fin)
      .query(`
        SELECT TOP 1 p.otcod, pd.fh_inicio_plan, pd.fh_fin_plan
        FROM dbo.RET_DGT_PLAN_DESCARGAS pd
        JOIN dbo.RET_DGT_PROGRAMACIONES p ON p.programacion_id = pd.programacion_id
        WHERE p.maquina_id = @maquina_id 
          AND p.lado_id = @lado_id
          AND pd.fh_inicio_plan < @fin
          AND pd.fh_fin_plan > @ini
      `);

    if (overlap.length) {
      const o = overlap[0];
      const iniStr = new Date(o.fh_inicio_plan).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
      const finStr = new Date(o.fh_fin_plan).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

      return res.status(409).json({
        ok: false,
        error: `⚠️ Cruce de horarios: Ya existe la OT ${o.otcod} de ${iniStr} a ${finStr}.`,
        otcod: o.otcod
      });
    }

    // 3) Inserción con transacción
    const tx = new sql.Transaction(pool);
    await tx.begin();

    const rsProg = await new sql.Request(tx)
      .input('maquina_id', sql.Int, maquina_id)
      .input('lado_id', sql.Int, lado_id)
      .input('otcod', sql.VarChar(25), otExacto)
      .input('titulo_id', sql.Int, titulo_id)
      .input('inicio', sql.DateTime, inicio)
      .input('desc', sql.Int, n)
      .query(`
        SET NOCOUNT ON;
        INSERT INTO dbo.RET_DGT_PROGRAMACIONES
          (maquina_id, lado_id, otcod, titulo_id, fecha_hora_inicio, descargas_programadas)
        VALUES (@maquina_id, @lado_id, @otcod, @titulo_id, @inicio, @desc);
        SELECT CAST(SCOPE_IDENTITY() AS INT) AS programacion_id;
      `);

    const programacion_id = rsProg.recordset[0].programacion_id;

    let curIni = new Date(inicio);
    for (let i = 1; i <= n; i++) {
      await new sql.Request(tx)
        .input('programacion_id', sql.Int, programacion_id)
        .input('secuencia', sql.Int, i)
        .input('fh_ini', sql.DateTime, curIni)
        .input('mins', sql.Int, mins)
        .query(`
          INSERT INTO dbo.RET_DGT_PLAN_DESCARGAS
            (programacion_id, secuencia, fh_inicio_plan, minutos_plan)
          VALUES (@programacion_id, @secuencia, @fh_ini, @mins);
        `);
      curIni = addMinutes(curIni, mins);
    }

    await tx.commit();
    return res.status(201).json({ ok: true, programacion_id });

  } catch (e) {
    console.error('crearProgramacion ERROR:', e);
    return res.status(500).json({ ok: false, error: e.message });
  }
};

/* ------------------- PUT /api/programaciones/plan/:id --------------------- */
export const editarPlanFila = async (req, res) => {
  const id = parseInt(req.params.plan_descarga_id, 10);
  const { fh_inicio_plan } = req.body || {};
  if (!Number.isInteger(id) || !fh_inicio_plan) {
    return res.status(400).json({ ok: false, error: 'Datos inválidos' });
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin();

    const { recordset: info } = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query(`
        SELECT pd.programacion_id, pd.secuencia, t.minutos_por_descarga
        FROM dbo.RET_DGT_PLAN_DESCARGAS pd
        JOIN dbo.RET_DGT_PROGRAMACIONES p ON p.programacion_id = pd.programacion_id
        JOIN dbo.RET_DGT_TITULOS t        ON t.titulo_id        = p.titulo_id
        WHERE pd.plan_descarga_id = @id;
      `);
    if (!info.length) {
      await tx.rollback();
      return res.status(404).json({ ok: false, error: 'Fila de plan no encontrada' });
    }

    const { programacion_id, secuencia, minutos_por_descarga } = info[0];
    const mins = parseInt(minutos_por_descarga, 10);
    let curIni = new Date(fh_inicio_plan);

    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('ini', sql.DateTime, curIni)
      .query(`
        UPDATE dbo.RET_DGT_PLAN_DESCARGAS
        SET fh_inicio_plan=@ini
        WHERE plan_descarga_id=@id;
      `);

    const { recordset: siguientes } = await new sql.Request(tx)
      .input('programacion_id', sql.Int, programacion_id)
      .input('secuencia', sql.Int, secuencia)
      .query(`
        SELECT plan_descarga_id
        FROM dbo.RET_DGT_PLAN_DESCARGAS
        WHERE programacion_id=@programacion_id AND secuencia > @secuencia
        ORDER BY secuencia;
      `);

    for (const row of siguientes) {
      curIni = addMinutes(curIni, mins);
      await new sql.Request(tx)
        .input('id', sql.Int, row.plan_descarga_id)
        .input('ini', sql.DateTime, curIni)
        .query(`
          UPDATE dbo.RET_DGT_PLAN_DESCARGAS
          SET fh_inicio_plan=@ini
          WHERE plan_descarga_id=@id;
        `);
    }

    await tx.commit();
    return res.json({ ok: true });

  } catch (e) {
    console.error('editarPlanFila ERROR:', e);
    try { await tx.rollback(); } catch { }
  }
};

/* -------------------- DELETE /api/programaciones/:id ---------------------- */
export const deleteProgramacion = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });

  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  try {
    await tx.begin();

    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query('DELETE FROM dbo.RET_DGT_PLAN_DESCARGAS WHERE programacion_id=@id');

    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query('DELETE FROM dbo.RET_DGT_PROGRAMACIONES WHERE programacion_id=@id');

    await tx.commit();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    try { await tx.rollback(); } catch { }
    res.status(500).json({ error: e.message });
  }
};

/* ---------------- GET /api/programaciones/activas ---------------- */
export const getProgramacionesActivas = async (req, res) => {
  const maquina_id = parseInt(req.query.maquina_id, 10);
  const lado_id = parseInt(req.query.lado_id, 10);
  if (!maquina_id || !lado_id) return res.status(400).json({ error: 'Faltan params' });

  try {
    const pool = await getPool();
    const nowFace = getNowFaceValue();
    const { recordset } = await pool.request()
      .input('maquina_id', sql.Int, maquina_id)
      .input('lado_id', sql.Int, lado_id)
      .input('now', sql.DateTime, nowFace)
      .query(`
        SELECT 
          p.programacion_id,
          p.otcod,
          t.nombre AS titulo,
          MIN(pd.fh_inicio_plan) AS inicio,
          MAX(pd.fh_fin_plan) AS fin
        FROM dbo.RET_DGT_PROGRAMACIONES p
        JOIN dbo.RET_DGT_PLAN_DESCARGAS pd ON pd.programacion_id = p.programacion_id
        JOIN dbo.RET_DGT_TITULOS t ON t.titulo_id = p.titulo_id
        WHERE p.maquina_id = @maquina_id AND p.lado_id = @lado_id
        GROUP BY p.programacion_id, p.otcod, t.nombre
        HAVING MAX(pd.fh_fin_plan) > @now
        ORDER BY MIN(pd.fh_inicio_plan) ASC
      `);

    res.json(recordset);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
