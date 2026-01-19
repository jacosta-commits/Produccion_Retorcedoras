// backend/src/services/plan.service.js
import { getPool, sql } from '../config/db.js';

/** Util: suma minutos a un Date y retorna un nuevo Date */
const addMinutes = (d, m) => new Date(d.getTime() + m * 60000);

/** Cache simple de columnas calculadas */
const computedCache = new Map();
/** key = 'schema.table.col' -> true|false */
async function isComputedColumn(tableFullName /* 'dbo.RET_DGT_PLAN_DESCARGAS' */, colName) {
  const key = `${tableFullName}.${colName}`.toLowerCase();
  if (computedCache.has(key)) return computedCache.get(key);

  const pool = await getPool();
  const rs = await pool.request()
    .input('tbl', sql.NVarChar(256), tableFullName)
    .input('col', sql.NVarChar(256), colName)
    .query(`
      SELECT c.is_computed
      FROM sys.columns c
      JOIN sys.objects o ON o.object_id = c.object_id
      WHERE o.object_id = OBJECT_ID(@tbl) AND c.name = @col;
    `);

  const flag = rs.recordset.length ? !!rs.recordset[0].is_computed : false;
  computedCache.set(key, flag);
  return flag;
}

/**
 * Genera el plan (secuencias 1..N) para una programación.
 * - Lee inicio, N y minutos por descarga (desde RET_DGT_TITULOS).
 * - Borra cualquier plan previo de esa programación.
 * - Inserta filas con INICIO y (si no es calculada) FIN.
 */
export const generarPlan = async (programacion_id) => {
  const pool = await getPool();

  // 1) Traer datos base
  const rs = await pool.request()
    .input('id', sql.Int, programacion_id)
    .query(`
      SELECT p.programacion_id,
             p.fecha_hora_inicio,
             p.descargas_programadas,
             t.minutos_por_descarga
      FROM dbo.RET_DGT_PROGRAMACIONES p
      JOIN dbo.RET_DGT_TITULOS t ON t.titulo_id = p.titulo_id
      WHERE p.programacion_id = @id;
    `);

  if (!rs.recordset.length) throw new Error('Programación no encontrada');

  const row = rs.recordset[0];
  const inicioBase = new Date(row.fecha_hora_inicio);
  const N = Number(row.descargas_programadas);
  const minDefecto = Number(row.minutos_por_descarga);

  const fhFinEsCalculada = await isComputedColumn('dbo.RET_DGT_PLAN_DESCARGAS', 'fh_fin_plan');

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    // 2) Limpiar plan previo
    await new sql.Request(tx)
      .input('id', sql.Int, programacion_id)
      .query(`DELETE FROM dbo.RET_DGT_PLAN_DESCARGAS WHERE programacion_id = @id;`);

    // 3) Insertar N filas
    let start = new Date(inicioBase);
    for (let i = 1; i <= N; i++) {
      const fin = addMinutes(start, minDefecto);

      const req = new sql.Request(tx)
        .input('programacion_id', sql.Int, programacion_id)
        .input('secuencia', sql.Int, i)
        .input('inicio', sql.DateTime, start)
        .input('min', sql.Int, minDefecto);

      if (fhFinEsCalculada) {
        // no tocar fh_fin_plan
        await req.query(`
          INSERT INTO dbo.RET_DGT_PLAN_DESCARGAS
            (programacion_id, secuencia, fh_inicio_plan, minutos_plan)
          VALUES
            (@programacion_id, @secuencia, @inicio, @min);
        `);
      } else {
        // insertar fh_fin_plan explícitamente
        await req
          .input('fin', sql.DateTime, fin)
          .query(`
            INSERT INTO dbo.RET_DGT_PLAN_DESCARGAS
              (programacion_id, secuencia, fh_inicio_plan, minutos_plan, fh_fin_plan)
            VALUES
              (@programacion_id, @secuencia, @inicio, @min, @fin);
          `);
      }

      start = fin; // siguiente comienza donde terminó éste
    }

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
};

/**
 * Recalcula en cadena desde una secuencia:
 * - Vuelve a fijar INICIO/FIN de esa fila y las siguientes.
 * - Si fh_fin_plan es calculada, solo actualiza INICIO (y deja que SQL calcule FIN).
 */
export const recalcularDesde = async (programacion_id, secuenciaDesde) => {
  const pool = await getPool();
  const fhFinEsCalculada = await isComputedColumn('dbo.RET_DGT_PLAN_DESCARGAS', 'fh_fin_plan');

  // 1) Leer plan actual
  const rs = await pool.request()
    .input('id', sql.Int, programacion_id)
    .query(`
      SELECT plan_descarga_id, programacion_id, secuencia,
             fh_inicio_plan, minutos_plan, fh_fin_plan
      FROM dbo.RET_DGT_PLAN_DESCARGAS
      WHERE programacion_id = @id
      ORDER BY secuencia;
    `);

  const plan = rs.recordset;
  if (!plan.length) return;

  const idx = plan.findIndex(p => Number(p.secuencia) >= Number(secuenciaDesde));
  if (idx < 0) return;

  const tx = new sql.Transaction(pool);
  await tx.begin();

  try {
    // 2) Recalcular encadenado
    let prevEnd = null;

    for (let j = 0; j < plan.length; j++) {
      const fila = plan[j];
      const minutos = Number(fila.minutos_plan || 0);

      if (j < idx) {
        // calcular fin en memoria (no confiar en valor guardado si es calculado)
        prevEnd = addMinutes(new Date(fila.fh_inicio_plan), minutos);
        continue;
      }

      let inicio;
      if (j === idx) {
        // respetar el inicio que quedó en BD tras la edición
        inicio = new Date(fila.fh_inicio_plan);
      } else {
        inicio = new Date(prevEnd);
      }

      const fin = addMinutes(inicio, minutos);

      const req = new sql.Request(tx)
        .input('id', sql.Int, fila.plan_descarga_id)
        .input('inicio', sql.DateTime, inicio);

      if (fhFinEsCalculada) {
        await req.query(`
          UPDATE dbo.RET_DGT_PLAN_DESCARGAS
             SET fh_inicio_plan = @inicio
           WHERE plan_descarga_id = @id;
        `);
      } else {
        await req
          .input('fin', sql.DateTime, fin)
          .query(`
            UPDATE dbo.RET_DGT_PLAN_DESCARGAS
               SET fh_inicio_plan = @inicio,
                   fh_fin_plan    = @fin
             WHERE plan_descarga_id = @id;
          `);
      }

      prevEnd = fin;
    }

    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
};
