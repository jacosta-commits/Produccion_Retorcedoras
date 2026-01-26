export const $ = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));

export const api = {
  async request(method, url, body) {
    const opts = { method };
    if (body) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) {
      let msg = `HTTP ${r.status} ${method} ${url}`;
      try { const j = await r.json(); if (j?.error) msg += ` — ${j.error}`; } catch { }
      throw new Error(msg);
    }
    return r.json();
  },
  get(url) { return this.request('GET', url); },
  post(url, body) { return this.request('POST', url, body); },
  put(url, body) { return this.request('PUT', url, body); },
  delete(url) { return this.request('DELETE', url); }
};

// Alias legacy para compatibilidad si algo lo usa
export const j = (url) => api.get(url);

export const fmtHora = v => {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
};

export const fmtFull = (dt) => {
  if (!dt) return '—';
  const d = (dt instanceof Date) ? dt : new Date(dt);
  if (isNaN(d)) return '—';
  return d.toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
};

export function toISO(dtLocalValue) {
  // dtLocalValue: '2025-10-29T05:30'
  if (!dtLocalValue) return null;
  const d = new Date(dtLocalValue);
  return d.toISOString();
}

export async function cargarMaquinas(sel) {
  const data = await api.get('/api/maestros/maquinas');
  sel.innerHTML = '';
  data.forEach(m => {
    const o = document.createElement('option');
    o.value = m.maquina_id;
    o.textContent = m.nombre || m.codigo;
    sel.appendChild(o);
  });
}

export async function cargarLados(sel) {
  const data = await api.get('/api/maestros/lados');
  sel.innerHTML = '';
  data.forEach(l => {
    const o = document.createElement('option');
    o.value = l.lado_id;
    o.textContent = l.nombre;
    sel.appendChild(o);
  });
}
