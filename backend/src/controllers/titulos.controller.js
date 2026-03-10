import { getPool, sql } from '../config/db.js';

export const listTitulos = async (_req, res) => {
  const pool = await getPool();
  const rs = await pool.request().query(`
    SELECT titulo_id, nombre, minutos_por_descarga, activo, color
    FROM dbo.RET_DGT_TITULOS 
    WHERE activo = 1
    ORDER BY nombre
  `);
  res.json(rs.recordset);
};

export const createTitulo = async (req, res) => {
  const { nombre, minutos_por_descarga, color } = req.body;
  if (!nombre || !minutos_por_descarga) return res.status(400).json({ error: 'Faltan datos' });
  const pool = await getPool();
  await pool.request()
    .input('nombre', sql.VarChar, nombre)
    .input('min', sql.Int, minutos_por_descarga)
    .input('color', sql.VarChar, color || '#FFFFFF')
    .query(`INSERT INTO dbo.RET_DGT_TITULOS(nombre, minutos_por_descarga, activo, color) VALUES(@nombre, @min, 1, @color)`);
  res.status(201).json({ ok: true });
};

export const updateTitulo = async (req, res) => {
  const { id } = req.params;
  const { nombre, minutos_por_descarga, color } = req.body;
  if (!nombre || !minutos_por_descarga) return res.status(400).json({ error: 'Faltan datos' });
  const pool = await getPool();
  await pool.request()
    .input('id', sql.Int, id)
    .input('nombre', sql.VarChar, nombre)
    .input('min', sql.Int, minutos_por_descarga)
    .input('color', sql.VarChar, color || '#FFFFFF')
    .query(`UPDATE dbo.RET_DGT_TITULOS SET nombre=@nombre, minutos_por_descarga=@min, color=@color WHERE titulo_id=@id`);
  res.json({ ok: true });
};

export const deleteTitulo = async (req, res) => {
  const { id } = req.params;
  const pool = await getPool();
  try {
    await pool.request()
      .input('id', sql.Int, id)
      .query(`UPDATE dbo.RET_DGT_TITULOS SET activo = 0 WHERE titulo_id=@id`);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: 'Error al inactivar el título: ' + error.message });
  }
};
