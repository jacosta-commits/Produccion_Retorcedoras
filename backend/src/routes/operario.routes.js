import { Router } from 'express';
import { resumenOperario } from '../controllers/operario.controller.js';

const router = Router();

// /api/operario/resumen?maquina_id=1&lado_id=1
router.get('/resumen', resumenOperario);

export default router;
