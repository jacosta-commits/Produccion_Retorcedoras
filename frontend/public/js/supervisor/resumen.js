// frontend/public/js/supervisor/resumen.js
const $  = (s, d=document) => d.querySelector(s);

const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} GET ${url}`);
    return r.json();
  },
  async put(url, body) {
    const r = await fetch(url, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status} PUT ${url}`;
      try { const j = await r.json(); if (j?.error) msg += ` — ${j.error}`; } catch {}
      throw new Error(msg);
    }
    return r.json();
  }
};

/* ---------- util fecha ---------- */
const pad = n => String(n).padStart(2,'0');
function toLocalInputValue(dt) {
  const d = (dt instanceof Date) ? dt : new Date(dt);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtFull(dt) {
  const d = (dt instanceof Date) ? dt : new Date(dt);
  return d.toLocaleString('es-PE', {
    day:'2-digit', month:'2-digit', year:'numeric',
    hour:'2-digit', minute:'2-digit'
  });
}
const getStart = row => row.fh_inicio_plan ?? row.fh_inicio ?? row.fh_ini ?? null;
const getEnd   = row => row.fh_fin_plan    ?? row.fh_fin    ?? row.fh_final ?? null;

/* ---------- maestros ---------- */
async function cargarMaquinas(){
  const data = await api.get('/api/maestros/maquinas');
  const sel = $('#selMaquina'); sel.innerHTML = '';
  for (const m of data) {
    const opt = document.createElement('option');
    opt.value = m.maquina_id;
    opt.textContent = m.nombre || m.codigo;
    sel.appendChild(opt);
  }
}
async function cargarLados(){
  const data = await api.get('/api/maestros/lados');
  const sel = $('#selLado'); sel.innerHTML = '';
  for (const l of data) {
    const opt = document.createElement('option');
    opt.value = l.lado_id;
    opt.textContent = l.nombre;
    sel.appendChild(opt);
  }
}

/* ---------- cabecera + tabla ---------- */
function renderCabecera(r){
  $('#hdrTitulo').textContent = r?.titulo?.nombre ?? '—';
  $('#hdrTiempo').textContent = r?.titulo?.minutos_por_descarga ?? '—';
  $('#hdrOT').textContent     = r?.ot?.otcod ?? '—';
}

function renderTabla(plan){
  const tb = $('#tbPlan'); 
  tb.innerHTML = '';

  const toDate = v => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : d; };
  const nowMs = Date.now();

  // solo filas futuras por F.H. FINAL
  const rows = (plan || []).filter(row => {
    const fin = toDate(getEnd(row));
    return fin && fin.getTime() >= nowMs;
  });

  if (!rows.length){
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="3" class="muted">Sin descargas futuras.</td>`;
    tb.appendChild(tr);
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.dataset.planId = row.plan_descarga_id;

    const tdN = document.createElement('td');
    tdN.textContent = row.secuencia ?? '';
    tr.appendChild(tdN);

    const tdIni = document.createElement('td');
    tdIni.className = 'editable';
    tdIni.tabIndex = 0;
    tdIni.textContent = fmtFull(getStart(row));
    enableCellEdit(tdIni, row);
    tr.appendChild(tdIni);

    const tdFin = document.createElement('td');
    tdFin.textContent = fmtFull(getEnd(row));
    tr.appendChild(tdFin);

    tb.appendChild(tr);
  });
}

/* ---------- edición en celda ---------- */
function enableCellEdit(td, row){
  td.addEventListener('dblclick', () => startEdit(td, row));
  td.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); startEdit(td, row); }});
  let lastTap = 0;
  td.addEventListener('touchend', () => {
    const now = Date.now();
    if (now - lastTap < 300) startEdit(td, row);
    lastTap = now;
  }, {passive:true});
}

function startEdit(td, row){
  if (td.dataset.editing === '1') return;
  td.dataset.editing = '1';

  const prevValue = getStart(row);
  const prevLabel = td.textContent;

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = '6px';
  wrap.style.alignItems = 'center';

  const input = document.createElement('input');
  input.type = 'datetime-local';
  input.value = toLocalInputValue(prevValue);
  Object.assign(input.style, {
    height: '34px', borderRadius: '8px', border: '1px solid var(--line)',
    background: 'var(--card)', color: 'var(--text)', padding: '0 10px'
  });

  const btnOk = document.createElement('button');
  btnOk.textContent = 'Guardar';
  btnOk.className = 'btn'; btnOk.style.height = '34px';

  const btnCancel = document.createElement('button');
  btnCancel.textContent = 'Cancelar';
  btnCancel.className = 'btn ghost'; btnCancel.style.height = '34px';

  td.innerHTML = '';
  wrap.append(input, btnOk, btnCancel);
  td.appendChild(wrap);
  input.focus();

  const cancel = () => { td.textContent = prevLabel; td.dataset.editing = '0'; };

  const commit = async () => {
    const v = input.value;
    if (!v) return cancel();
    const newDt = new Date(v);
    try {
      await api.put(`/api/programaciones/plan/${row.plan_descarga_id}`, {
        fh_inicio_plan: newDt.toISOString()
      });
      await cargar();
    } catch (e) {
      console.error(e);
      alert('No se pudo guardar el cambio.');
      cancel();
    }
  };

  btnOk.addEventListener('click', commit);
  btnCancel.addEventListener('click', cancel);
  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') commit();
    if (ev.key === 'Escape') cancel();
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { if (!td.contains(document.activeElement)) cancel(); }, 120);
  });
}

/* ---------- carga principal ---------- */
async function cargar(){
  const maq  = $('#selMaquina')?.value;
  const lado = $('#selLado')?.value;
  if(!maq || !lado) return;

  const r = await api.get(`/api/operario/resumen?maquina_id=${maq}&lado_id=${lado}`);
  if (!r?.ok) { renderCabecera({}); renderTabla([]); return; }
  renderCabecera(r);
  renderTabla(r.plan);
}

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  await cargarMaquinas();
  await cargarLados();
  if ($('#selMaquina').options.length) $('#selMaquina').selectedIndex = 0;
  if ($('#selLado').options.length)    $('#selLado').selectedIndex = 0;

  $('#btnRefresh')?.addEventListener('click', cargar);
  $('#selMaquina')?.addEventListener('change', cargar);
  $('#selLado')?.addEventListener('change', cargar);

  // hamburguesa simple (por si no tienes el common/nav.js aquí)
  const btnMenu = document.getElementById('btnMenu'), drawer = document.getElementById('drawer');
  if (btnMenu && drawer) {
    const toggle = (e)=>{ e.stopPropagation(); drawer.classList.toggle('open'); };
    btnMenu.addEventListener('click', toggle);
    document.addEventListener('click', (ev)=>{ if(!drawer.contains(ev.target) && ev.target!==btnMenu) drawer.classList.remove('open'); });
  }

  await cargar();
  setInterval(cargar, 30000);
});
