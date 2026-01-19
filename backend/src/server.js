// backend/src/server.js
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import app from './app.js';

// --- Cargar .env desde el directorio padre de /src ---
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
// Si tu .env está en backend/.env (uno arriba de /src):
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Puertos y base
const PORT = process.env.PORT || 4000;
const BASE_PATH = process.env.BASE_PATH || '/';

process.on('unhandledRejection', (err) => console.error('UNHANDLED REJECTION:', err));
process.on('uncaughtException',  (err) => console.error('UNCAUGHT EXCEPTION:', err));

const server = app.listen(PORT, () => {
  console.log(`✅ HTTP listo en http://localhost:${PORT}${BASE_PATH}`);
  console.log(`BASE_PATH = "${BASE_PATH}"`);
});

export default server;
