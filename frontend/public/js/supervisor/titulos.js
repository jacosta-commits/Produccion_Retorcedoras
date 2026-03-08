// frontend/public/js/supervisor/titulos.js
const $ = s => document.querySelector(s);

/* Base helper */
const BASE = (window.__BASE_PATH__ || '/').replace(/\/+$/, '');
const apiPath = p => BASE + (p.startsWith('/') ? p : '/' + p);

async function j(url, opts) {
  const r = await fetch(apiPath(url), opts);
  if (!r.ok) {
    let msg = `HTTP ${r.status} ${url}`;
    try { const x = await r.json(); if (x?.error) msg += ` — ${x.error}`; } catch { }
    throw new Error(msg);
  }
  return r.json();
}

const tb = $('#tbTitulos');
let listData = [];

function resetForm() {
  $('#frmTitulo').reset();
  $('#titulo_id').value = '';
  $('#btnSubmitText').textContent = 'Agregar';
  $('#iconAdd').style.display = 'inline';
  $('#iconEdit').style.display = 'none';
  $('#btnCancel').style.display = 'none';
  $('#msg').textContent = '';
}

function pintar(list) {
  listData = list || [];
  tb.innerHTML = '';
  listData.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.nombre}</td>
      <td>${t.minutos_por_descarga}</td>
      <td style="text-align: center;">
        <button type="button" class="btn-edit" data-id="${t.titulo_id}" style="background: none; border: none; cursor: pointer; color: #2d8cff; margin-right: 8px;" title="Editar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>
        </button>
        <button type="button" class="btn-delete" data-id="${t.titulo_id}" style="background: none; border: none; cursor: pointer; color: #ff4d4f;" title="Eliminar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
        </button>
      </td>
    `;
    tb.appendChild(tr);
  });

  document.querySelectorAll('.btn-edit').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = parseInt(btn.dataset.id, 10);
      const tt = listData.find(x => x.titulo_id === id);
      if (tt) {
        $('#titulo_id').value = tt.titulo_id;
        $('#nombre').value = tt.nombre;
        $('#min').value = tt.minutos_por_descarga;

        $('#btnSubmitText').textContent = 'Guardar';
        $('#iconAdd').style.display = 'none';
        $('#iconEdit').style.display = 'inline';
        $('#btnCancel').style.display = 'flex';
        $('#msg').textContent = '';
      }
    });
  });

  document.querySelectorAll('.btn-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Estás seguro de eliminar este título?')) return;
      const id = btn.dataset.id;
      try {
        await j(`/api/titulos/${id}`, { method: 'DELETE' });
        $('#msg').textContent = 'Título eliminado.';
        if ($('#titulo_id').value === id) resetForm();
        await cargar();
      } catch (e) {
        $('#msg').textContent = 'Error: ' + e.message;
      }
    });
  });
}

async function cargar() { pintar(await j('/api/titulos')); }

document.addEventListener('DOMContentLoaded', async () => {
  await cargar();

  $('#btnCancel').addEventListener('click', resetForm);

  $('#frmTitulo').addEventListener('submit', async ev => {
    ev.preventDefault();
    const id = $('#titulo_id').value;
    const nombre = $('#nombre').value.trim();
    const min = parseInt($('#min').value, 10);
    if (!nombre || !min) return;
    try {
      if (id) {
        await j(`/api/titulos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, minutos_por_descarga: min })
        });
        $('#msg').textContent = 'Título actualizado.';
      } else {
        await j('/api/titulos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, minutos_por_descarga: min })
        });
        $('#msg').textContent = 'Título agregado.';
      }
      resetForm();
      await cargar();
    } catch (e) {
      $('#msg').textContent = 'Error: ' + e.message;
    }
  });
});
