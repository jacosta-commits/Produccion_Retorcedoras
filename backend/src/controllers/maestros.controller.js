import { getPool } from '../config/db.js';

export const getMaquinas = async (_req, res) => {
  const pool = await getPool();
  const rs = await pool.request().query(`
    SELECT maquina_id, codigo, nombre FROM dbo.RET_DGT_MAQUINAS WHERE activo=1 ORDER BY codigo
  `);
  res.json(rs.recordset);
};

export const getLados = async (_req, res) => {
  const pool = await getPool();
  const rs = await pool.request().query(`
    SELECT lado_id, nombre FROM dbo.RET_DGT_LADOS WHERE activo=1 ORDER BY lado_id
  `);
  res.json(rs.recordset);
};
