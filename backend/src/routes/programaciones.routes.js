// backend/src/routes/programaciones.routes.js
import { Router } from 'express';
import {
  crearProgramacion,
  getPlanVigente,
  editarPlanFila,
  deleteProgramacion,
  getProgramacionesActivas,
  getProgramacionById
} from '../controllers/programaciones.controller.js';

const r = Router();

r.post('/', crearProgramacion);
r.get('/vigente', getPlanVigente);
r.get('/activas', getProgramacionesActivas); // Nueva ruta para listar
r.get('/:id', getProgramacionById);          // Nueva ruta para detalle
r.delete('/:id', deleteProgramacion);        // Nueva ruta para borrar
r.put('/plan/:plan_descarga_id', editarPlanFila);

export default r;
