// frontend/public/js/operario/resumen.js

// Helpers
const $ = s => document.querySelector(s);

/* Base helper */
const BASE = (window.__BASE_PATH__ || '/').replace(/\/+$/, '');
const apiPath = p => BASE + (p.startsWith('/') ? p : '/' + p);

async function j(url){
  const r = await fetch(apiPath(url));
  if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function fmtDT(v){
  if(!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return String(v);
  return d.toLocaleString('es-PE',{
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit', hour12:true
  });
}

// Filtro de filas futuras por F.H. FINAL
const toDate = v => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
function onlyFuture(plan){
  const nowMs = Date.now();
  return (plan || []).filter(p => {
    const fin = toDate(p.fh_fin ?? p.fh_fin_plan);
    return fin && fin.getTime() >= nowMs;
  });
}

// UI fill
function pintarTabla(tbodySel, plan){
  const tb = $(tbodySel);
  tb.innerHTML = '';

  const rows = onlyFuture(plan);

  if (!rows.length){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3" class="muted">Sin descargas futuras.</td>`;
    tb.appendChild(tr);
    return;
  }

  rows.forEach(p=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${p.secuencia ?? ''}</td>
      <td>${fmtDT(p.fh_inicio_plan ?? p.fh_inicio)}</td>
      <td>${fmtDT(p.fh_fin_plan ?? p.fh_fin)}</td>
    `;
    tb.appendChild(tr);
  });
}

function pintarCabecera(r){
  $('#hdrTitulo').textContent = r?.titulo?.nombre ?? '—';
  const mins =
    r?.titulo?.minutos_por_descarga ??
    r?.titulo?.minutos ??
    r?.titulo?.min ?? null;
  $('#hdrTiempo').textContent = mins ?? '—';
  $('#hdrOT').textContent = r?.ot?.otcod ?? '—';
}

// Data
async function cargarMaquinas(){
  const data = await j('/api/maestros/maquinas');
  const sel = $('#selMaquina');
  sel.innerHTML = '';
  data.forEach(m=>{
    const o = document.createElement('option');
    o.value = m.maquina_id;
    o.textContent = m.nombre || m.codigo;
    sel.appendChild(o);
  });
}

async function cargar(){
  const maquina_id = $('#selMaquina')?.value;
  if(!maquina_id) return;
  const [rA, rB] = await Promise.all([
    j(`/api/operario/resumen?maquina_id=${maquina_id}&lado_id=1`).catch(()=>({ok:false,plan:[]})),
    j(`/api/operario/resumen?maquina_id=${maquina_id}&lado_id=2`).catch(()=>({ok:false,plan:[]})),
  ]);

  const cab = rA.ok !== false ? rA : (rB.ok !== false ? rB : null);
  pintarCabecera(cab);

  pintarTabla('#tbPlanA', rA.ok===false ? [] : rA.plan);
  pintarTabla('#tbPlanB', rB.ok===false ? [] : rB.plan);
}

// Boot
document.addEventListener('DOMContentLoaded', async ()=>{
  await cargarMaquinas();
  if ($('#selMaquina').options.length) $('#selMaquina').selectedIndex = 0;

  $('#selMaquina').addEventListener('change', cargar);
  $('#btnRefresh').addEventListener('click', cargar);

  await cargar();
  setInterval(cargar, 30000);
});
