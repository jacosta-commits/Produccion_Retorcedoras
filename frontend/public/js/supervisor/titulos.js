// frontend/public/js/supervisor/titulos.js
const $ = s => document.querySelector(s);

/* Base helper */
const BASE = (window.__BASE_PATH__ || '/').replace(/\/+$/, '');
const apiPath = p => BASE + (p.startsWith('/') ? p : '/' + p);

async function j(url, opts){
  const r = await fetch(apiPath(url), opts);
  if(!r.ok){
    let msg = `HTTP ${r.status} ${url}`;
    try{ const x = await r.json(); if(x?.error) msg += ` — ${x.error}`; }catch{}
    throw new Error(msg);
  }
  return r.json();
}

const tb = $('#tbTitulos');

function pintar(list){
  tb.innerHTML = '';
  (list||[]).forEach(t=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${t.nombre}</td><td>${t.minutos_por_descarga}</td>`;
    tb.appendChild(tr);
  });
}

async function cargar(){ pintar(await j('/api/titulos')); }

document.addEventListener('DOMContentLoaded', async ()=>{
  await cargar();
  $('#frmTitulo').addEventListener('submit', async ev=>{
    ev.preventDefault();
    const nombre = $('#nombre').value.trim();
    const min    = parseInt($('#min').value,10);
    if(!nombre || !min) return;
    try{
      await j('/api/titulos', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ nombre, minutos_por_descarga:min })
      });
      $('#msg').textContent = 'Título agregado.';
      $('#frmTitulo').reset();
      await cargar();
    }catch(e){
      $('#msg').textContent = 'Error: ' + e.message;
    }
  });
});
