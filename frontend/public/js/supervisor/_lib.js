export const $  = s => document.querySelector(s);
export const $$ = s => Array.from(document.querySelectorAll(s));

export async function j(url, opts){
  const r = await fetch(url, opts);
  if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}
export const fmtHora = v => {
  if(!v) return '—';
  const d = new Date(v);
  if(isNaN(d)) return String(v);
  return d.toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'});
};
export function toISO(dtLocalValue){
  // dtLocalValue: '2025-10-29T05:30'
  if(!dtLocalValue) return null;
  const d = new Date(dtLocalValue);
  return d.toISOString();
}
export async function cargarMaquinas(sel){
  const data = await j('/api/maestros/maquinas');
  sel.innerHTML = '';
  data.forEach(m=>{
    const o = document.createElement('option');
    o.value = m.maquina_id;
    o.textContent = m.nombre || m.codigo;
    sel.appendChild(o);
  });
}
export async function cargarLados(sel){
  const data = await j('/api/maestros/lados');
  sel.innerHTML = '';
  data.forEach(l=>{
    const o = document.createElement('option');
    o.value = l.lado_id;
    o.textContent = l.nombre;
    sel.appendChild(o);
  });
}
