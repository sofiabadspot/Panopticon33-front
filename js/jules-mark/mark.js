// Marca de Jules (Nebulosa) para la consola, sin React.
// Equivale a sentinel-front/src/components/ds/Nebulosa.jsx (sin el modo interactivo).
//
// Uso en el HTML: <span class="jg" data-jules-mark style="--jg-size:24px"></span>
// Uso desde los scripts: window.JulesMark.state('think')  → todas las marcas
//   Estados: idle (quieto) · listen (escucha) · think (piensa) · speak (habla)
import { registerOrb } from './renderer.js';

const ESTADOS = ['idle', 'listen', 'think', 'speak'];
const orbes = new Set();
let actual = 'idle';

function montar(caja) {
  if (caja.dataset.julesMounted) return;
  caja.dataset.julesMounted = '1';
  caja.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  caja.appendChild(canvas);
  const orbe = registerOrb(canvas);
  orbe.set(actual);
  orbes.add(orbe);
}

function montarTodas(raiz = document) {
  raiz.querySelectorAll('[data-jules-mark]').forEach(montar);
}

window.JulesMark = {
  mount: montarTodas,
  state(s) {
    actual = ESTADOS.includes(s) ? s : 'idle';
    orbes.forEach((o) => o.set(actual));
    document.body.dataset.jules = actual;
  },
};

montarTodas();
// Las vistas que se dibujan después (mensajes de Jules, avisos) traen marcas nuevas.
new MutationObserver(() => montarTodas()).observe(document.body, { childList: true, subtree: true });
