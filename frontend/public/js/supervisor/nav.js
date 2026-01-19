// frontend/public/js/supervisor/nav.js
(() => {
  // Soporta ambas convenciones de IDs para compatibilidad
  const btn    = document.getElementById('menuBtn')  || document.getElementById('btnMenu');
  const drawer = document.getElementById('supMenu')  || document.getElementById('drawer');
  if (!btn || !drawer) return;

  // Evita doble binding si por error se carga otro script de nav
  if (btn.dataset.navInit === '1') return;
  btn.dataset.navInit = '1';

  const open = () => {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
  };
  const toggle = (e) => {
    e.stopPropagation(); // no cerrar inmediatamente por el handler global
    drawer.classList.contains('open') ? close() : open();
  };

  // Pointer events: funcionan en mouse, touch y stylus
  btn.addEventListener('pointerup', toggle, { passive: true });

  // Accesibilidad teclado
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
  });

  // Cerrar al interactuar fuera del drawer
  const outside = (e) => {
    const t = e.target;
    if (!drawer.contains(t) && !btn.contains(t)) close();
  };
  document.addEventListener('pointerdown', outside, { passive: true });
  document.addEventListener('click', outside);

  // Cerrar con Escape
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // Cerrar al navegar por un link del menú
  drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
})();
