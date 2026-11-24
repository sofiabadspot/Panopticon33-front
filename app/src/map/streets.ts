/* Recorrido por calles.
   Con la red vial de OpenStreetMap del sector (geo.json → roads) se arma un grafo y, entre cada par
   de lecturas consecutivas, se busca el camino más corto por calle (Dijkstra). Así el recorrido de
   un vehículo sigue las calles en vez de cruzar manzanas en línea recta.
   Es una reconstrucción: el camino real entre dos cámaras no se conoce; se muestra el más probable.
   En producción lo entrega el backend (pendiente en el README). No considera sentido de las calles. */
import geo from '../data/generated/geo.json';
import type { LngLat } from '../api/types';

interface Graph { pts: LngLat[]; adj: { to: number; w: number }[][] }
let G: Graph | null = null;
const M = 111320;

function build(): Graph {
  const roads = (geo as unknown as Record<string, GeoJSON.FeatureCollection>).roads;
  const id = new Map<string, number>(); const pts: LngLat[] = []; const adj: { to: number; w: number }[][] = [];
  const node = (c: number[]) => { const k = `${c[0].toFixed(6)},${c[1].toFixed(6)}`; let i = id.get(k); if (i === undefined) { i = pts.length; id.set(k, i); pts.push([c[0], c[1]]); adj.push([]); } return i; };
  const kx = Math.cos((13.7 * Math.PI) / 180);
  for (const f of roads.features) {
    const g = f.geometry; const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const line of lines) for (let j = 1; j < line.length; j++) {
      const a = node(line[j - 1]), b = node(line[j]); if (a === b) continue;
      const w = Math.hypot((pts[a][0] - pts[b][0]) * kx, pts[a][1] - pts[b][1]) * M;
      adj[a].push({ to: b, w }); adj[b].push({ to: a, w });
    }
  }
  return { pts, adj };
}

function nearest(g: Graph, p: LngLat): number {
  const kx = Math.cos((p[1] * Math.PI) / 180); let best = 0, bd = Infinity;
  for (let i = 0; i < g.pts.length; i++) { if (!g.adj[i].length) continue; const d = ((g.pts[i][0] - p[0]) * kx) ** 2 + (g.pts[i][1] - p[1]) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}

/** Camino más corto por calle entre dos nodos (Dijkstra con montículo binario). */
function shortest(g: Graph, s: number, t: number): number[] | null {
  const n = g.pts.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1);
  const heap: [number, number][] = []; const push = (d: number, v: number) => { heap.push([d, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  dist[s] = 0; push(0, s);
  while (heap.length) {
    const [d, v] = pop(); if (d > dist[v]) continue; if (v === t) break;
    for (const e of g.adj[v]) { const nd = d + e.w; if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = v; push(nd, e.to); } }
  }
  if (!isFinite(dist[t])) return null;
  const out: number[] = []; for (let v = t; v !== -1; v = prev[v]) out.push(v); return out.reverse();
}

const cache = new Map<string, { path: LngLat[]; stopAt: number[] }>();
/** Recorrido por calles que pasa por todas las paradas en orden. `stopAt[k]` = índice de la parada k en `path`. */
export function streetRoute(stops: LngLat[]): { path: LngLat[]; stopAt: number[] } {
  const key = JSON.stringify(stops); const hit = cache.get(key); if (hit) return hit;
  if (!G) G = build();
  const path: LngLat[] = [stops[0]]; const stopAt = [0];
  for (let k = 1; k < stops.length; k++) {
    const a = nearest(G, stops[k - 1]), b = nearest(G, stops[k]);
    const nodes = a === b ? [] : shortest(G, a, b);
    // Desde la cámara a la calle, por la calle, y de la calle a la siguiente cámara. Sin camino: tramo recto.
    if (nodes) for (const v of nodes) path.push(G.pts[v]);
    path.push(stops[k]); stopAt.push(path.length - 1);
  }
  const res = { path, stopAt }; cache.set(key, res); return res;
}
