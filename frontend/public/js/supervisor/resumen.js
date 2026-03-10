// frontend/public/js/supervisor/resumen.js
import { api, fmtFull, fmtFullBr } from './_lib.js';

const $ = s => document.querySelector(s);

/* ---- Estado actual ---- */
let CURRENT_PROG_ID = null;   // programacion_id seleccionada
let CURRENT_PLAN_DATA = null; // datos completos del plan cargado
let editFp = null;            // instancia flatpickr de la barra de edición

/* ------------------ Renderizado de Lista de Programaciones ------------------ */
function renderProgramaciones(list) {
  const sec = $('#secProgramaciones');
  const tb = $('#tbProgramaciones');
  tb.innerHTML = '';

  if (!list || !list.length) {
    sec.style.display = 'none';
    return;
  }

  sec.style.display = 'block';
  list.forEach(p => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.dataset.id = p.programacion_id;

    tr.innerHTML = `
      <td>${p.otcod}</td>
      <td>${p.titulo}</td>
      <td>${fmtFullBr(p.inicio)}</td>
      <td>${fmtFullBr(p.fin)}</td>
      <td>
        <button class="btn-danger btn-sm" data-id="${p.programacion_id}">Eliminar</button>
      </td>
    `;

    tr.addEventListener('click', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      tb.querySelectorAll('tr').forEach(r => r.classList.remove('table-active'));
      tr.classList.add('table-active');
      cargarDetalle(p.programacion_id);
    });

    const btn = tr.querySelector('button');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      eliminarProgramacion(p.programacion_id);
    });

    tb.appendChild(tr);
  });
}

/* ------------------ Utils Visuales ------------------ */
function getContrastYIQ(hexcolor) {
  if (!hexcolor || hexcolor === 'transparent') return '#ffffff';
  hexcolor = hexcolor.replace('#', '');
  const r = parseInt(hexcolor.substr(0, 2), 16);
  const g = parseInt(hexcolor.substr(2, 2), 16);
  const b = parseInt(hexcolor.substr(4, 2), 16);
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return (yiq >= 128) ? '#000000' : '#ffffff';
}

async function cargarDetalle(id) {
  CURRENT_PROG_ID = id;
  try {
    const r = await api.get(`/api/programaciones/${id}`);
    if (r.ok) {
      CURRENT_PLAN_DATA = r;
      renderPlan(r);
    }
  } catch (e) {
    console.error('Error cargando detalle:', e);
    CURRENT_PLAN_DATA = null;
    renderPlan(null);
  }
}

async function eliminarProgramacion(id) {
  if (!confirm('¿Estás seguro de eliminar esta programación y todo su plan?')) return;
  try {
    await api.delete(`/api/programaciones/${id}`);
    await cargar();
  } catch (e) {
    alert('Error al eliminar: ' + e.message);
  }
}

/* ------------------ Renderizado de Plan Detallado ------------------ */
function renderPlan(data) {
  const tb = $('#tbPlan');
  tb.innerHTML = '';

  // Header Info
  const hTitulo = $('#hdrTitulo');
  hTitulo.textContent = data?.titulo ?? '—';

  // Aplicar Color
  if (data?.color) {
    hTitulo.parentElement.style.backgroundColor = data.color;
    hTitulo.parentElement.style.color = getContrastYIQ(data.color);
    hTitulo.parentElement.style.borderColor = 'rgba(255,255,255,0.1)';
  } else {
    hTitulo.parentElement.style.backgroundColor = '';
    hTitulo.parentElement.style.color = '';
    hTitulo.parentElement.style.borderColor = '';
  }

  $('#hdrTiempo').textContent = data?.minutos_por_descarga ?? '—';
  $('#hdrOT').textContent = data?.otcod ?? '—';

  // Modal editar plan
  const btnEdit = $('#btnEditPlan');
  cerrarEditBar();

  const rows = data?.plan || [];
  if (!rows.length) {
    btnEdit.style.display = 'none';
    tb.innerHTML = '<tr><td colspan="4" class="muted">Seleccione una programación para ver el detalle.</td></tr>';
    return;
  }

  btnEdit.style.display = 'inline-flex';

  rows.forEach(r => {
    const tr = document.createElement('tr');

    tr.innerHTML = `
      <td>${r.secuencia}</td>
      <td>${fmtFullBr(r.fh_inicio)}</td>
      <td>${fmtFullBr(r.fh_fin)}</td>
      <td>
        <button class="btn-edit-row" title="Editar fecha de inicio" data-id="${r.plan_descarga_id}">✎</button>
      </td>
    `;

    // Lápiz por fila → abre flatpickr para editar esa fecha individual
    const btnRow = tr.querySelector('.btn-edit-row');

    // Crear fecha "face value" para flatpickr
    const dUTC = new Date(r.fh_inicio);
    const dFace = new Date(
      dUTC.getUTCFullYear(), dUTC.getUTCMonth(), dUTC.getUTCDate(),
      dUTC.getUTCHours(), dUTC.getUTCMinutes()
    );

    // Creamos un input oculto real, para que flatpickr se conecte
    const ghost = document.createElement('input');
    ghost.type = 'text';
    ghost.style.display = 'none'; // ¡100% oculto!
    btnRow.parentElement.appendChild(ghost);

    const fp = flatpickr(ghost, {
      defaultDate: dFace,
      enableTime: true,
      dateFormat: 'd/m/Y h:i K',
      time_24hr: false,
      locale: 'es',
      disableMobile: true, // <-- CRUCIAL: Evita que el navegador dibuje su input de fecha nativo (que ignora CSS)
      positionElement: btnRow, // Posiciona el calendario en el lápiz
      onClose: async (selectedDates) => {
        if (!selectedDates.length) return;
        const d = selectedDates[0];
        const pad = n => String(n).padStart(2, '0');
        const faceValue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        await actualizarFila(r.plan_descarga_id, faceValue);
      }
    });

    // Abrimos el calendario al tocar el lápiz
    btnRow.addEventListener('click', (e) => {
      e.stopPropagation();
      fp.open();
    });

    tb.appendChild(tr);
  });
}

/* ------------------ Actualizar fila individual ------------------ */
async function actualizarFila(id, fechaFaceValue) {
  try {
    const res = await api.put(`/api/programaciones/plan/${id}`, {
      fh_inicio_plan: fechaFaceValue
    });
    if (res.ok && CURRENT_PROG_ID) {
      await cargarDetalle(CURRENT_PROG_ID);
    } else {
      alert('Error al actualizar: ' + (res.error || 'Desconocido'));
    }
  } catch (e) {
    console.error(e);
    alert('Error de conexión al actualizar');
  }
}

/* ------------------ Modal de Edición General ------------------ */
function abrirEditBar() {
  const bar = $('#modalEditPlan');
  bar.classList.add('open');

  // Precargar datos actuales
  if (CURRENT_PLAN_DATA) {
    $('#editDescargas').value = CURRENT_PLAN_DATA.descargas_programadas || '';
  }
}

function cerrarEditBar() {
  $('#modalEditPlan').classList.remove('open');
}

async function guardarPlanGeneral() {
  if (!CURRENT_PROG_ID) return;

  const descargas = parseInt($('#editDescargas').value, 10);
  if (!Number.isFinite(descargas) || descargas < 1) {
    alert('Ingrese un número válido de descargas');
    return;
  }

  try {
    const res = await api.put(`/api/programaciones/${CURRENT_PROG_ID}/plan`, {
      descargas
    });

    if (res.ok) {
      cerrarEditBar();
      await cargarDetalle(CURRENT_PROG_ID);
      // También refrescar la lista de arriba por si cambiaron las fechas
      await cargar();
    } else {
      alert('Error: ' + (res.error || 'Desconocido'));
    }
  } catch (e) {
    console.error(e);
    alert('Error al guardar: ' + e.message);
  }
}

/* ------------------ Carga de Datos ------------------ */
async function cargar() {
  const maquina_id = $('#selMaquina').value;
  const lado_id = $('#selLado').value;
  if (!maquina_id || !lado_id) return;

  cerrarEditBar();

  try {
    const activas = await api.get(`/api/programaciones/activas?maquina_id=${maquina_id}&lado_id=${lado_id}`)
      .catch(() => []);

    renderProgramaciones(activas);

    if (activas.length) {
      const firstRow = $('#tbProgramaciones tr');
      if (firstRow) firstRow.click();
    } else {
      CURRENT_PROG_ID = null;
      CURRENT_PLAN_DATA = null;
      renderPlan(null);
    }
  } catch (e) {
    console.error(e);
  }
}

/* ------------------ Init ------------------ */
async function loadMaestros() {
  const maquinas = await api.get('/api/maestros/maquinas');
  const lados = await api.get('/api/maestros/lados');

  const sm = $('#selMaquina'); sm.innerHTML = '';
  maquinas.forEach(m => {
    const o = document.createElement('option');
    o.value = m.maquina_id; o.textContent = m.nombre;
    sm.appendChild(o);
  });

  const sl = $('#selLado'); sl.innerHTML = '';
  lados.forEach(l => {
    const o = document.createElement('option');
    o.value = l.lado_id; o.textContent = l.nombre;
    sl.appendChild(o);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadMaestros();

  $('#selMaquina').addEventListener('change', cargar);
  $('#selLado').addEventListener('change', cargar);
  $('#btnRefresh').addEventListener('click', cargar);

  // Botones de edición general
  $('#btnEditPlan').addEventListener('click', abrirEditBar);
  $('#btnCancelarPlan').addEventListener('click', cerrarEditBar);
  $('#btnGuardarPlan').addEventListener('click', guardarPlanGeneral);

  await cargar();
});
