/* Recorrido de hoy de una persona sobre el mapa: cada detección es su captura en el lugar de la cámara
   que la tomó, numerada en orden de hora, y una línea las une. Sirve para evaluar de un vistazo si es la
   misma persona (dónde, cuándo y cómo se ve en cada punto). Tocar una captura la abre grande (sin imágenes ficticias: un recuadro reservado). */
import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { hhmm, pct } from '../../api/format';
import type { FacialDetection } from '../../api/facial';
import { baseStyle } from '../../map/MapView';

export function FaceTrail({ dets, onOpen }: { dets: FacialDetection[]; onOpen: (i: number) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const open = useRef(onOpen); open.current = onOpen;
  useEffect(() => {
    if (!el.current || !dets.length) return;
    const pts = dets.map((d) => [d.lon, d.lat] as [number, number]);
    const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
    const map = new maplibregl.Map({ container: el.current, style: baseStyle(), bounds: b, fitBoundsOptions: { padding: 70, maxZoom: 16 }, attributionControl: false });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.on('load', () => {
      map.addSource('trail', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } } });
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--status-positive').trim() || '#4ade80';
      map.addLayer({ id: 'trail', type: 'line', source: 'trail', paint: { 'line-color': accent, 'line-width': 2, 'line-dasharray': [2, 2] } });
    });
    const marks = dets.map((d, i) => {
      const div = document.createElement('button');
      div.type = 'button';
      div.className = `ft-mk ${i === dets.length - 1 ? 'last' : ''}`;
      div.setAttribute('aria-label', `Captura ${i + 1}: ${hhmm(d.at)}, ${d.cameraId}, ${pct(d.score)}`);
      div.innerHTML = `<i class="ft-ph"></i><span><b>${i + 1}</b> ${hhmm(d.at)} · ${Math.round(d.score * 100)}%</span>`;
      div.addEventListener('click', () => open.current(i));
      return new maplibregl.Marker({ element: div, anchor: 'bottom' }).setLngLat(pts[i]).addTo(map);
    });
    return () => { marks.forEach((mk) => mk.remove()); map.remove(); };
  }, [dets]);
  return <div className="ft" ref={el} />;
}
