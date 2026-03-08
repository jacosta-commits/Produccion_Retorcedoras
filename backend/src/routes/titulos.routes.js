import { Router } from 'express';
import { listTitulos, createTitulo, updateTitulo, deleteTitulo } from '../controllers/titulos.controller.js';
const r = Router();
r.get('/', listTitulos);
r.post('/', createTitulo);   // público (no hay login)
r.put('/:id', updateTitulo);
r.delete('/:id', deleteTitulo);
export default r;
