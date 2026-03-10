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

// Mapa de colores compartido
const COLOR_MAP = {
  '9 NY': { bg: '#7B0000', fg: '#F5F5F5' },
  '12 NY': { bg: '#6a6a6a', fg: '#F5F5F5' },
  '15 NY': { bg: '#FFFF00', fg: '#000000' },
  '18 NY': { bg: '#24a124', fg: '#F5F5F5' },
  '21 NY': { bg: '#0000A5', fg: '#F5F5F5' },
  '24 NY': { bg: '#5F3300', fg: '#F5F5F5' },
  '27 NY': { bg: '#32CD32', fg: '#000000' },
  '30 NY': { bg: '#4B0082', fg: '#F5F5F5' },
  '33 NY': { bg: '#FF8C00', fg: '#F5F5F5' },
  '36 NY': { bg: '#FFFFFF', fg: '#000000' },
  '42 NY': { bg: '#6a6a6a', fg: '#F5F5F5' },
  '48 NY': { bg: '#24a124', fg: '#F5F5F5' },
  '72 NY': { bg: '#6a6a6a', fg: '#F5F5F5' },
  '84 NY': { bg: '#5F3300', fg: '#F5F5F5' },
  '96 NY': { bg: '#FFFFFF', fg: '#000000' },
  '108 NY': { bg: '#24a124', fg: '#F5F5F5' },
  '72 PS': { bg: '#FFFFFF', fg: '#000000' },
  '120 PS': { bg: '#FFFFFF', fg: '#000000' }
};

function extractCode(name) {
  const nums = name?.match(/\d+/g);
  return nums ? `${nums[nums.length - 1]} NY` : '';
}

function resetForm() {
  $('#frmTitulo').reset();
  $('#titulo_id').value = '';
  $('#color').value = '#ffffff';
  $('#modalTitle').textContent = 'Nuevo Título';
  $('#btnSubmitText').textContent = 'Guardar';
  $('#msg').textContent = '';
  $('#modalTitulo').classList.remove('open');
}

function openModal(tt = null) {
  if (tt) {
    $('#modalTitle').textContent = 'Editar Título';
    $('#titulo_id').value = tt.titulo_id;
    $('#nombre').value = tt.nombre;
    $('#min').value = tt.minutos_por_descarga;

    let initialColor = tt.color;
    if (!initialColor) {
      const code = extractCode(tt.nombre);
      if (COLOR_MAP[code]) initialColor = COLOR_MAP[code].bg;
      else initialColor = '#ffffff';
    }
    $('#color').value = initialColor;
  } else {
    $('#modalTitle').textContent = 'Nuevo Título';
    $('#titulo_id').value = '';
    $('#frmTitulo').reset();
    $('#color').value = '#ffffff';
  }
  $('#msg').textContent = '';
  $('#modalTitulo').classList.add('open');
}

function pintar(list) {
  listData = list || [];
  tb.innerHTML = '';
  listData.forEach(t => {
    let displayColor = t.color;

    // Si viene NULL o vacío de la base de datos, calculamos su color de fallback
    if (!displayColor) {
      const code = extractCode(t.nombre);
      if (COLOR_MAP[code]) {
        displayColor = COLOR_MAP[code].bg;
      } else {
        displayColor = 'transparent'; // Fallback transparente
      }
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.nombre}</td>
      <td>${t.minutos_por_descarga}</td>
      <td style="text-align: center;">
        <div style="width: 24px; height: 24px; border-radius: 50%; background-color: ${displayColor}; display: inline-block; border: 1px solid #444;" title="${displayColor}"></div>
      </td>
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
      if (tt) openModal(tt);
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

  $('#btnNuevoTitulo').addEventListener('click', () => openModal());
  $('#btnCancel').addEventListener('click', resetForm);

  $('#frmTitulo').addEventListener('submit', async ev => {
    ev.preventDefault();
    const id = $('#titulo_id').value;
    const nombre = $('#nombre').value.trim();
    const min = parseInt($('#min').value, 10);
    const color = $('#color').value;
    if (!nombre || !min) return;
    try {
      if (id) {
        await j(`/api/titulos/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, minutos_por_descarga: min, color })
        });
        $('#msg').textContent = 'Título actualizado.';
      } else {
        await j('/api/titulos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nombre, minutos_por_descarga: min, color })
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
