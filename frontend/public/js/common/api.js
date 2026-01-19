// frontend/public/js/common/api.js

// Detecta <base href="..."> o cae a '/'
function getBasePath() {
  const baseTag = document.querySelector('base')?.getAttribute('href') || '/';
  try {
    const u = new URL(baseTag, window.location.origin);
    // nos quedamos solo con el path normalizado con una sola barra final
    let p = u.pathname || '/';
    if (!p.startsWith('/')) p = '/' + p;
    if (!p.endsWith('/'))  p = p + '/';
    return p;
  } catch {
    return '/';
  }
}

const BASE_PATH = getBasePath();

// Une segmentos asegurando 1 sola barra
const join = (...parts) => {
  return parts
    .map((p, i) => (i === 0 ? String(p).replace(/\/+$/,'') : String(p).replace(/^\/+|\/+$/g,'')))
    .filter(Boolean)
    .join('/') + '/';
};

// Raíz de la API según BASE_PATH
const API_ROOT = join(BASE_PATH, 'api');

function buildURL(path, params) {
  // Si path ya es absoluto, úsalo tal cual
  if (/^https?:\/\//i.test(path)) {
    const abs = new URL(path);
    if (params && typeof params === 'object') {
      Object.entries(params).forEach(([k, v]) => {
        if (v !== undefined && v !== null) abs.searchParams.set(k, v);
      });
    }
    return abs.toString();
  }

  // Normaliza: '/maestros/maquinas' => 'maestros/maquinas'
  const clean = String(path).replace(/^\/+/, '');
  // Si ya viene con 'api/', quitarlo para no duplicar
  const rel = clean.startsWith('api/') ? clean.slice(4) : clean;

  const url = new URL(join(API_ROOT, rel), window.location.origin);
  if (params && typeof params === 'object') {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, v);
    });
  }
  return url.toString();
}

async function request(method, path, { params, body } = {}) {
  const url = buildURL(path, params);
  const opts = { method, headers: {} };

  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(url, opts);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const errMsg = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    throw new Error(errMsg);
  }
  return data;
}

export const api = {
  get : (path, params) => request('GET',    path, { params }),
  post: (path, body)   => request('POST',   path, { body }),
  put : (path, body)   => request('PUT',    path, { body }),
  del : (path, params) => request('DELETE', path, { params }),
};
