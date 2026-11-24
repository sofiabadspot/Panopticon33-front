/* Globo fotorrealista de la entrada: el mismo del prototipo de Julio (js/map-google-3d.js), en React.
   CesiumJS + Google Photorealistic 3D Tiles con el filtro nocturno del prototipo.
   - live=false (mientras se escribe el usuario): dibuja pocas veces por segundo, solo para ir bajando los mosaicos.
   - live=true: 60 cuadros y el balanceo lento; se arrastra para girar y la rueda acerca; la ficha sigue a San Salvador.
   - go=true: el vuelo del prototipo hasta El Salvador; la consola toma el relevo con un fundido.
   Sin clave de Google, o si Cesium no carga, avisa con onStatus('fail') y la entrada usa el globo dibujado.
   Condiciones de Google: atribución y logo siempre visibles (.globe-credits); no se guarda nada de los mosaicos. */
import { useEffect, useRef, type RefObject } from 'react';
import geo from '../data/generated/geo.json';
import { ORIGIN } from '../api/seed';

const KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
const VERSION = '1.146.0';
const BASE = `https://cdn.jsdelivr.net/npm/cesium@${VERSION}/Build/Cesium/`;
const REDUCED = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global { interface Window { Cesium?: any; CESIUM_BASE_URL?: string } }

let loading: Promise<any> | null = null;
function loadCesium(): Promise<any> {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (loading) return loading;
  loading = new Promise((ok, fail) => {
    window.CESIUM_BASE_URL = BASE;
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = BASE + 'Widgets/widgets.css'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = BASE + 'Cesium.js'; s.async = true;
    s.onload = () => (window.Cesium ? ok(window.Cesium) : fail(new Error('Cesium no quedó disponible')));
    s.onerror = () => { loading = null; fail(new Error('No se pudo cargar Cesium')); };
    document.head.appendChild(s);
  });
  return loading;
}

type Props = {
  live: boolean;                                // en pantalla: animación completa
  go: boolean;                                  // true: empieza el vuelo de entrada
  cardRef: RefObject<HTMLElement | null>;       // ficha que sigue a San Salvador
  onStatus: (s: 'ok' | 'fail') => void;         // 'ok' cuando ya se ve el planeta
  onArrived: () => void;                        // terminó el vuelo
};

type Api = { fly: (done: () => void) => void; setLive: (v: boolean) => void };

export function WorldGlobe({ live, go, cardRef, onStatus, onArrived }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const credits = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const cb = useRef({ onStatus, onArrived, live });
  cb.current = { onStatus, onArrived, live };

  useEffect(() => {
    if (!KEY) { cb.current.onStatus('fail'); return undefined; }
    let viewer: any = null; let dead = false; let spin = false; let reported = false;
    (async () => {
      try {
        const C = await loadCesium();
        if (dead || !host.current) return;
        viewer = new C.Viewer(host.current, {
          globe: false, geocoder: false, baseLayerPicker: false, timeline: false, animation: false, homeButton: false,
          sceneModePicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false, selectionIndicator: false,
          creditContainer: credits.current ?? undefined,
        });
        const scene = viewer.scene;
        scene.backgroundColor = C.Color.fromCssColorString('#080808');
        scene.highDynamicRange = false;
        // Igual que el prototipo de Julio: se arrastra para girar y la rueda acerca (controles de Cesium sin cambios).
        viewer.cesiumWidget.screenSpaceEventHandler.removeInputAction(C.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
        const ctl = scene.screenSpaceCameraController;

        // Mismo detalle que el prototipo (error de pantalla 16, resolución completa): de lejos se ve nítido, no pixelado.
        const tileset = await C.createGooglePhotorealistic3DTileset({ key: KEY, onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: 16, showCreditsOnScreen: true });
        if (dead) return;
        scene.primitives.add(tileset);
        // Filtro nocturno del prototipo: desatura y oscurece la foto diurna (queda un azul gris de sala de control).
        tileset.customShader = new C.CustomShader({
          lightingModel: C.LightingModel.UNLIT,
          fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
            vec3 c = material.diffuse; float l = dot(c, vec3(0.299, 0.587, 0.114));
            material.diffuse = mix(vec3(l), c, 0.32) * vec3(0.40, 0.48, 0.55); }`,
        });

        // El Salvador: contorno y un tinte suave que solo se ve de lejos (como en el prototipo).
        const ring: number[][] = (geo as any).country.features[0].geometry.coordinates[0];
        const gray = C.Color.fromCssColorString('#b9b9b9');
        viewer.entities.add({ polyline: { positions: C.Cartesian3.fromDegreesArrayHeights(ring.flatMap(([lon, lat]) => [lon, lat, 2500])), width: 2.5, material: gray.withAlpha(0.95) } });
        viewer.entities.add({ polygon: {
          hierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(ring.flat())), material: gray.withAlpha(0.16),
          classificationType: C.ClassificationType.CESIUM_3D_TILE, distanceDisplayCondition: new C.DistanceDisplayCondition(60000, Number.MAX_VALUE),
        } });

        // Pose inicial: América, El Salvador un poco a la izquierda del centro (como la portada).
        const cam = viewer.camera;
        cam.lookAt(C.Cartesian3.fromDegrees(-86.5, 8, 0), new C.HeadingPitchRange(0, C.Math.toRadians(-80), 10200000));
        cam.lookAtTransform(C.Matrix4.IDENTITY);

        // La ficha se mueve con transform (sin recalcular el diseño de la página en cada cuadro).
        const ss = C.Cartesian3.fromDegrees(ORIGIN.lon, ORIGIN.lat, 800);
        const occluder = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, cam.positionWC);
        const scratch = new C.Cartesian2();
        scene.preRender.addEventListener(() => {
          // Balanceo lento del prototipo: va y vuelve, no da la vuelta.
          if (spin && !REDUCED) cam.rotate(C.Cartesian3.UNIT_Z, Math.cos(performance.now() / 9000) * 0.00022);
          const card = cardRef.current; if (!card) return;
          occluder.cameraPosition = cam.positionWC;
          const w = C.SceneTransforms.worldToWindowCoordinates(scene, ss, scratch);
          if (!w || !occluder.isPointVisible(ss)) { card.dataset.anchored = '0'; return; }
          const vw = window.innerWidth, narrow = vw < 700, cw = card.offsetWidth || 300;
          const x = narrow ? (vw - cw) / 2 : Math.min(Math.max(16, w.x + 24), vw - cw - 16);
          const y = narrow ? w.y + 24 : w.y + 18;
          card.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
          card.dataset.anchored = '1';
        });

        const setLive = (v: boolean) => {
          spin = v;
          viewer.targetFrameRate = v ? undefined : 6;   // escondido: pocas veces por segundo, solo para precargar
        };
        setLive(cb.current.live);

        const ready = () => { if (!reported && !dead) { reported = true; cb.current.onStatus('ok'); } };
        tileset.initialTilesLoaded.addEventListener(ready);
        window.setTimeout(ready, 7000);

        api.current = {
          setLive,
          fly: (done) => {
            spin = false;
            ctl.enableInputs = false; // durante el vuelo de entrada no se toca
            viewer.targetFrameRate = undefined;
            // Vuelo del prototipo hasta El Salvador visto desde arriba; la consola toma el relevo con un fundido.
            cam.flyToBoundingSphere(new C.BoundingSphere(C.Cartesian3.fromDegrees(-88.9, 13.75, 0), 1), {
              offset: new C.HeadingPitchRange(0, C.Math.toRadians(-88), 430000), duration: REDUCED ? 0 : 2.8,
              complete: done, cancel: done,
            });
          },
        };
      } catch (err) {
        console.warn('[Entrada] Globo fotorrealista no disponible:', err);
        if (!dead) cb.current.onStatus('fail');
      }
    })();
    return () => { dead = true; api.current = null; try { viewer?.destroy(); } catch { /* ya destruido */ } };
  }, [cardRef]);

  useEffect(() => { api.current?.setLive(live); }, [live]);

  useEffect(() => {
    if (!go) return;
    if (api.current) api.current.fly(() => cb.current.onArrived());
    else cb.current.onArrived();
  }, [go]);

  return (
    <div className="globe3d" aria-hidden="true">
      <div ref={host} className="globe3d-host" />
      <div ref={credits} className="globe-credits" />
    </div>
  );
}
