/* Reconstrucción 3D de un perfil, dibujada como nube de puntos.
   Representa el modelo que el SpotBox ya tiene de la persona (afinado con cada detección confirmada):
   es una ayuda para comparar, no prueba de identidad. Sin dependencias: canvas 2D con una proyección
   en perspectiva.
   · Chica (en la ficha): gira de un lado al otro, sola.
   · Interactiva (en el expediente): se arrastra para girarla en cualquier dirección, la rueda acerca,
     las flechas giran y 0 vuelve a la vista inicial. Puede girar sola o quedarse quieta, mostrar los
     puntos de referencia del rostro (ojos, nariz, boca, mentón…) unidos por líneas de medición, y una
     línea de escaneo que la recorre.
   Con "reducir movimiento" no gira sola ni escanea. */
import { useEffect, useRef } from 'react';

/** Puntos de una cabeza genérica (x, y, z en -1..1), con nariz, cuencas de los ojos, mentón y cuello. */
function headPoints(seed: number): Float32Array {
  let s = seed || 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out: number[] = [];
  const N = 1900, ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, rr = Math.sqrt(1 - y * y), th = ga * i;
    let x = Math.cos(th) * rr * 0.74, z = Math.sin(th) * rr * 0.86;
    const yy = y * 1.05;
    // Mentón y mandíbula: la cara se angosta hacia abajo
    if (yy < -0.2) { const k = 1 - (-0.2 - yy) * 0.55; x *= k; z *= Math.max(0.75, k); }
    // Frente de la cara (z > 0): nariz, cuencas de los ojos y labios
    if (z > 0.3) {
      const nose = Math.exp(-((x / 0.12) ** 2) - (((yy + 0.05) / 0.22) ** 2)) * 0.22;
      const eyes = Math.exp(-(((Math.abs(x) - 0.28) / 0.13) ** 2) - (((yy - 0.18) / 0.08) ** 2)) * -0.09;
      const lips = Math.exp(-((x / 0.2) ** 2) - (((yy + 0.42) / 0.05) ** 2)) * 0.04;
      z += nose + eyes + lips;
    }
    out.push(x + (rnd() - 0.5) * 0.012, yy, z + (rnd() - 0.5) * 0.012);
  }
  // Cuello
  for (let i = 0; i < 260; i++) { const a = rnd() * Math.PI * 2, h = -1.05 - rnd() * 0.5; out.push(Math.cos(a) * 0.36, h, Math.sin(a) * 0.36); }
  return new Float32Array(out);
}

/** Puntos de referencia del rostro (mismo espacio que la nube) y las medidas entre ellos. */
const LANDMARKS: { k: string; label: string; p: [number, number, number] }[] = [
  { k: 'oi', label: 'Ojo izq.', p: [-0.28, 0.19, 0.74] }, { k: 'od', label: 'Ojo der.', p: [0.28, 0.19, 0.74] },
  { k: 'fr', label: 'Frente', p: [0, 0.58, 0.72] }, { k: 'na', label: 'Nariz', p: [0, -0.06, 1.06] },
  { k: 'bi', label: 'Boca izq.', p: [-0.18, -0.42, 0.8] }, { k: 'bd', label: 'Boca der.', p: [0.18, -0.42, 0.8] },
  { k: 'me', label: 'Mentón', p: [0, -0.86, 0.56] }, { k: 'mi', label: 'Mandíbula izq.', p: [-0.55, -0.45, 0.35] }, { k: 'md', label: 'Mandíbula der.', p: [0.55, -0.45, 0.35] },
];
const LINKS: [string, string][] = [['oi', 'od'], ['oi', 'na'], ['od', 'na'], ['na', 'bi'], ['na', 'bd'], ['bi', 'bd'], ['bi', 'me'], ['bd', 'me'], ['oi', 'fr'], ['od', 'fr'], ['mi', 'me'], ['md', 'me'], ['oi', 'mi'], ['od', 'md']];

export interface FaceView { yaw: number; pitch: number; zoom: number }
/** Dónde queda cada punto de referencia en el lienzo (px), y si mira hacia la cámara. */
export type FaceAnchors = Record<string, { x: number; y: number; front: boolean }>;
export function FaceCloud({ seed, label, interactive, auto = true, landmarks, scan, resetKey, tags = true, front, sway, onAnchors }: {
  seed: number; label: string; interactive?: boolean; auto?: boolean; landmarks?: boolean; scan?: boolean; resetKey?: number;
  /** Nombre de cada punto de referencia junto al punto (en la interactiva). */
  tags?: boolean;
  /** Gira sola hasta quedar de frente (para comparar con una foto). */
  front?: boolean;
  /** Al girar sola, va y viene alrededor del frente en vez de dar la vuelta: la cara siempre se ve. */
  sway?: boolean;
  /** En cada cuadro, dónde quedan los puntos de referencia: para unir datos a la cara. */
  onAnchors?: (a: FaceAnchors) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const opts = useRef({ auto, landmarks, scan, tags, front, sway, onAnchors }); opts.current = { auto, landmarks, scan, tags, front, sway, onAnchors };
  const view = useRef<FaceView>({ yaw: 0.5, pitch: -0.08, zoom: 1 });
  useEffect(() => { view.current = { yaw: 0.5, pitch: -0.08, zoom: 1 }; }, [resetKey]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const pts = headPoints(seed);
    const still = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const css = getComputedStyle(cv);
    const ink = css.color || '#ddd', accent = css.getPropertyValue('--fc-accent').trim() || ink;
    let raf = 0, last = performance.now(), dragging = false;
    const t0 = last;
    const project = (x0: number, y0: number, z0: number, cy: number, sy: number, cp: number, sp: number) => {
      const x = x0 * cy + z0 * sy, z1 = -x0 * sy + z0 * cy;
      const y = y0 * cp - z1 * sp, z = y0 * sp + z1 * cp;
      return { x, y, z };
    };
    const draw = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
      const dt = now - last; last = now;
      if (!W || !H) { if (!still) raf = requestAnimationFrame(draw); return; }
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      const v = view.current, o = opts.current;
      // Chica: va y viene (±40°). Interactiva: gira completa, despacio, si está prendido el giro y no se arrastra.
      if (!interactive) v.yaw = still ? 0.5 : Math.sin((now - t0) / 2600) * 0.7;
      else if (o.front && !dragging) { v.yaw += (Math.round(v.yaw / (Math.PI * 2)) * Math.PI * 2 - v.yaw) * (still ? 1 : 0.12); v.pitch += (-0.08 - v.pitch) * (still ? 1 : 0.12); }
      else if (o.auto && o.sway && !dragging && !still) { const target = Math.round(v.yaw / (Math.PI * 2)) * Math.PI * 2 + Math.sin((now - t0) / 3600) * 0.6; v.yaw += (target - v.yaw) * 0.04; }
      else if (o.auto && !dragging && !still) v.yaw += dt * 0.00035;
      const cy = Math.cos(v.yaw), sy = Math.sin(v.yaw), cp = Math.cos(v.pitch), sp = Math.sin(v.pitch);
      const sc = Math.min(W, H) * 0.36 * v.zoom, cx = W / 2, cyy = H * 0.47, cam = 3.2;
      const scanY = o.scan && !still ? Math.sin((now - t0) / 1400) * 1.1 : null; // en el espacio de la cara (-1.1..1.1)
      ctx.fillStyle = ink;
      for (let i = 0; i < pts.length; i += 3) {
        const q = project(pts[i], pts[i + 1], pts[i + 2], cy, sy, cp, sp);
        const p = cam / (cam - q.z);
        const near = scanY != null && Math.abs(pts[i + 1] - scanY) < 0.035;
        ctx.globalAlpha = near ? 0.95 : Math.max(0.07, Math.min(0.85, 0.22 + q.z * 0.55));
        ctx.fillStyle = near ? accent : ink;
        const sz = near ? 1.8 : 1.3;
        ctx.fillRect(cx + q.x * sc * p, cyy - q.y * sc * p, sz, sz);
      }
      // Puntos de referencia y medidas: solo los que miran hacia la cámara.
      const P = o.landmarks || o.onAnchors ? new Map(LANDMARKS.map((l) => { const q = project(...l.p, cy, sy, cp, sp); const p = cam / (cam - q.z); return [l.k, { ...l, sx: cx + q.x * sc * p, sy: cyy - q.y * sc * p, z: q.z }]; })) : null;
      if (P) o.onAnchors?.(Object.fromEntries([...P.values()].map((L) => [L.k, { x: L.sx, y: L.sy, front: L.z >= 0 }])));
      if (o.landmarks && P) {
        ctx.strokeStyle = accent; ctx.lineWidth = 1;
        for (const [a, b] of LINKS) {
          const A = P.get(a)!, B = P.get(b)!; if (A.z < 0 || B.z < 0) continue;
          ctx.globalAlpha = 0.55; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(A.sx, A.sy); ctx.lineTo(B.sx, B.sy); ctx.stroke();
        }
        ctx.setLineDash([]);
        ctx.font = '10px "IBM Plex Mono", monospace';
        for (const L of P.values()) {
          if (L.z < 0) continue;
          ctx.globalAlpha = 1; ctx.fillStyle = accent;
          ctx.beginPath(); ctx.arc(L.sx, L.sy, 3, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(L.sx, L.sy, 6, 0, Math.PI * 2); ctx.strokeStyle = accent; ctx.stroke();
          if (interactive && o.tags) { ctx.globalAlpha = 0.85; ctx.fillStyle = ink; ctx.fillText(L.label.toUpperCase(), L.sx + 9, L.sy - 6); }
        }
      }
      ctx.globalAlpha = 1;
      if (!still || interactive) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    // Interacción: arrastrar gira, la rueda acerca, las flechas giran, 0 vuelve a la vista inicial.
    let from: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { if (!interactive) return; dragging = true; from = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!from) return; const v = view.current;
      v.yaw += (e.clientX - from.x) * 0.01; v.pitch = Math.max(-1.2, Math.min(1.2, v.pitch + (e.clientY - from.y) * 0.008));
      from = { x: e.clientX, y: e.clientY };
    };
    const up = () => { dragging = false; from = null; };
    const wheel = (e: WheelEvent) => { if (!interactive) return; e.preventDefault(); const v = view.current; v.zoom = Math.max(0.6, Math.min(2.4, v.zoom * Math.exp(-e.deltaY * 0.0015))); };
    const key = (e: KeyboardEvent) => {
      const v = view.current;
      if (e.key === 'ArrowLeft') v.yaw -= 0.15; else if (e.key === 'ArrowRight') v.yaw += 0.15;
      else if (e.key === 'ArrowUp') v.pitch = Math.max(-1.2, v.pitch - 0.12); else if (e.key === 'ArrowDown') v.pitch = Math.min(1.2, v.pitch + 0.12);
      else if (e.key === '+' || e.key === '=') v.zoom = Math.min(2.4, v.zoom * 1.15); else if (e.key === '-') v.zoom = Math.max(0.6, v.zoom / 1.15);
      else if (e.key === '0') view.current = { yaw: 0.5, pitch: -0.08, zoom: 1 };
      else return;
      e.preventDefault();
    };
    if (interactive) {
      cv.addEventListener('pointerdown', down); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
      cv.addEventListener('wheel', wheel, { passive: false }); cv.addEventListener('keydown', key);
    }
    // Quieta, se redibuja si cambia el tamaño del panel (si no, quedaría vacía o deformada).
    const ro = new ResizeObserver(() => { if (still && !interactive) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } });
    ro.observe(cv);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      cv.removeEventListener('pointerdown', down); cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up);
      cv.removeEventListener('wheel', wheel); cv.removeEventListener('keydown', key);
    };
  }, [seed, interactive]);
  return <canvas ref={ref} className={`face-cloud ${interactive ? 'is-live' : ''}`} role="img" aria-label={interactive ? `${label}. Arrastra para girar, rueda para acercar, flechas para girar, 0 para volver.` : label} tabIndex={interactive ? 0 : undefined} />;
}
