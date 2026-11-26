import { useMemo } from 'react';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { SEVERITY_RANK, SEVERITY_TARGET_MIN } from '../api/labels';
import type { Alert, LngLat } from '../api/types';

/** Severidad más alta de las alertas abiertas (por revisar o confirmadas sin cerrar) de cada zona. */
export function useZoneSeverity(alerts: Alert[]) {
  return useMemo(() => {
    const m = new Map<string, 'critica' | 'media'>();
    for (const a of alerts) {
      // Solo aglomeración y falta de policía colorean una zona; una placa no dice nada de la multitud.
      if (!a.zoneId || !(a.review === 'por_revisar' || a.dispatch === 'en_camino') || (a.kind !== 'aglomeracion' && a.kind !== 'brecha_presencia')) continue;
      if (a.severity === 'baja') continue;
      const cur = m.get(a.zoneId);
      if (!cur || SEVERITY_RANK[a.severity] < SEVERITY_RANK[cur]) m.set(a.zoneId, a.severity);
    }
    return (id: string) => m.get(id) ?? null;
  }, [alerts]);
}

/** Orden de la bandeja: primero las que se pasaron de su tiempo objetivo (la más atrasada arriba); después
    las demás por criticidad y por lo que les falta para vencer. Así el orden y el borde de tiempo dicen lo mismo. */
/** Desde cuándo espera la decisión del 911. Una placa o una persona que vuelve a pasar por una cámara es
    información nueva que hay que mirar: la espera arranca de nuevo con la última lectura o detección.
    En las demás (aglomeración, falta de policía, cámara) cuenta desde que se creó: una medición más
    de lo mismo no reinicia el reloj. */
export const waitingSince = (a: Alert) =>
  a.kind === 'placa_en_lista' && a.sightings?.length ? a.sightings[a.sightings.length - 1].at
    : a.kind === 'persona_en_lista' ? a.updatedAt : a.createdAt;
export const deadlineOf = (a: Alert) => waitingSince(a) + SEVERITY_TARGET_MIN[a.severity] * 60000;
export const byUrgency = (a: Alert, b: Alert) => {
  const now = Date.now(), la = deadlineOf(a) < now, lb = deadlineOf(b) < now;
  if (la !== lb) return la ? -1 : 1;
  return (la ? 0 : SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]) || deadlineOf(a) - deadlineOf(b);
};

export function boundsOf(points: LngLat[], pad = 0.0008): LngLatBoundsLike {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [[Math.min(...xs) - pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.max(...ys) + pad]];
}
