// backend/src/controllers/programaciones.controller.js
import { getPool, sql } from '../config/db.js';

/* --------------------------------- Utils --------------------------------- */
function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}

/* ---------------------- GET /api/programaciones/vigente ------------------- */
/**
 * Devuelve el plan “vigente” (si hay alguno con fin futuro), o el último plan,
 * e incluye banderas para que el front sepa si la máquina/lado está ocupada.
 *
 * Query: ?maquina_id=&lado_id=
 * Respuesta:
 *  {
 *    ok: boolean,
 *    programacion_id: number|null,
 *    otcod: string|null,
 *    ultimo_fin: ISOString|null,
 *    ocupado: boolean,
 *    plan: [ { plan_descarga_id, secuencia, fh_inicio, fh_fin }, ... ]
 *  }
 */
export const getPlanVigente = async (req, res) => {
  try {
    const maquina_id = parseInt(req.query.maquina_id, 10);
    const lado_id = parseInt(req.query.lado_id, 10);
    if (!Number.isInteger(maquina_id) || !Number.isInteger(lado_id)) {
      return res.status(400).json({ ok: false, error: 'maquina_id y lado_id requeridos' });
    }

    const pool = await getPool();

    // ¿Hay plan activo (alguna fila del plan con fin en el futuro)?
    const { recordset: act } = await pool.request()
      .input('maquina_id', sql.Int, maquina_id)
      .input('lado_id', sql.Int, lado_id)
      .query(`
        SELECT TOP 1 p.programacion_id, p.otcod, MAX(pd.fh_fin_plan) AS ultimo_fin
        FROM dbo.RET_DGT_PROGRAMACIONES p
        JOIN dbo.RET_DGT_PLAN_DESCARGAS pd ON pd.programacion_id = p.programacion_id
        WHERE p.maquina_id=@maquina_id AND p.lado_id=@lado_id
          AND pd.fh_fin_plan > GETDATE()
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
      // No hay activo: buscar el PRÓXIMO futuro (no el último pasado)
      const now = new Date();
      const { recordset: next } = await pool.request()
        .input('maquina_id', sql.Int, maquina_id)
        .input('lado_id', sql.Int, lado_id)
        .input('now', sql.DateTime, now)
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
/**
 * Crea una programación y genera N filas en el plan.
 * – Verifica que la máquina/lado NO esté ocupada (ninguna fila con fin futuro).
 * – Inserta en plan sólo (fh_inicio_plan, minutos_plan). NO toca fh_fin_plan si es computada.
 * Body: { maquina_id, lado_id, otcod, titulo_id, fecha_hora_inicio, descargas_programadas }
 */
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
    // 1) Validar solapamiento de rangos (Overlap)
    // Necesitamos saber cuándo termina la NUEVA programación para ver si choca con algo.

    // a) Obtener minutos título
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

    const inicio = new Date(fecha_hora_inicio);
    const n = parseInt(descargas_programadas, 10);
    const duracionTotal = n * mins;
    const fin = new Date(inicio.getTime() + duracionTotal * 60000);

    // b) Query de solapamiento
    // Existe alguna descarga tal que: (InicioExistente < FinNuevo) AND (FinExistente > InicioNuevo)
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
      return res.status(409).json({
        ok: false,
        error: `Solapamiento con OT ${o.otcod} (${new Date(o.fh_inicio_plan).toLocaleString()} - ${new Date(o.fh_fin_plan).toLocaleString()})`,
        otcod: o.otcod
      });
    }

    // 2) (El paso de obtener minutos ya se hizo arriba, lo reutilizamos)

    // 3) Inserción con transacción. NO escribir fh_fin_plan si es computada.
    const tx = new sql.Transaction(pool);
    await tx.begin();

    const rsProg = await new sql.Request(tx)
      .input('maquina_id', sql.Int, maquina_id)
      .input('lado_id', sql.Int, lado_id)
      .input('otcod', sql.VarChar(25), otcod)
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
/**
 * Edita el fh_inicio_plan de una fila (id) y recalcula en cascada.
 * Body: { fh_inicio_plan: ISOString }
 * No escribe fh_fin_plan si es computada.
 */
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

    // 1) Actualiza la fila editada (SOLO inicio)
    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .input('ini', sql.DateTime, curIni)
      .query(`
        UPDATE dbo.RET_DGT_PLAN_DESCARGAS
        SET fh_inicio_plan=@ini
        WHERE plan_descarga_id=@id;
      `);

    // 2) Recalcula filas siguientes
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

    // 1) Borrar detalle
    await new sql.Request(tx)
      .input('id', sql.Int, id)
      .query('DELETE FROM dbo.RET_DGT_PLAN_DESCARGAS WHERE programacion_id=@id');

    // 2) Borrar cabecera
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
    // Traer programaciones que tengan al menos una descarga futura (o que sean recientes)
    // Para simplificar: traemos las que tienen fin > NOW
    const now = new Date();
    const { recordset } = await pool.request()
      .input('maquina_id', sql.Int, maquina_id)
      .input('lado_id', sql.Int, lado_id)
      .input('now', sql.DateTime, now)
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
