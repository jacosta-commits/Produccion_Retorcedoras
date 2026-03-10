// backend/src/routes/programaciones.routes.js
import { Router } from 'express';
import {
  crearProgramacion,
  getPlanVigente,
  editarPlanFila,
  editarPlan,
  deleteProgramacion,
  getProgramacionesActivas,
  getProgramacionById
} from '../controllers/programaciones.controller.js';

const r = Router();

r.post('/', crearProgramacion);
r.get('/vigente', getPlanVigente);
r.get('/activas', getProgramacionesActivas);
r.get('/:id', getProgramacionById);
r.delete('/:id', deleteProgramacion);
r.put('/:id/plan', editarPlan);               // Edición general del plan
r.put('/plan/:plan_descarga_id', editarPlanFila); // Edición de fila individual

export default r;
