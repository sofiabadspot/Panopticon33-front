// Ritmo de la Nebulosa: los mismos tiempos y recorridos de las vistas
// (design-reference/vistas, clases .jg y .jn__*), escritos como cuentas en vez
// de animaciones CSS. El dibujo lo hace renderer.js con WebGL.
//
// Viene de jules-frontend (src/components/julesOrb/timeline.ts), donde se hizo
// primero; acá se suma el estado "listen", que Jules no usa.
//
// Cada orbe guarda en qué parte de cada ciclo va (su "fase", de 0 a 1) y la
// avanza un poquito en cada cuadro. Así, cambiar de estado solo cambia la
// velocidad y la Nebulosa no pega saltos.

/** Cuánto dura cada ciclo, en segundos, en cada estado. */
export const DURATIONS = {
  idle: { blob: [11, 13, 12, 14], halo: 7, swirl: 48, lights: 30, breath: 6 },
  listen: { blob: [3.2, 3.6, 3.4, 3.8], halo: 4.2, swirl: 60, lights: 40, breath: 3.2 },
  think: { blob: [2.42, 2.86, 2.64, 3.08], halo: 1.54, swirl: 10.56, lights: 6.6, breath: 1.6 },
  speak: { blob: [6.05, 7.15, 6.6, 7.7], halo: 3.85, swirl: 26.4, lights: 16.5, breath: 1.4 },
}

/** Recorrido de cada mancha (unidades del dibujo de 200×200): punta al 0 % y al 50 %. */
const BLOBS = {
  normal: {
    from: [[-18, -44], [48, -20], [40, 44], [-44, 38]],
    to: [[-58, -18], [30, -62], [66, 16], [-20, 66]],
  },
  // Escuchar = recibir: las manchas se recogen hacia arriba y se mueven poco (jx-ga…jx-gd).
  listen: {
    from: [[-12, -30], [14, -28], [10, 8], [-10, 10]],
    to: [[-16, -38], [18, -36], [12, 2], [-12, 4]],
  },
}

/** Pulso corto tipo "shock" de speak (jx-shock): [momento del ciclo, escala]. */
const SHOCK = [[0, 1], [0.1, 1.06], [0.28, 0.97], [0.44, 1.015], [0.6, 1], [1, 1]]

export function initialPhases() {
  return { blob: [0, 0, 0, 0], halo: 0, swirl: 0, lights: 0, breath: 0 }
}

const wrap = (x) => x - Math.floor(x)

/** Avanza `dt` segundos a la velocidad del estado. No modifica `p`. */
export function advance(p, state, dt) {
  const d = DURATIONS[state]
  return {
    blob: p.blob.map((x, i) => wrap(x + dt / d.blob[i])),
    halo: wrap(p.halo + dt / d.halo),
    swirl: wrap(p.swirl + dt / d.swirl),
    lights: wrap(p.lights + dt / d.lights),
    breath: wrap(p.breath + dt / d.breath),
  }
}

/** Ida y vuelta suave 0 → 1 → 0 en un ciclo (los keyframes 0 / 50 / 100 % con ease-in-out). */
const pingPong = (ph) => 0.5 - 0.5 * Math.cos(2 * Math.PI * ph)

/**
 * Respiración del dibujo según el estado: escala y, en listen, cuánto sube.
 * `lift` va en unidades del dibujo (en las vistas: translateY de -2 % a -4 %).
 */
export function breathTarget(state, ph) {
  if (state === 'idle') return { scale: 1 + 0.04 * pingPong(ph), lift: 0 }
  if (state === 'listen') return { scale: 0.96 + 0.02 * pingPong(ph), lift: -4 - 4 * pingPong(ph) }
  if (state === 'think') return { scale: 0.9 + 0.04 * pingPong(ph), lift: 0 }
  for (let i = 1; i < SHOCK.length; i += 1) {
    const [t1, v1] = SHOCK[i]
    if (ph <= t1) {
      const [t0, v0] = SHOCK[i - 1]
      const k = (ph - t0) / (t1 - t0)
      return { scale: v0 + (v1 - v0) * k * k * (3 - 2 * k), lift: 0 }
    }
  }
  return { scale: 1, lift: 0 }
}

/** Acerca la respiración actual a la de destino, para que el cambio de estado no salte. */
export function smoothBreath(current, target, dt) {
  const k = Math.min(1, dt / 0.12)
  return {
    scale: current.scale + (target.scale - current.scale) * k,
    lift: current.lift + (target.lift - current.lift) * k,
  }
}

/** Los valores para dibujar un cuadro. */
export function frameAt(p, state, breath) {
  const listening = state === 'listen'
  const path = listening ? BLOBS.listen : BLOBS.normal
  const h = pingPong(p.halo)
  return {
    swirl: p.swirl * 2 * Math.PI,
    lights: p.lights * 2 * Math.PI,
    breath: breath.scale,
    lift: breath.lift,
    // Escuchando, el halo se queda quieto y la luz lima se apaga (tonos fríos).
    haloScale: listening ? 1 : 1 + 0.1 * h,
    haloAlpha: listening ? 0.4 : 0.3 + 0.35 * h,
    limeAlpha: listening ? 0.3 : 1,
    blobs: p.blob.flatMap((ph, i) => {
      const e = pingPong(ph)
      return [0, 1].map((k) => path.from[i][k] + (path.to[i][k] - path.from[i][k]) * e)
    }),
  }
}
