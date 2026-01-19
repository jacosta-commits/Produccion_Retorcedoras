// frontend/public/js/common/nav.js
(() => {
  const btn    = document.getElementById('menuBtn')  || document.getElementById('btnMenu');
  const drawer = document.getElementById('supMenu')  || document.getElementById('drawer');
  if (!btn || !drawer) return;

  if (btn.dataset.navInit === '1') return; // evita doble binding si se carga otro nav
  btn.dataset.navInit = '1';

  const open  = () => {
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
    e.stopPropagation();
    drawer.classList.contains('open') ? close() : open();
  };

  // Pointer events (mejor tap en móvil)
  btn.addEventListener('pointerup', toggle, { passive: true });

  // Teclado
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
  });

  // Cerrar con click/tap fuera
  const outside = (e) => {
    const t = e.target;
    if (!drawer.contains(t) && !btn.contains(t)) close();
  };
  document.addEventListener('pointerdown', outside, { passive: true });
  document.addEventListener('click', outside);

  // Cerrar con ESC y al hacer click en links del menú
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', close));
})();
