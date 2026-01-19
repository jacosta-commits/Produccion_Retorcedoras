// backend/src/controllers/operario.controller.js
import { getPool, sql } from '../config/db.js';

export const resumenOperario = async (req, res) => {
  try {
    const maquina_id = parseInt(req.query.maquina_id, 10);
    const lado_id    = parseInt(req.query.lado_id, 10);

    if (!Number.isInteger(maquina_id) || !Number.isInteger(lado_id)) {
      return res.status(400).json({ ok:false, error:'maquina_id y lado_id requeridos' });
    }

    const pool = await getPool();

    // 1) Tomar la programación más reciente de esa máquina/lado
    const { recordset: progs } = await pool.request()
      .input('maquina_id', sql.Int, maquina_id)
      .input('lado_id', sql.Int, lado_id)
      .query(`
        SELECT TOP 1
          p.programacion_id,
          p.otcod,
          p.titulo_id,
          t.nombre              AS titulo,
          t.minutos_por_descarga,
          m.nombre              AS maquina_nombre,
          m.codigo              AS maquina_codigo
        FROM dbo.RET_DGT_PROGRAMACIONES p
        JOIN dbo.RET_DGT_TITULOS  t ON t.titulo_id  = p.titulo_id
        JOIN dbo.RET_DGT_MAQUINAS m ON m.maquina_id = p.maquina_id
        WHERE p.maquina_id = @maquina_id
          AND p.lado_id    = @lado_id
        ORDER BY p.programacion_id DESC;
      `);

    if (!progs.length) {
      return res.json({ ok:false, msg:'Sin programaciones' });
    }

    const prog = progs[0];

    // 2) Traer el plan de ESA programación (alias de fechas)
    const { recordset: plan } = await pool.request()
      .input('programacion_id', sql.Int, prog.programacion_id)
      .query(`
        SELECT
          plan_descarga_id,
          secuencia,
          CAST(fh_inicio_plan AS datetime) AS fh_inicio,
          CAST(fh_fin_plan    AS datetime) AS fh_fin
        FROM dbo.RET_DGT_PLAN_DESCARGAS
        WHERE programacion_id = @programacion_id
        ORDER BY secuencia;
      `);

    // 3) Contadores
    const { recordset: cont } = await pool.request()
      .input('programacion_id', sql.Int, prog.programacion_id)
      .query(`
        SELECT
          (SELECT COUNT(*) FROM dbo.RET_DGT_PLAN_DESCARGAS   WHERE programacion_id=@programacion_id) AS prog,
          (SELECT COUNT(*) FROM dbo.RET_DGT_DESCARGAS_REALES WHERE programacion_id=@programacion_id) AS real;
      `);

    // 4) ÚNICA respuesta
    return res.json({
      ok: true,
      maquina: { nombre: prog.maquina_nombre, codigo: prog.maquina_codigo },
      titulo : { titulo_id: prog.titulo_id, nombre: prog.titulo, minutos_por_descarga: prog.minutos_por_descarga },
      ot     : { otcod: prog.otcod },
      contadores: cont[0] || { prog: plan.length, real: 0 },
      plan
    });

  } catch (e) {
    console.error('resumenOperario ERROR:', e);
    return res.status(500).json({ ok:false, error: e.message });
  }
};
