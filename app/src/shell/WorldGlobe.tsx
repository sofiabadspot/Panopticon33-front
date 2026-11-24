/* Globo fotorrealista de la entrada (como la intro del prototipo de Julio, js/map-google-3d.js),
   pero en blanco y negro: CesiumJS + Google Photorealistic 3D Tiles con un filtro de grises.
   - live=false (mientras se escribe el usuario): dibuja pocas veces por segundo, solo para ir
     bajando los mosaicos del planeta sin trabar el ingreso.
   - live=true: 60 cuadros, giro lento y constante; la ficha sigue a San Salvador (cardRef, por transform).
   - go=true: un solo vuelo suavizado hasta El Salvador visto desde arriba. No baja a la ciudad:
     a esa altura los mosaicos todavía no llegan y se ven rotos; la consola toma el relevo con un fundido.
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
          creditContainer: credits.current ?? undefined, msaaSamples: 1,
        });
        const scene = viewer.scene;
        viewer.useBrowserRecommendedResolution = true;   // píxeles CSS, no los de pantalla retina
        scene.backgroundColor = C.Color.fromCssColorString('#030405');
        scene.highDynamicRange = false;
        scene.fog.enabled = false;
        if (scene.sun) scene.sun.show = false;
        if (scene.moon) scene.moon.show = false;
        // Halo en grises (la atmósfera de Cesium es azul por defecto).
        const sky = scene.skyAtmosphere;
        if (sky) { sky.show = true; sky.saturationShift = -1; sky.brightnessShift = -0.3; }
        scene.screenSpaceCameraController.enableInputs = false; // la entrada no se manipula: solo se mira

        const tileset = await C.createGooglePhotorealistic3DTileset({ key: KEY, onlyUsingWithGoogleGeocoder: true }, {
          maximumScreenSpaceError: 24,           // de lejos no hace falta más detalle; carga menos y más rápido
          skipLevelOfDetail: true, immediatelyLoadDesiredLevelOfDetail: false, progressiveResolutionHeightFraction: 0.5,
          foveatedScreenSpaceError: true, showCreditsOnScreen: true,
        });
        if (dead) return;
        scene.primitives.add(tileset);
        // Blanco y negro: luminancia con un poco de contraste; el mar queda casi negro.
        tileset.customShader = new C.CustomShader({
          lightingModel: C.LightingModel.UNLIT,
          fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
            float l = dot(material.diffuse, vec3(0.299, 0.587, 0.114));
            l = clamp((l - 0.06) * 1.35, 0.0, 1.0);
            material.diffuse = vec3(pow(l, 1.15) * 0.92); }`,
        });

        // El Salvador: solo el contorno, con un halo suave (sin relleno: de cerca se veía plano y gris).
        const ring: number[][] = (geo as any).country.features[0].geometry.coordinates[0];
        viewer.entities.add({ polyline: {
          positions: C.Cartesian3.fromDegreesArrayHeights(ring.flatMap(([lon, lat]) => [lon, lat, 3000])), width: 6,
          material: new C.PolylineGlowMaterialProperty({ glowPower: 0.22, taperPower: 1, color: C.Color.WHITE.withAlpha(0.9) }),
        } });

        // Pose inicial: América, El Salvador un poco a la izquierda del centro (como la portada).
        const cam = viewer.camera;
        cam.lookAt(C.Cartesian3.fromDegrees(-86.5, 8, 0), new C.HeadingPitchRange(0, C.Math.toRadians(-80), 10200000));
        cam.lookAtTransform(C.Matrix4.IDENTITY);

        // La ficha se mueve con transform (sin recalcular el diseño de la página en cada cuadro).
        const ss = C.Cartesian3.fromDegrees(ORIGIN.lon, ORIGIN.lat, 800);
        const occluder = new C.EllipsoidalOccluder(C.Ellipsoid.WGS84, cam.positionWC);
        const scratch = new C.Cartesian2();
        let lastT = performance.now();
        scene.preRender.addEventListener(() => {
          const now = performance.now(); const dt = Math.min(64, now - lastT); lastT = now;
          if (spin && !REDUCED) cam.rotate(C.Cartesian3.UNIT_Z, -0.0000045 * dt); // giro constante, ~1° cada 4 s
          const card = cardRef.current; if (!card) return;
          occluder.cameraPosition = cam.positionWC;
          const w = C.SceneTransforms.worldToWindowCoordinates(scene, ss, scratch);
          if (!w || !occluder.isPointVisible(ss)) { card.dataset.anchored = '0'; return; }
          const vw = window.innerWidth, narrow = vw < 700, cw = card.offsetWidth || 300;
          const x = narrow ? (vw - cw) / 2 : Math.min(Math.max(16, w.x + 28), vw - cw - 16);
          const y = narrow ? w.y + 24 : w.y - 12;
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
            viewer.targetFrameRate = undefined;
            // Un solo vuelo con aceleración y frenado suaves, sin el "salto" hacia arriba de Cesium.
            cam.flyTo({
              destination: C.Cartesian3.fromDegrees(ORIGIN.lon, ORIGIN.lat - 0.55, 260000),
              orientation: { heading: 0, pitch: C.Math.toRadians(-72), roll: 0 },
              duration: REDUCED ? 0 : 2.4,
              maximumHeight: 10500000,
              easingFunction: C.EasingFunction.CUBIC_IN_OUT,
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
