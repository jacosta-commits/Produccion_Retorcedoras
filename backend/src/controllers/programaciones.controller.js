// backend/src/controllers/programaciones.controller.js
import { getPool, sql } from '../config/db.js';
import { randomUUID } from 'node:crypto';

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

  const vinculo_id = randomUUID();
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

    // Parsear fecha "Face Value" (d/m/Y H:i) a UTC Timestamp
    // El frontend envía "26/01/2026 14:30"
    let inicio;
    if (fecha_hora_inicio.includes('/')) {
      const parts = fecha_hora_inicio.split(' '); // ["26/01/2026", "14:30"]
      const dmy = parts[0].split('/'); // ["26", "01", "2026"]
      const hm = parts[1].split(':'); // ["14", "30"]

      inicio = new Date(Date.UTC(
        parseInt(dmy[2], 10),
        parseInt(dmy[1], 10) - 1,
        parseInt(dmy[0], 10),
        parseInt(hm[0], 10),
        parseInt(hm[1], 10)
      ));
    } else if (fecha_hora_inicio.includes('T')) {
      // Fallback por si acaso (ISO)
      const parts = fecha_hora_inicio.split('T');
      const ymd = parts[0].split('-');
      const hm = parts[1].split(':');
      inicio = new Date(Date.UTC(
        parseInt(ymd[0], 10),
        parseInt(ymd[1], 10) - 1,
        parseInt(ymd[2], 10),
        parseInt(hm[0], 10),
        parseInt(hm[1], 10)
      ));
    } else {
      throw new Error('Formato de fecha inválido. Use d/m/Y H:i');
    }

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
      .input('vinculo', sql.UniqueIdentifier, vinculo_id)
      .query(`
        SET NOCOUNT ON;
        INSERT INTO dbo.RET_DGT_PROGRAMACIONES
          (maquina_id, lado_id, otcod, titulo_id, fecha_hora_inicio, descargas_programadas, vinculo_id)
        VALUES (@maquina_id, @lado_id, @otcod, @titulo_id, @inicio, @desc, @vinculo);
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

    // AUTO-PROGRAM LADO B if Lado A is programmed
    // Assuming Lado A is ID 1 and Lado B is ID 2.
    if (lado_id === 1) {
      const lado_B_id = 2; // Fixed ID for Lado B
      const inicioLadoB = new Date(inicio.getTime() + mins * 60000); // 1 discharge shift
      const finLadoB = new Date(inicioLadoB.getTime() + duracionTotal * 60000);

      // Validate overlap for Lado B
      const { recordset: overlapB } = await new sql.Request(tx)
        .input('maquina_id', sql.Int, maquina_id)
        .input('lado_id', sql.Int, lado_B_id)
        .input('ini', sql.DateTime, inicioLadoB)
        .input('fin', sql.DateTime, finLadoB)
        .query(`
          SELECT TOP 1 p.otcod, pd.fh_inicio_plan, pd.fh_fin_plan
          FROM dbo.RET_DGT_PLAN_DESCARGAS pd
          JOIN dbo.RET_DGT_PROGRAMACIONES p ON p.programacion_id = pd.programacion_id
          WHERE p.maquina_id = @maquina_id 
            AND p.lado_id = @lado_id
            AND pd.fh_inicio_plan < @fin
            AND pd.fh_fin_plan > @ini
        `);

      if (overlapB.length) {
        const oB = overlapB[0];
        const iniStr = new Date(oB.fh_inicio_plan).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
        const finStr = new Date(oB.fh_fin_plan).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });

        throw new Error(`⚠️ Cruce de horarios en Lado B: Ya existe la OT ${oB.otcod} de ${iniStr} a ${finStr}. No se puede auto-programar.`);
      }

      // Insert Lado B Base Entry
      const rsProgB = await new sql.Request(tx)
        .input('maquina_id', sql.Int, maquina_id)
        .input('lado_id', sql.Int, lado_B_id)
        .input('otcod', sql.VarChar(25), otExacto)
        .input('titulo_id', sql.Int, titulo_id)
        .input('inicio', sql.DateTime, inicioLadoB)
        .input('desc', sql.Int, n)
        .input('vinculo', sql.UniqueIdentifier, vinculo_id)
        .query(`
          SET NOCOUNT ON;
          INSERT INTO dbo.RET_DGT_PROGRAMACIONES
            (maquina_id, lado_id, otcod, titulo_id, fecha_hora_inicio, descargas_programadas, vinculo_id)
          VALUES (@maquina_id, @lado_id, @otcod, @titulo_id, @inicio, @desc, @vinculo);
          SELECT CAST(SCOPE_IDENTITY() AS INT) AS programacion_id;
        `);

      const programacion_id_B = rsProgB.recordset[0].programacion_id;

      // Insert Lado B Discharges
      let curIniB = new Date(inicioLadoB);
      for (let i = 1; i <= n; i++) {
        await new sql.Request(tx)
          .input('programacion_id', sql.Int, programacion_id_B)
          .input('secuencia', sql.Int, i)
          .input('fh_ini', sql.DateTime, curIniB)
          .input('mins', sql.Int, mins)
          .query(`
            INSERT INTO dbo.RET_DGT_PLAN_DESCARGAS
              (programacion_id, secuencia, fh_inicio_plan, minutos_plan)
            VALUES (@programacion_id, @secuencia, @fh_ini, @mins);
          `);
        curIniB = addMinutes(curIniB, mins);
      }
    }

    await tx.commit();
    return res.status(201).json({ ok: true, programacion_id, auto_programmed_b: lado_id === 1 });

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
        SELECT pd.programacion_id, pd.secuencia, t.minutos_por_descarga, p.vinculo_id, p.lado_id
        FROM dbo.RET_DGT_PLAN_DESCARGAS pd
        JOIN dbo.RET_DGT_PROGRAMACIONES p ON p.programacion_id = pd.programacion_id
        JOIN dbo.RET_DGT_TITULOS t        ON t.titulo_id        = p.titulo_id
        WHERE pd.plan_descarga_id = @id;
      `);
    if (!info.length) {
      await tx.rollback();
      return res.status(404).json({ ok: false, error: 'Fila de plan no encontrada' });
    }

    const { programacion_id, secuencia, minutos_por_descarga, vinculo_id, lado_id } = info[0];
    const mins = parseInt(minutos_por_descarga, 10);

    // Parsear fecha inicio recibida
    let curIni;
    if (fh_inicio_plan.includes('/')) {
      const parts = fh_inicio_plan.split(' ');
      const dmy = parts[0].split('/');
      const hm = parts[1].split(':');
      curIni = new Date(Date.UTC(
        parseInt(dmy[2], 10), parseInt(dmy[1], 10) - 1, parseInt(dmy[0], 10),
        parseInt(hm[0], 10), parseInt(hm[1], 10)
      ));
    } else if (fh_inicio_plan.includes('T')) {
      const parts = fh_inicio_plan.split('T');
      const ymd = parts[0].split('-');
      const hm = parts[1].split(':');
      curIni = new Date(Date.UTC(
        parseInt(ymd[0], 10), parseInt(ymd[1], 10) - 1, parseInt(ymd[2], 10),
        parseInt(hm[0], 10), parseInt(hm[1], 10)
      ));
    } else {
      curIni = new Date(fh_inicio_plan);
    }

    const offsetMillis = curIni.getTime() - new Date().getTime(); // No es necesario, solo necesitamos curIni

    // 1. Actualizar la fila actual y las siguientes en la MISMA programación
    let loopIni = new Date(curIni);
    const { recordset: filasAActualizar } = await new sql.Request(tx)
      .input('programacion_id', sql.Int, programacion_id)
      .input('secuencia', sql.Int, secuencia)
      .query(`
        SELECT plan_descarga_id, secuencia
        FROM dbo.RET_DGT_PLAN_DESCARGAS
        WHERE programacion_id=@programacion_id AND secuencia >= @secuencia
        ORDER BY secuencia;
      `);

    for (const row of filasAActualizar) {
      await new sql.Request(tx)
        .input('id', sql.Int, row.plan_descarga_id)
        .input('ini', sql.DateTime, loopIni)
        .query(`UPDATE dbo.RET_DGT_PLAN_DESCARGAS SET fh_inicio_plan=@ini WHERE plan_descarga_id=@id;`);
      loopIni = addMinutes(loopIni, mins);
    }

    // 2. Si tiene VINCULO, actualizar el lado gemelo
    if (vinculo_id) {
      const { recordset: gemelo } = await new sql.Request(tx)
        .input('vinculo', sql.UniqueIdentifier, vinculo_id)
        .input('id', sql.Int, programacion_id)
        .query(`SELECT programacion_id FROM dbo.RET_DGT_PROGRAMACIONES WHERE vinculo_id=@vinculo AND programacion_id != @id`);

      if (gemelo.length) {
        const gemelo_id = gemelo[0].programacion_id;
        // El desfase es +mins si soy A (1) -> B (2), o -mins si soy B -> A
        const offset = (lado_id === 1) ? mins : -mins;
        let gemeloIni = addMinutes(new Date(curIni), offset);

        const { recordset: filasGemelo } = await new sql.Request(tx)
          .input('programacion_id', sql.Int, gemelo_id)
          .input('secuencia', sql.Int, secuencia)
          .query(`
            SELECT plan_descarga_id, secuencia
            FROM dbo.RET_DGT_PLAN_DESCARGAS
            WHERE programacion_id=@programacion_id AND secuencia >= @secuencia
            ORDER BY secuencia;
          `);

        for (const row of filasGemelo) {
          await new sql.Request(tx)
            .input('id', sql.Int, row.plan_descarga_id)
            .input('ini', sql.DateTime, gemeloIni)
            .query(`UPDATE dbo.RET_DGT_PLAN_DESCARGAS SET fh_inicio_plan=@ini WHERE plan_descarga_id=@id;`);
          gemeloIni = addMinutes(gemeloIni, mins);
        }
      }
    }

    await tx.commit();
    return res.json({ ok: true });

  } catch (e) {
    console.error('editarPlanFila ERROR:', e);
    try { await tx.rollback(); } catch { }
    return res.status(500).json({ ok: false, error: e.message });
  }
};

/* ----------- PUT /api/programaciones/:id/plan (edición general) ----------- */
export const editarPlan = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { fh_inicio_plan, descargas } = req.body || {};
  if (!Number.isInteger(id)) {
    return res.status(400).json({ ok: false, error: 'ID inválido' });
  }
  if (!fh_inicio_plan && !descargas) {
    return res.status(400).json({ ok: false, error: 'Nada que actualizar' });
  }

  const pool = await getPool();
  const tx = new sql.Transaction(pool);

  try {
    await tx.begin();

    // 1. Obtener info de la programación a editar y sus vínculos
    const { recordset: info } = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query(`
        SELECT p.programacion_id, p.descargas_programadas, p.fecha_hora_inicio,
               t.minutos_por_descarga, p.vinculo_id, p.lado_id
        FROM dbo.RET_DGT_PROGRAMACIONES p
        JOIN dbo.RET_DGT_TITULOS t ON t.titulo_id = p.titulo_id
        WHERE p.programacion_id = @id;
      `);
    if (!info.length) {
      await tx.rollback();
      return res.status(404).json({ ok: false, error: 'Programación no encontrada' });
    }

    const prog = info[0];
    const mins = parseInt(prog.minutos_por_descarga, 10);
    const newDescargas = descargas ? parseInt(descargas, 10) : prog.descargas_programadas;

    // Parsear nueva fecha de inicio
    let newInicio;
    if (fh_inicio_plan) {
      if (fh_inicio_plan.includes('T')) {
        const parts = fh_inicio_plan.split('T');
        const ymd = parts[0].split('-');
        const hm = parts[1].split(':');
        newInicio = new Date(Date.UTC(
          parseInt(ymd[0], 10), parseInt(ymd[1], 10) - 1, parseInt(ymd[2], 10),
          parseInt(hm[0], 10), parseInt(hm[1], 10)
        ));
      } else {
        newInicio = new Date(fh_inicio_plan);
      }
    } else {
      newInicio = new Date(prog.fecha_hora_inicio);
    }

    const idsParaActualizar = [{ id, inicio: newInicio }];

    // 2. Si tiene VINCULO, añadir el gemelo a la lista de actualización
    if (prog.vinculo_id) {
      const { recordset: gemelo } = await new sql.Request(tx)
        .input('vinculo', sql.UniqueIdentifier, prog.vinculo_id)
        .input('id', sql.Int, id)
        .query(`SELECT programacion_id FROM dbo.RET_DGT_PROGRAMACIONES WHERE vinculo_id=@vinculo AND programacion_id != @id`);

      if (gemelo.length) {
        const gemelo_id = gemelo[0].programacion_id;
        const offset = (prog.lado_id === 1) ? mins : -mins;
        const inicioGemelo = addMinutes(new Date(newInicio), offset);
        idsParaActualizar.push({ id: gemelo_id, inicio: inicioGemelo });
      }
    }

    // 3. Ejecutar la actualización para cada ID (el actual y su gemelo si existe)
    for (const item of idsParaActualizar) {
      // Borrar plan actual
      await new sql.Request(tx)
        .input('id', sql.Int, item.id)
        .query('DELETE FROM dbo.RET_DGT_PLAN_DESCARGAS WHERE programacion_id=@id');

      // Recrear plan
      let curIni = new Date(item.inicio);
      for (let i = 1; i <= newDescargas; i++) {
        await new sql.Request(tx)
          .input('programacion_id', sql.Int, item.id)
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

      // Actualizar programación padre
      await new sql.Request(tx)
        .input('id', sql.Int, item.id)
        .input('descargas', sql.Int, newDescargas)
        .input('inicio', sql.DateTime, item.inicio)
        .query(`
          UPDATE dbo.RET_DGT_PROGRAMACIONES
          SET descargas_programadas=@descargas, fecha_hora_inicio=@inicio
          WHERE programacion_id=@id;
        `);
    }

    await tx.commit();
    return res.json({ ok: true });

  } catch (e) {
    console.error('editarPlan ERROR:', e);
    try { await tx.rollback(); } catch { }
    return res.status(500).json({ ok: false, error: e.message });
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

    // 1. Obtener info de la programación a borrar para buscar posibles vínculos
    const { recordset: info } = await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query(`
        SELECT p.vinculo_id, p.maquina_id, p.lado_id, p.otcod, p.fecha_hora_inicio, t.minutos_por_descarga
        FROM dbo.RET_DGT_PROGRAMACIONES p
        JOIN dbo.RET_DGT_TITULOS t ON t.titulo_id = p.titulo_id
        WHERE p.programacion_id = @id
      `);

    if (!info.length) {
      await tx.rollback();
      return res.status(404).json({ error: 'Programación no encontrada' });
    }

    const { vinculo_id, maquina_id, lado_id, otcod, fecha_hora_inicio, minutos_por_descarga } = info[0];
    const idsABorrar = [id];

    // 2. Identificar programaciones vinculadas
    if (vinculo_id) {
      const { recordset: vinculados } = await new sql.Request(tx)
        .input('vinculo', sql.UniqueIdentifier, vinculo_id)
        .input('id', sql.Int, id)
        .query('SELECT programacion_id FROM dbo.RET_DGT_PROGRAMACIONES WHERE vinculo_id=@vinculo AND programacion_id != @id');
      vinculados.forEach(v => idsABorrar.push(v.programacion_id));
    } else {
      // Heurística para registros antiguos sin vinculo_id
      // Si borro A, busco B que empiece exacto 1 descarga después con misma OT y máquina
      // Si borro B, busco A que empiece exacto 1 descarga antes
      const offset = (lado_id === 1) ? minutos_por_descarga : -minutos_por_descarga;
      const targetLado = (lado_id === 1) ? 2 : 1;
      const targetInicio = addMinutes(new Date(fecha_hora_inicio), offset);

      const { recordset: twin } = await new sql.Request(tx)
        .input('m', sql.Int, maquina_id)
        .input('l', sql.Int, targetLado)
        .input('ot', sql.VarChar(25), otcod)
        .input('ini', sql.DateTime, targetInicio)
        .query(`
          SELECT programacion_id 
          FROM dbo.RET_DGT_PROGRAMACIONES 
          WHERE maquina_id=@m AND lado_id=@l AND otcod=@ot AND fecha_hora_inicio=@ini
        `);
      if (twin.length) idsABorrar.push(twin[0].programacion_id);
    }

    // 3. Ejecutar borrado para todos los IDs identificados
    for (const progId of idsABorrar) {
      await new sql.Request(tx)
        .input('pid', sql.Int, progId)
        .query('DELETE FROM dbo.RET_DGT_PLAN_DESCARGAS WHERE programacion_id=@pid');

      await new sql.Request(tx)
        .input('pid', sql.Int, progId)
        .query('DELETE FROM dbo.RET_DGT_PROGRAMACIONES WHERE programacion_id=@pid');
    }

    await tx.commit();
    res.json({ ok: true, deleted_count: idsABorrar.length });
  } catch (e) {
    console.error('deleteProgramacion ERROR:', e);
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

/* ---------------- GET /api/programaciones/:id ---------------- */
export const getProgramacionById = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await getPool();

    // 1. Obtener cabecera
    const { recordset: head } = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT 
          p.programacion_id,
          p.otcod,
          p.descargas_programadas,
          t.nombre AS titulo,
          t.minutos_por_descarga,
          t.color
        FROM dbo.RET_DGT_PROGRAMACIONES p
        JOIN dbo.RET_DGT_TITULOS t ON t.titulo_id = p.titulo_id
        WHERE p.programacion_id = @id
      `);

    if (!head.length) return res.status(404).json({ error: 'Programación no encontrada' });
    const prog = head[0];

    // 2. Obtener plan
    const { recordset: plan } = await pool.request()
      .input('id', sql.Int, id)
      .query(`
        SELECT
          plan_descarga_id,
          secuencia,
          fh_inicio_plan AS fh_inicio,
          fh_fin_plan    AS fh_fin
        FROM dbo.RET_DGT_PLAN_DESCARGAS
        WHERE programacion_id = @id
        ORDER BY secuencia
      `);

    res.json({
      ok: true,
      programacion_id: prog.programacion_id,
      otcod: prog.otcod,
      descargas_programadas: prog.descargas_programadas,
      titulo: prog.titulo,
      minutos_por_descarga: prog.minutos_por_descarga,
      color: prog.color,
      plan
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
};
