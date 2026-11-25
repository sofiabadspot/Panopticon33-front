/* Hexágonos pintados como imagen.
   Como polígonos del mapa eran miles de figuras que MapLibre volvía a procesar en cada cambio de zoom,
   y eso trababa el movimiento. Pintados en un lienzo, para el mapa son una sola imagen apoyada sobre
   el terreno: moverla, inclinarla o hacer zoom no cuesta nada. El lienzo se vuelve a pintar solo
   cuando cambian los datos.
   Un lienzo por franja de zoom (HEX_TIERS), del tamaño de su área (la ciudad o el sector). */
import { cellToBoundary } from 'h3-js';
import { cellsAtRes, CITY_BOUNDS, HEX_TIERS, hexGrid, hexValues, sectorBounds, zoneHexes, type Bounds, type HexData, type HexGrid, type HexMetric, type HexTier } from '../api/coverage';

/** Lado medio del hexágono por resolución H3 (m). */
const EDGE_M: Record<number, number> = { 9: 174, 10: 66, 11: 25 };
/** Píxeles del lienzo por lado de hexágono. En el sector (res 11, de cerca) 6, para que se distinga la
    forma; en la ciudad 4: el lienzo se sube entero a la placa de video cada vez que se repinta, y con 6
    el de res 10 pesaba 17 MB. */
const EDGE_CPX: Record<number, number> = { 9: 4, 10: 4, 11: 6 };
/** Lado máximo del lienzo (px): más grande no entra como textura en todas las placas de video. */
const MAX_PX = 4096;

/** Posición en Mercator (0–1), la proyección del mapa: así la imagen calza exacto con las calles. */
const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };

export interface HexLayer {
  tier: HexTier; grid: HexGrid; canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D;
  /** Esquinas del lienzo en el mapa: arriba izquierda, arriba derecha, abajo derecha, abajo izquierda. */
  coords: [[number, number], [number, number], [number, number], [number, number]];
  /** Vértices de cada celda en píxeles del lienzo (6 pares por celda) y cuántos tiene (5 en los pentágonos). */
  verts: Float32Array; nv: Uint8Array;
  /** Hay que volver a pintarlo (cambiaron los datos o la lectura). */
  dirty: boolean;
}

/** Cede el turno al navegador, para no congelar la pantalla en un trabajo largo. */
const breathe = () => new Promise<void>((r) => setTimeout(r, 0));
/** Celdas por tanda al calcular vértices: unos 30 ms de trabajo, y se cede el turno. */
const CHUNK = 4000;

/** Arma la grilla y el lienzo de una franja de zoom. Los vértices se calculan una sola vez, en tandas
    (en la franja de res 10 son ~35.000 celdas: de una vez congelaría la pantalla ~250 ms). */
export async function makeHexLayer(i: number, zones: HexData['zones']): Promise<HexLayer> {
  const tier = HEX_TIERS[i];
  const b: Bounds = tier.area === 'sector' ? sectorBounds(zones) : CITY_BOUNDS;
  const grid = hexGrid(b, tier.res);
  const x0 = mercX(b.w), x1 = mercX(b.e), y0 = mercY(b.n), y1 = mercY(b.s);
  const widthM = (b.e - b.w) * 111320 * Math.cos((((b.n + b.s) / 2) * Math.PI) / 180);
  let W = Math.ceil((widthM / EDGE_M[tier.res]) * EDGE_CPX[tier.res]), H = Math.ceil((W * (y1 - y0)) / (x1 - x0));
  const k = Math.min(1, MAX_PX / Math.max(W, H)); W = Math.max(1, Math.round(W * k)); H = Math.max(1, Math.round(H * k));
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const verts = new Float32Array(grid.cells.length * 12), nv = new Uint8Array(grid.cells.length);
  for (let c = 0; c < grid.cells.length; c++) {
    if (c && c % CHUNK === 0) await breathe();
    const bd = cellToBoundary(grid.cells[c]); nv[c] = Math.min(6, bd.length);
    for (let v = 0; v < nv[c]; v++) { const [lat, lon] = bd[v]; verts[c * 12 + v * 2] = ((mercX(lon) - x0) / (x1 - x0)) * W; verts[c * 12 + v * 2 + 1] = ((mercY(lat) - y0) / (y1 - y0)) * H; }
  }
  return { tier, grid, canvas, ctx, coords: [[b.w, b.n], [b.e, b.n], [b.e, b.s], [b.w, b.s]], verts, nv, dirty: true };
}

/** Zonas que ninguna cámara mide ahora (cámara fuera de su posición o sin video). */
export const unmeasured = (d: Pick<HexData, 'zones' | 'status'>) => d.zones.filter((z) => d.status[z.id] && d.status[z.id].coverage !== 'medida');

export interface HexColors { positive: string; alert: string; negative: string }
const rgb = (hex: string) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** Opacidad de personas y alertas según el valor: casi nada en el borde de la mancha, más al centro. */
const fade = (w: number) => { const P: [number, number][] = [[0, 0], [0.12, 0.12], [0.3, 0.3], [0.7, 0.5], [1, 0.62]]; for (let i = 1; i < P.length; i++) if (w <= P[i][0]) { const [a, oa] = P[i - 1], [b, ob] = P[i]; return oa + ((w - a) / (b - a)) * (ob - oa); } return 0.62; };
/** Color de una celda según la lectura y su valor (ver hexValues).
    · Personas y alertas: amarillo (poco) → rojo (mucho), desvaneciéndose hacia el borde.
    · Cobertura: verde (llega en FAST_MIN o menos), amarillo (hasta NEAR_MIN), rojo (más), parejo. */
function fill(m: HexMetric, v: number, c: HexColors) {
  if (m === 'cobertura') { const [r, g, b] = rgb(v === 0 ? c.positive : v === 1 ? c.alert : c.negative); return `rgba(${r},${g},${b},0.26)`; }
  const t = Math.min(1, v / 0.6), a = rgb(c.alert), z = rgb(c.negative);
  return `rgba(${Math.round(a[0] + (z[0] - a[0]) * t)},${Math.round(a[1] + (z[1] - a[1]) * t)},${Math.round(a[2] + (z[2] - a[2]) * t)},${fade(v).toFixed(3)})`;
}

/** Pinta el lienzo con la lectura y los datos actuales. Las celdas se agrupan por valor (ya viene
    redondeado) para fijar el color una vez por grupo; cada celda se rellena por separado: un solo
    trazado con miles de hexágonos tarda segundos (4.9 s para 35.000), uno por celda ~15 ms. */
export function drawHexLayer(L: HexLayer, m: HexMetric, d: HexData, colors: HexColors) {
  const v = hexValues(m, L.grid, d);
  // Zonas sin medición (ninguna cámara la mide): adentro no hay mapa de calor. Sin dato no se muestra
  // como cero; el mapa las marca con un contorno gris punteado (ver MapView). Mismas celdas que ese contorno.
  const blind = new Set(cellsAtRes(zoneHexes(unmeasured(d)), L.tier.res));
  const groups = new Map<number, number[]>();
  for (let c = 0; c < v.length; c++) if (v[c] >= 0 && !blind.has(L.grid.cells[c])) { const g = groups.get(v[c]); if (g) g.push(c); else groups.set(v[c], [c]); }
  const { ctx, verts, nv } = L;
  ctx.clearRect(0, 0, L.canvas.width, L.canvas.height);
  for (const [val, cells] of groups) {
    ctx.fillStyle = fill(m, val, colors);
    for (const c of cells) {
      const o = c * 12; ctx.beginPath(); ctx.moveTo(verts[o], verts[o + 1]);
      for (let k = 1; k < nv[c]; k++) ctx.lineTo(verts[o + k * 2], verts[o + k * 2 + 1]);
      ctx.closePath(); ctx.fill();
    }
  }
  L.dirty = false;
}
