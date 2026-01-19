// /js/common/theme.js
const THEME_KEY = 'ret_theme';

function getInitialTheme(){
  // 1) Si el usuario ya eligió, usarlo
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'light' || saved === 'dark') return saved;

  // 2) Si el HTML tiene data-theme, respetarlo
  const attr = document.documentElement.getAttribute('data-theme');
  if (attr === 'light' || attr === 'dark') return attr;

  // 3) Si no, seguir preferencia del sistema
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  const btn = document.getElementById('theme-toggle');
  if (btn){
    btn.textContent = t === 'dark' ? '☀️' : '🌙';
    btn.setAttribute('aria-label', t === 'dark' ? 'Cambiar a claro' : 'Cambiar a oscuro');
  }
}

// Aplica tema inicial
let current = getInitialTheme();
applyTheme(current);

// Si el usuario no ha elegido aún, sincroniza con el sistema al cambiar
const media = window.matchMedia('(prefers-color-scheme: dark)');
if (!localStorage.getItem(THEME_KEY)) {
  media.addEventListener('change', e => {
    applyTheme(e.matches ? 'dark' : 'light');
  });
}

// Toggle con el botón
window.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
  });
});
