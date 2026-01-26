// frontend/public/js/supervisor/programacion.js
const $ = s => document.querySelector(s);

const api = {
  async get(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} GET ${url}`);
    return r.json();
  },
  async post(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      let msg = 'Ocurrió un error en la solicitud.';
      try {
        const j = await r.json();
        if (j?.error) msg = j.error; // Usar mensaje directo del backend si existe
      } catch {
        msg = `Error de conexión (${r.status})`;
      }
      throw new Error(msg);
    }
    return r.json();
  }
};

/* ---------- helpers fecha ---------- */
const pad = n => String(n).padStart(2, '0');
const toLocalInputValue = (dt) => {
  const d = (dt instanceof Date) ? dt : new Date(dt);
  d.setSeconds(0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtFull = (dt) => {
  const d = (dt instanceof Date) ? dt : new Date(dt);
  // FIX TIMEZONE: Mostrar valor facial UTC
  return d.toLocaleString('es-PE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  });
};
const getStart = r => r.fh_inicio ?? r.fh_inicio_plan ?? null;
const getEnd = r => r.fh_fin ?? r.fh_fin_plan ?? null;

/* ---------- estado compartido ---------- */
let ULTIMO_FIN = null;   // Date del último fin para la máquina/lado seleccionado
let MIN_X_DESC = null;   // minutos por descarga del título seleccionado (solo para mostrar)

/* ---------- carga de maestros ---------- */
async function loadMaestros() {
  // máquinas
  const maq = await api.get('/api/maestros/maquinas');
  const sM = $('#maquina_id'); sM.innerHTML = '';
  maq.forEach(m => {
    const o = document.createElement('option');
    o.value = m.maquina_id; o.textContent = m.nombre || m.codigo;
    sM.appendChild(o);
  });

  // lados
  const lados = await api.get('/api/maestros/lados');
  const sL = $('#lado_id'); sL.innerHTML = '';
  lados.forEach(l => {
    const o = document.createElement('option');
    o.value = l.lado_id; o.textContent = l.nombre;
    sL.appendChild(o);
  });

  // títulos
  const tit = await api.get('/api/titulos');
  const sT = $('#titulo_id'); sT.innerHTML = '';
  tit.forEach(t => {
    const o = document.createElement('option');
    o.value = t.titulo_id; o.textContent = `${t.nombre} (${t.minutos_por_descarga} min)`;
    o.dataset.min = t.minutos_por_descarga;
    sT.appendChild(o);
  });
  // cachea minutos x descarga del seleccionado
  $('#titulo_id').addEventListener('change', () => {
    const opt = $('#titulo_id').selectedOptions[0];
    MIN_X_DESC = opt ? parseInt(opt.dataset.min, 10) || null : null;
  });
  if (sT.options.length) {
    const opt = sT.options[sT.selectedIndex];
    MIN_X_DESC = opt ? parseInt(opt.dataset.min, 10) || null : null;
  }
}

/* ---------- estado libre/ocupado + ULTIMO_FIN ---------- */
async function checkLibre() {
  const maquina_id = $('#maquina_id').value;
  const lado_id = $('#lado_id').value;
  const badge = $('#lblPlanVigente');
  const btn = $('#btnCrear');
  const inpInicio = $('#inicio');

  try {
    const r = await api.get(`/api/programaciones/vigente?maquina_id=${maquina_id}&lado_id=${lado_id}`);

    // r.ok === false => no hay nada
    if (r?.ok === false) {
      ULTIMO_FIN = null;
      badge.textContent = 'Libre';
      btn.disabled = false;

      // min del input: ahora
      const now = new Date();
      inpInicio.min = toLocalInputValue(now);
      return { libre: true };
    }

    // Interpretamos respuesta estándar (ocupado, ultimo_fin, otcod...)
    const last = r.ultimo_fin ? new Date(r.ultimo_fin) : null;
    ULTIMO_FIN = (last && !isNaN(last)) ? last : null;

    if (r.ocupado) {
      badge.textContent = `Plan vigente: OT ${r.otcod ?? ''} · hasta ${last ? fmtFull(last) : '—'}`;
      // btn.disabled = true; // Permitimos crear si es futuro (validación en backend)
    } else {
      // Libre, pero puede existir un plan futuro → marcamos desde cuándo
      if (ULTIMO_FIN) {
        badge.textContent = `Libre desde ${fmtFull(ULTIMO_FIN)}`;
      } else {
        badge.textContent = 'Libre';
      }
      btn.disabled = false;
    }

    // Coloca un mínimo en el input para evitar iniciar antes de AHORA (permitir huecos)
    const minInicio = new Date();
    inpInicio.min = toLocalInputValue(minInicio);

    // si el valor actual es menor al mínimo (pasado), lo reajustamos
    const v = inpInicio.value ? new Date(inpInicio.value) : null;
    if (!v || (v < minInicio)) {
      inpInicio.value = toLocalInputValue(minInicio);
    }

    return { libre: !r.ocupado, last: ULTIMO_FIN, ot: r.otcod };
  } catch (e) {
    console.error(e);
    badge.textContent = '—';
    btn.disabled = false;
    ULTIMO_FIN = null;
    return { libre: true };
  }
}

/* ---------- render plan generado ---------- */
function renderPlan(plan) {
  const card = $('#cardPlan');
  const tb = $('#tbPlan');
  const fechaLbl = $('#planFecha');

  tb.innerHTML = '';
  const rows = plan || [];
  if (!rows.length) { card.hidden = true; return; }

  const first = rows[0]?.fh_inicio ?? rows[0]?.fh_inicio_plan;
  fechaLbl.textContent = first ? fmtFull(first) : '—';

  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.secuencia ?? ''}</td>
      <td>${fmtFull(getStart(r))}</td>
      <td>${fmtFull(getEnd(r))}</td>
    `;
    tb.appendChild(tr);
  });
  card.hidden = false;
}

/* ---------- submit ---------- */
async function crearProgramacion(ev) {
  ev.preventDefault();
  const btn = $('#btnCrear');
  btn.disabled = true;

  const inicio = new Date($('#inicio').value);
  const body = {
    maquina_id: parseInt($('#maquina_id').value, 10),
    lado_id: parseInt($('#lado_id').value, 10),
    otcod: $('#otcod').value.trim(),
    titulo_id: parseInt($('#titulo_id').value, 10),
    // Enviar la hora local tal cual (YYYY-MM-DDTHH:mm) para evitar conversión a UTC (+5h)
    fecha_hora_inicio: $('#inicio').value,
    descargas_programadas: parseInt($('#desc').value, 10)
  };

  try {
    // 1) Defensa en cliente: ELIMINADA para permitir huecos.
    // La validación real de solapamiento la hace el backend.

    // 2) Re-chequeo de “libre” (opcional, pero ya no bloqueante por fecha final)
    // const st = await checkLibre(); 
    // (Ya no bloqueamos aquí)

    // 3) Crear
    await api.post('/api/programaciones', body);

    // 4) Mostrar el plan vigente tras crear
    const v = await api.get(`/api/programaciones/vigente?maquina_id=${body.maquina_id}&lado_id=${body.lado_id}`);
    renderPlan(v?.plan || []);
    $('#msg').textContent = 'OK';
  } catch (e) {
    console.error('crearProgramacion ERR:', e);
    // Error típico cuando el trigger hace ROLLBACK por solape u otra regla
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

/* ---------- init ---------- */
document.addEventListener('DOMContentLoaded', async () => {
  await loadMaestros();

  // defaults
  if ($('#maquina_id').options.length) $('#maquina_id').selectedIndex = 0;
  if ($('#lado_id').options.length) $('#lado_id').selectedIndex = 0;
  if ($('#titulo_id').options.length) $('#titulo_id').selectedIndex = 0;

  // fecha por defecto
  const now = new Date(); now.setSeconds(0, 0);
  $('#inicio').value = toLocalInputValue(now);

  // eventos
  $('#frmProg').addEventListener('submit', crearProgramacion);
  $('#maquina_id').addEventListener('change', checkLibre);
  $('#lado_id').addEventListener('change', checkLibre);

  // setea estado inicial + min en el datetime-local
  await checkLibre();
});
