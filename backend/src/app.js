// backend/src/app.js
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { fileURLToPath } from 'url';
import session from 'express-session';

/* --------------------- BASE_PATH normalizado --------------------- */
// Permite servir bajo subruta (p.ej. "/retorcidos/") o raíz ("/")
function normalizeBase(p = '/') {
  let out = String(p || '/').trim();
  if (!out.startsWith('/')) out = '/' + out;
  if (!out.endsWith('/'))  out = out + '/';
  return out;
}
const BASE_PATH = normalizeBase(process.env.BASE_PATH || '/');

const app = express();
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginEmbedderPolicy: false,
  originAgentCluster: false,
  hsts: false
}));
app.use(cors({ origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 🔐 Sesiones para autenticación de supervisor
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'clave_super_secreta_retorcidos_123',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 8 * 60 * 60 * 1000 // 8 horas
    }
  })
);

/* ------------------------- Paths básicos ------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const publicPath = path.resolve(__dirname, '../../frontend/public');

/* ------------------------- Middleware de protección ------------------------- */
function requireSupervisorLogin(req, res, next) {
  if (req.session && req.session.supervisor) {
    return next();
  }
  return res.redirect(`${BASE_PATH}supervisor/login`);
}

/* ------------------------- Páginas ------------------------- */
// Raíz -> redirige a operario (con BASE_PATH)
app.get(`${BASE_PATH}`, (_req, res) => res.redirect(`${BASE_PATH}operario/`));

// Operario (resumen)
app.get(`${BASE_PATH}operario/`, (_req, res) => {
  res.sendFile(path.join(publicPath, 'operario', 'resumen.html'));
});

/* ---- Login supervisor ---- */
// Formulario de login
app.get(`${BASE_PATH}supervisor/login`, (_req, res) => {
  res.sendFile(path.join(publicPath, 'supervisor', 'login.html'));
});

// Proceso de login (valida código contra la vista en SQL)
app.post(`${BASE_PATH}supervisor/login`, async (req, res) => {
  const { codigo } = req.body || {};

  if (!codigo) {
    // e=1 -> código vacío
    return res.redirect(`${BASE_PATH}supervisor/login?e=1`);
  }

  try {
    const { getPool } = await import('./config/db.js');
    const pool = await getPool();

    const result = await pool
      .request()
      .input('codigo', codigo)
      .query(`
        SELECT TOP 1 
          tracod,
          traraz AS NombreSupervisor
        FROM [Medidores_2023].[dbo].[VIEW_PRD_SCADA003]
        WHERE ctranom LIKE 'SUPERVISOR%'
          AND tracod = @codigo
      `);

    if (!result.recordset || result.recordset.length === 0) {
      // e=2 -> código inválido / no autorizado
      return res.redirect(`${BASE_PATH}supervisor/login?e=2`);
    }

    const sup = result.recordset[0];

    // Guardar supervisor en sesión
    req.session.supervisor = {
      codigo: sup.tracod,
      nombre: sup.NombreSupervisor
    };

    console.log('Supervisor logueado:', req.session.supervisor);

    // Enviar el nombre en la URL para que el front lo guarde en sessionStorage
    const encodedName = encodeURIComponent(sup.NombreSupervisor || '');
    return res.redirect(`${BASE_PATH}supervisor/?nom=${encodedName}`);
  } catch (err) {
    console.error('Error en login supervisor:', err);
    // e=3 -> error interno
    return res.redirect(`${BASE_PATH}supervisor/login?e=3`);
  }
});

// Logout supervisor
app.get(`${BASE_PATH}supervisor/logout`, (req, res) => {
  try {
    if (req.session) {
      // Limpiar info de supervisor
      req.session.supervisor = null;

      req.session.destroy(err => {
        if (err) {
          console.error('Error al destruir sesión:', err);
          return res.redirect(`${BASE_PATH}supervisor/login?e=3`);
        }

        // Limpiar cookie de sesión por defecto de express-session
        res.clearCookie('connect.sid');

        // Flag para que el login limpie sessionStorage.supNombre
        return res.redirect(`${BASE_PATH}supervisor/login?logout=1`);
      });
    } else {
      return res.redirect(`${BASE_PATH}supervisor/login?logout=1`);
    }
  } catch (err) {
    console.error('Error en logout supervisor:', err);
    return res.redirect(`${BASE_PATH}supervisor/login?e=3`);
  }
});

// Supervisor (index) – PROTEGIDO
app.get(`${BASE_PATH}supervisor/`, requireSupervisorLogin, (_req, res) => {
  res.sendFile(path.join(publicPath, 'supervisor', 'index.html'));
});

// Supervisor: programacion (admite con y sin .html) – PROTEGIDO
app.get(`${BASE_PATH}supervisor/programacion`, requireSupervisorLogin, (_req, res) => {
  res.sendFile(path.join(publicPath, 'supervisor', 'programacion.html'));
});
app.get(`${BASE_PATH}supervisor/programacion.html`, requireSupervisorLogin, (_req, res) => {
  res.sendFile(path.join(publicPath, 'supervisor', 'programacion.html'));
});

// Supervisor: titulos (admite con y sin .html) – PROTEGIDO
app.get(`${BASE_PATH}supervisor/titulos`, requireSupervisorLogin, (_req, res) => {
  res.sendFile(path.join(publicPath, 'supervisor', 'titulos.html'));
});
app.get(`${BASE_PATH}supervisor/titulos.html`, requireSupervisorLogin, (_req, res) => {
  res.sendFile(path.join(publicPath, 'supervisor', 'titulos.html'));
});

/* ------------------------- Health ------------------------- */
app.get(`${BASE_PATH}api/ping`, (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString(), base: BASE_PATH });
});

// (opcional) DB check
app.get(`${BASE_PATH}api/dbcheck`, async (_req, res) => {
  try {
    const { getPool } = await import('./config/db.js');
    const pool = await getPool();
    const rs = await pool.request().query('SELECT 1 AS ok');
    res.json({ ok: true, rs: rs.recordset });
  } catch (e) {
    console.error('DBCHECK ERROR:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* -------- Info del supervisor logueado (para el header del front) -------- */
// No la estás usando ahora, pero la dejamos disponible
app.get('/api/supervisor/me', requireSupervisorLogin, (req, res) => {
  res.json({
    ok: true,
    supervisor: req.session.supervisor || null
  });
});

/* ------------------------- API REST ------------------------- */
import maestrosRoutes from './routes/maestros.routes.js';
import titulosRoutes from './routes/titulos.routes.js';
import programacionesRoutes from './routes/programaciones.routes.js';
import operarioRoutes from './routes/operario.routes.js';

const router = express.Router();
router.use('/maestros', maestrosRoutes);
router.use('/titulos', titulosRoutes);
router.use('/programaciones', programacionesRoutes);
router.use('/operario', operarioRoutes);

// Monta las APIs bajo BASE_PATH
app.use(`${BASE_PATH}api`, router);

/* ------------------------- Static (AL FINAL) ------------------------- */
// Muy importante: va al final para que NO se coma /supervisor/ antes del middleware
app.use(BASE_PATH, express.static(publicPath));

export default app;
