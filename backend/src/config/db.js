// backend/src/config/db.js
import sql from 'mssql';

let pool = null;

function pick(...keys) {
  for (const k of keys) {
    const v = process.env[k];
    if (v !== undefined && v !== '') return v;
  }
  return undefined;
}

export async function getPool() {
  if (pool) return pool;

  const cfg = {
    server:   pick('DB_SERVER',   'SQL_SERVER'),
    database: pick('DB_DATABASE', 'SQL_DATABASE'),
    user:     pick('DB_USER',     'SQL_USER'),
    password: pick('DB_PASSWORD', 'SQL_PASSWORD'),
    port:     Number(pick('DB_PORT', 'SQL_PORT') || 1433),
    options: {
      encrypt: false,               // cambia a true si usas TLS real en SQL Server
      trustServerCertificate: true, // útil en LAN sin CA
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };

  if (!cfg.server || !cfg.database || !cfg.user || cfg.password === undefined) {
    throw new Error(
      'DB config missing. Set DB_SERVER, DB_DATABASE, DB_USER, DB_PASSWORD (and optional DB_PORT).'
    );
  }

  try {
    pool = await sql.connect(cfg);
    return pool;
  } catch (err) {
    // log útil para ver rápido qué env tomó
    console.error('❌ SQL connect error:', err.message, { server: cfg.server, db: cfg.database, port: cfg.port });
    throw err;
  }
}

export { sql };
