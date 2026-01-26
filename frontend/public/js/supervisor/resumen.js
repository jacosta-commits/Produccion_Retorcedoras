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
    tr.innerHTML = `
      <td>${p.otcod}</td>
      <td>${p.titulo}</td>
      <td>${fmtFull(p.inicio)}</td>
      <td>${fmtFull(p.fin)}</td>
      <td>
        <button class="btn-danger btn-sm" data-id="${p.programacion_id}">Eliminar</button>
      </td>
    `;

    // Bind delete
    const btn = tr.querySelector('button');
    btn.addEventListener('click', () => eliminarProgramacion(p.programacion_id));

    tb.appendChild(tr);
  });
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
    tb.innerHTML = '<tr><td colspan="3" class="muted">Sin plan vigente seleccionado.</td></tr>';
    return;
  }

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.secuencia}</td>
      <td>${fmtFull(r.fh_inicio)}</td>
      <td>${fmtFull(r.fh_fin)}</td>
    `;
    tb.appendChild(tr);
  });
}

/* ------------------ Carga de Datos ------------------ */
async function cargar() {
  const maquina_id = $('#selMaquina').value;
  const lado_id = $('#selLado').value;
  if (!maquina_id || !lado_id) return;

  try {
    // 1. Cargar lista de programaciones activas
    const activas = await api.get(`/api/programaciones/activas?maquina_id=${maquina_id}&lado_id=${lado_id}`)
      .catch(() => []); // Si falla, asumimos vacío para no romper todo

    renderProgramaciones(activas);

    // 2. Cargar detalle del plan vigente (el que se está ejecutando o el último)
    // Reutilizamos el endpoint existente que ya trae el plan detallado
    const vigente = await api.get(`/api/programaciones/vigente?maquina_id=${maquina_id}&lado_id=${lado_id}`);

    if (vigente.ok && vigente.programacion_id) {
      // Necesitamos info extra que 'vigente' no trae completa en el root (titulo, mins), 
      // pero podemos inferirla o modificar el endpoint.
      // Por ahora, usaremos lo que hay. Si falta info en el header, se verá '—'.
      // Nota: El endpoint 'vigente' actual devuelve { ok, programacion_id, otcod, plan: [...] }
      // Para mostrar Título y Minutos en el header, idealmente el endpoint debería devolverlos.
      // Si no, los sacamos de la lista de activas si coincide el ID.

      const match = activas.find(a => a.programacion_id === vigente.programacion_id);
      const info = {
        otcod: vigente.otcod,
        plan: vigente.plan,
        titulo: match?.titulo, // Enriquecer con lo que trajimos de 'activas'
        minutos_por_descarga: match ? Math.round((new Date(match.fin) - new Date(match.inicio)) / 60000 / vigente.plan.length) : '?'
        // Calculo aproximado o '?' si no coincide. 
        // Mejor sería que el backend /vigente devuelva todo, pero para no tocar tanto backend ahora:
      };
      renderPlan(info);
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
