import { getPool, sql } from '../config/db.js';

export const listTitulos = async (_req, res) => {
  const pool = await getPool();
  const rs = await pool.request().query(`
    SELECT titulo_id, nombre, minutos_por_descarga, activo
    FROM dbo.RET_DGT_TITULOS ORDER BY nombre
  `);
  res.json(rs.recordset);
};

export const createTitulo = async (req, res) => {
  const { nombre, minutos_por_descarga } = req.body;
  if (!nombre || !minutos_por_descarga) return res.status(400).json({ error: 'Faltan datos' });
  const pool = await getPool();
  await pool.request()
    .input('nombre', sql.VarChar, nombre)
    .input('min', sql.Int, minutos_por_descarga)
    .query(`INSERT INTO dbo.RET_DGT_TITULOS(nombre, minutos_por_descarga, activo) VALUES(@nombre, @min, 1)`);
  res.status(201).json({ ok: true });
};
