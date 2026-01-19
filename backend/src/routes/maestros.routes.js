// backend/src/routes/maestros.routes.js
import { Router } from 'express';
import { getPool } from '../config/db.js';

const r = Router();

// Maquinas
r.get('/maquinas', async (_req, res) => {
  const pool = await getPool();
  const rs = await pool.request().query(`
    SELECT maquina_id, nombre, codigo
    FROM dbo.RET_DGT_MAQUINAS
    WHERE activo = 1
    ORDER BY nombre
  `);
  res.json(rs.recordset);
});

// Lados
r.get('/lados', async (_req, res) => {
  const pool = await getPool();
  const rs = await pool.request().query(`
    SELECT lado_id, nombre
    FROM dbo.RET_DGT_LADOS
    WHERE activo = 1
    ORDER BY lado_id
  `);
  res.json(rs.recordset);
});

export default r;
