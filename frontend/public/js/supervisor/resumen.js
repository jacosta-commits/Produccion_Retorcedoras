// frontend/public/js/supervisor/resumen.js
import { api, fmtFull } from './_lib.js';

const $ = s => document.querySelector(s);

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
    tr.style.cursor = 'pointer'; // Indicar que es clickeable
    tr.dataset.id = p.programacion_id;

    tr.innerHTML = `
      <td>${p.otcod}</td>
      <td>${p.titulo}</td>
      <td>${fmtFull(p.inicio)}</td>
      <td>${fmtFull(p.fin)}</td>
      <td>
        <button class="btn-danger btn-sm" data-id="${p.programacion_id}">Eliminar</button>
      </td>
    `;

    // Click en la fila para ver detalle
    tr.addEventListener('click', (e) => {
      // Evitar que el click en "Eliminar" dispare la carga del detalle
      if (e.target.tagName === 'BUTTON') return;

      // Resaltar fila seleccionada
      tb.querySelectorAll('tr').forEach(r => r.classList.remove('table-active'));
      tr.classList.add('table-active');

      cargarDetalle(p.programacion_id);
    });

    // Bind delete
    const btn = tr.querySelector('button');
    btn.addEventListener('click', (e) => {
      e.stopPropagation(); // Prevenir propagación al TR
      eliminarProgramacion(p.programacion_id);
    });

    tb.appendChild(tr);
  });
}

async function cargarDetalle(id) {
  try {
    const r = await api.get(`/api/programaciones/${id}`);
    if (r.ok) {
      renderPlan({
        titulo: r.titulo,
        minutos_por_descarga: r.minutos_por_descarga,
        otcod: r.otcod,
        plan: r.plan
      });
    }
  } catch (e) {
    console.error('Error cargando detalle:', e);
    renderPlan(null);
  }
}

async function eliminarProgramacion(id) {
  if (!confirm('¿Estás seguro de eliminar esta programación y todo su plan?')) return;
  try {
    await api.delete(`/api/programaciones/${id}`);
    await cargar(); // Recargar todo
  } catch (e) {
    alert('Error al eliminar: ' + e.message);
  }
}

/* ------------------ Renderizado de Plan Detallado (Vigente) ------------------ */
function renderPlan(plan) {
  const tb = $('#tbPlan');
  tb.innerHTML = '';

  // Header Info
  $('#hdrTitulo').textContent = plan?.titulo ?? '—';
  $('#hdrTiempo').textContent = plan?.minutos_por_descarga ?? '—';
  $('#hdrOT').textContent = plan?.otcod ?? '—';

  const rows = plan?.plan || [];
  if (!rows.length) {
    tb.innerHTML = '<tr><td colspan="3" class="muted">Seleccione una programación para ver el detalle.</td></tr>';
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');

    // Convertir fecha UTC/ISO a Date
    // Asumimos que r.fh_inicio viene en ISO UTC (Z).
    // Queremos mostrar "Face Value" (lo que dice la BD, tal cual, sin restar 5h).
    // Si BD dice 12:00Z, queremos mostrar 12:00 en el input.
    // Para lograrlo, creamos una fecha local que tenga los mismos componentes que la UTC.
    const dUTC = new Date(r.fh_inicio);
    const dFace = new Date(
      dUTC.getUTCFullYear(),
      dUTC.getUTCMonth(),
      dUTC.getUTCDate(),
      dUTC.getUTCHours(),
      dUTC.getUTCMinutes()
    );

    tr.innerHTML = `
      <td>${r.secuencia}</td>
      <td>
        <input type="text" class="form-control form-control-sm input-fecha-tabla flatpickr-input" 
               data-id="${r.plan_descarga_id}" readonly="readonly">
      </td>
      <td>${fmtFull(r.fh_fin)}</td>
    `;

    // Init Flatpickr en el input
    const input = tr.querySelector('input');
    flatpickr(input, {
      defaultDate: dFace, // Pasamos el objeto Date ajustado
      enableTime: true,
      dateFormat: "d/m/Y h:i K", // Formato visual AM/PM
      time_24hr: false,
      locale: "es",
      onClose: async (selectedDates, dateStr, instance) => {
        if (!dateStr || !selectedDates.length) return;

        // Convertir la fecha seleccionada a string "YYYY-MM-DDTHH:mm" (Face Value)
        // Flatpickr selectedDates[0] es un objeto Date (local).
        // Queremos enviar "2026-01-26T10:00" tal cual se ve.
        const d = selectedDates[0];
        const pad = n => String(n).padStart(2, '0');
        const faceValue = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

        await actualizarFila(r.plan_descarga_id, faceValue);
      }
    });

    tb.appendChild(tr);
  });
}

async function actualizarFila(id, fechaFaceValue) {
  try {
    // fechaFaceValue es "2026-01-26T10:00"
    const res = await api.put(`/api/programaciones/plan/${id}`, {
      fh_inicio_plan: fechaFaceValue
    });

    if (res.ok) {
      // Recargar el detalle actual para ver los cambios recalculados
      // Necesitamos el ID de la programación padre. 
      // Lo podemos sacar de la fila seleccionada en la tabla de arriba.
      const selectedRow = document.querySelector('#tbProgramaciones tr.table-active');
      if (selectedRow && selectedRow.dataset.id) {
        await cargarDetalle(selectedRow.dataset.id);
      }
    } else {
      alert('Error al actualizar: ' + (res.error || 'Desconocido'));
    }
  } catch (e) {
    console.error(e);
    alert('Error de conexión al actualizar');
  }
}

/* ------------------ Carga de Datos ------------------ */
async function cargar() {
  const maquina_id = $('#selMaquina').value;
  const lado_id = $('#selLado').value;
  if (!maquina_id || !lado_id) return;

  try {
    // 1. Cargar lista de programaciones activas
    const activas = await api.get(`/api/programaciones/activas?maquina_id=${maquina_id}&lado_id=${lado_id}`)
      .catch(() => []);

    renderProgramaciones(activas);

    // 2. Por defecto, cargar detalle de la primera (o limpiar si no hay)
    if (activas.length) {
      // Simular click en la primera fila para cargar detalle y marcar activo
      const firstRow = $('#tbProgramaciones tr');
      if (firstRow) firstRow.click();
    } else {
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

  await cargar();
});
