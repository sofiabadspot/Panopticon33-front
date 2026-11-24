import { useMemo } from 'react';
import type { LngLatBoundsLike } from 'maplibre-gl';
import { SEVERITY_RANK } from '../api/labels';
import type { Alert, LngLat } from '../api/types';

/** Severidad más alta de las alertas abiertas (por revisar o confirmadas sin cerrar) de cada zona. */
export function useZoneSeverity(alerts: Alert[]) {
  return useMemo(() => {
    const m = new Map<string, 'critica' | 'media'>();
    for (const a of alerts) {
      // Solo aglomeración y brecha de presencia colorean una zona; una placa no dice nada de la multitud.
      if (!a.zoneId || a.review === 'descartada' || a.maic === 'cerrada' || (a.kind !== 'aglomeracion' && a.kind !== 'brecha_presencia')) continue;
      if (a.severity === 'baja') continue;
      const cur = m.get(a.zoneId);
      if (!cur || SEVERITY_RANK[a.severity] < SEVERITY_RANK[cur]) m.set(a.zoneId, a.severity);
    }
    return (id: string) => m.get(id) ?? null;
  }, [alerts]);
}

/** Orden de la bandeja: severidad, luego antigüedad (la más vieja primero dentro de la misma severidad). */
export const byUrgency = (a: Alert, b: Alert) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.createdAt - b.createdAt;

export function boundsOf(points: LngLat[], pad = 0.0008): LngLatBoundsLike {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return [[Math.min(...xs) - pad, Math.min(...ys) - pad], [Math.max(...xs) + pad, Math.max(...ys) + pad]];
}
