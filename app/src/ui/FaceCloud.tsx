/* Reconstrucción 3D de un perfil, dibujada como nube de puntos que gira despacio.
   Representa el modelo que el SpotBox ya tiene de la persona (afinado con cada detección confirmada):
   es una ayuda para comparar, no prueba de identidad. Sin dependencias: canvas 2D con una proyección
   en perspectiva. Con "reducir movimiento" queda quieta, de tres cuartos. */
import { useEffect, useRef } from 'react';

/** Puntos de una cabeza genérica (x, y, z en -1..1), con nariz, cuencas de los ojos, mentón y cuello. */
function headPoints(seed: number): Float32Array {
  let s = seed || 1; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  const out: number[] = [];
  const N = 1700, ga = Math.PI * (3 - Math.sqrt(5));
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

export function FaceCloud({ seed, label }: { seed: number; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    const pts = headPoints(seed);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ink = getComputedStyle(cv).color || '#ddd';
    let raf = 0, t0 = performance.now();
    const draw = (now: number) => {
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = cv.clientWidth, H = cv.clientHeight;
      if (!W || !H) { if (!still) raf = requestAnimationFrame(draw); return; }
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
      // Gira de un lado al otro (±40°), como un escaneo, en vez de dar vueltas completas.
      const yaw = still ? 0.5 : Math.sin((now - t0) / 2600) * 0.7, cy = Math.cos(yaw), sy = Math.sin(yaw), tilt = -0.08;
      const sc = Math.min(W, H) * 0.36, cx = W / 2, cyy = H * 0.46, cam = 3.2;
      ctx.fillStyle = ink;
      for (let i = 0; i < pts.length; i += 3) {
        const x0 = pts[i], y0 = pts[i + 1], z0 = pts[i + 2];
        const x = x0 * cy + z0 * sy, z1 = -x0 * sy + z0 * cy;
        const y = y0 * Math.cos(tilt) - z1 * Math.sin(tilt), z = y0 * Math.sin(tilt) + z1 * Math.cos(tilt);
        const p = cam / (cam - z);
        ctx.globalAlpha = Math.max(0.08, Math.min(0.9, 0.25 + z * 0.55));
        ctx.fillRect(cx + x * sc * p, cyy - y * sc * p, 1.3, 1.3);
      }
      ctx.globalAlpha = 1;
      if (!still) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    // Quieta, se redibuja si cambia el tamaño del panel (si no, quedaría vacía o deformada).
    const ro = new ResizeObserver(() => { if (still) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } });
    ro.observe(cv);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [seed]);
  return <canvas ref={ref} className="face-cloud" role="img" aria-label={label} />;
}
