// backend/src/routes/programaciones.routes.js
import { Router } from 'express';
import {
  crearProgramacion,
  getPlanVigente,
  editarPlanFila
} from '../controllers/programaciones.controller.js';

const r = Router();

r.post('/', crearProgramacion);
r.get('/vigente', getPlanVigente);
r.put('/plan/:plan_descarga_id', editarPlanFila);

export default r;
