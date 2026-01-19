import { Router } from 'express';
import { listTitulos, createTitulo } from '../controllers/titulos.controller.js';
const r = Router();
r.get('/', listTitulos);
r.post('/', createTitulo);   // público (no hay login)
export default r;
