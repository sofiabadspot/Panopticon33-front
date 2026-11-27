/* Globo fotorrealista de la entrada: el mismo del prototipo de Julio (js/map-google-3d.js), en React.
   CesiumJS + Google Photorealistic 3D Tiles con el filtro nocturno del prototipo.
   - live=false (mientras se escribe el usuario): dibuja pocas veces por segundo, solo para ir bajando los mosaicos.
   - live=true: 60 cuadros y el balanceo lento; se arrastra para girar y la rueda acerca; la ficha sigue a San Salvador.
   - go=true: vuela hasta la cámara del mapa de la consola (que ya está montada debajo). A unos 700 km de
     altura avisa el fundido (onFade) y desde ahí mueve también el mapa con la misma cámara: el descenso final
     lo termina el mapa (que carga al instante) y el relevo no tiene salto ni mosaicos borrosos.
   Sin clave de Google, o si Cesium no carga, avisa con onStatus('fail') y la entrada usa el globo dibujado.
   Condiciones de Google: atribución y logo siempre visibles (.globe-credits); no se guarda nada de los mosaicos. */
import { useEffect, useRef, type RefObject } from 'react';
import geo from '../data/generated/geo.json';
import { ORIGIN } from '../api/seed';
import { whenConsoleMap, type ConsoleMap, type MapCamera } from '../map/handoff';

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
  onFade: () => void;                           // empieza el fundido con la consola
  onArrived: () => void;                        // terminó el vuelo
};

type Api = { fly: (map: ConsoleMap | null, fade: () => void, done: () => void) => void; setLive: (v: boolean) => void };

const FLY_MS = 3600;
// El fundido empieza a ~700 km: más abajo los mosaicos fotorrealistas no llegan a bajar durante el vuelo.
const FADE_RANGE = 700000;
const GROUND = 680;              // altura aproximada del suelo en San Salvador (m), hasta medirla en los mosaicos
const EARTH = 2 * Math.PI * 6378137;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** 0 → 1 entre a y b, suave en los dos extremos. */
const smooth = (a: number, b: number, t: number) => { const x = clamp01((t - a) / (b - a)); return x * x * (3 - 2 * x); };
const inOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
const angleTo = (from: number, to: number) => ((to - from + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
/** Distancia (en píxeles de pantalla) de la cámara de MapLibre a su centro, y la escala en metros por píxel. */
const mlFocal = (c: MapCamera) => (0.5 * c.rect.height) / Math.tan(c.fov / 2);
const mlMetersPerPx = (c: MapCamera) => (EARTH * Math.cos((c.lat * Math.PI) / 180)) / (512 * Math.pow(2, c.zoom));

export function WorldGlobe({ live, go, cardRef, onStatus, onFade, onArrived }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const credits = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const cb = useRef({ onStatus, onFade, onArrived, live });
  cb.current = { onStatus, onFade, onArrived, live };

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
        const cam = viewer.camera;

        // Mismo detalle que el prototipo (error de pantalla 16, resolución completa): de lejos se ve nítido, no pixelado.
        const tileset = await C.createGooglePhotorealistic3DTileset({ key: KEY, onlyUsingWithGoogleGeocoder: true }, { maximumScreenSpaceError: 16, showCreditsOnScreen: true });
        if (dead) return;
        scene.primitives.add(tileset);
        if (import.meta.env.DEV) (window as unknown as { __globe: unknown }).__globe = viewer;
        // Filtro nocturno del prototipo: desatura y oscurece la foto diurna (queda un azul gris de sala de control).
        tileset.customShader = new C.CustomShader({
          lightingModel: C.LightingModel.UNLIT,
          fragmentShaderText: `void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
            vec3 c = material.diffuse; float l = dot(c, vec3(0.299, 0.587, 0.114));
            material.diffuse = mix(vec3(l), c, 0.32) * vec3(0.40, 0.48, 0.55); }`,
        });

        // El Salvador: contorno y un tinte suave que solo se ve de lejos (como en el prototipo).
        const ring: number[][] = (geo as any).country.features[0].geometry.coordinates[0];
        // El contorno es el de Natural Earth (simplificado): de lejos se lee bien, de cerca no sigue la costa.
        // Por eso se apaga al bajar de ~2500 km de altura y ya no está cuando la vista llega a la ciudad.
        const gray = C.Color.fromCssColorString('#b9b9b9');
        const outline = scene.primitives.add(new C.PolylineCollection());
        const line = outline.add({ positions: C.Cartesian3.fromDegreesArrayHeights(ring.flatMap(([lon, lat]) => [lon, lat, 2500])), width: 2.5,
          material: C.Material.fromType('Color', { color: gray.withAlpha(0.95) }) });
        viewer.entities.add({ polygon: {
          hierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(ring.flat())), material: gray.withAlpha(0.16),
          classificationType: C.ClassificationType.CESIUM_3D_TILE, distanceDisplayCondition: new C.DistanceDisplayCondition(1800000, Number.MAX_VALUE),
        } });
        scene.preRender.addEventListener(() => {
          const a = smooth(900000, 2500000, cam.positionCartographic.height);
          line.show = a > 0.01;
          line.material.uniforms.color.alpha = 0.95 * a;
        });

        // Pose inicial: América, El Salvador un poco a la izquierda del centro (como la portada).
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
          fly: (map, fade, done) => {
            spin = false;
            ctl.enableInputs = false; // durante el vuelo de entrada no se toca
            viewer.targetFrameRate = undefined;
            const view0 = map?.camera();
            if (!map || !view0) {
              // Sin mapa de la consola: vuelo simple hasta El Salvador.
              cam.flyToBoundingSphere(new C.BoundingSphere(C.Cartesian3.fromDegrees(-88.9, 13.75, 0), 1), {
                offset: new C.HeadingPitchRange(0, C.Math.toRadians(-88), 430000), duration: REDUCED ? 0 : 2.8, complete: done, cancel: done,
              });
              return;
            }
            const hostEl = host.current!, canvas: HTMLCanvasElement = scene.canvas;
            // En vuelo, Cesium descarta por defecto los pedidos de mosaicos mientras la cámara se mueve: se pide todo.
            tileset.cullRequestsWhileMoving = false;
            const W0 = canvas.clientWidth, H0 = canvas.clientHeight;
            // Punto de partida: lo que hay en el centro de la pantalla, con rumbo, inclinación y distancia
            // medidos desde ese punto (así el primer cuadro es idéntico al globo que se estaba viendo).
            const from = cam.pickEllipsoid(new C.Cartesian2(W0 / 2, H0 / 2)) ?? C.Ellipsoid.WGS84.scaleToGeodeticSurface(cam.positionWC, new C.Cartesian3());
            const fromGeo = C.Cartographic.fromCartesian(from);
            const local = C.Matrix4.multiplyByPoint(C.Matrix4.inverseTransformation(C.Transforms.eastNorthUpToFixedFrame(from), new C.Matrix4()), cam.positionWC, new C.Cartesian3());
            const r0 = C.Cartesian3.magnitude(local), h0 = Math.atan2(-local.x, -local.y), p0 = -Math.asin(local.z / r0);
            const focal0 = (Math.max(W0, H0) / 2) / Math.tan(cam.frustum.fov / 2);
            // El mapa de la consola no está centrado en la ventana (columnas a los lados): el lienzo del globo
            // se agranda lo justo para poder correrse hasta el centro del mapa sin dejar bordes vacíos.
            const shift = (c: MapCamera) => [c.rect.left + c.rect.width / 2 - window.innerWidth / 2, c.rect.top + c.rect.height / 2 - window.innerHeight / 2];
            const [sx0, sy0] = shift(view0);
            const mx = Math.ceil(Math.abs(sx0)) + 48, my = Math.ceil(Math.abs(sy0)) + 48;
            Object.assign(hostEl.style, { inset: `${-my}px ${-mx}px`, willChange: 'transform' });
            let ground = GROUND;
            const t0 = performance.now();
            scene.sampleHeightMostDetailed([C.Cartographic.fromDegrees(view0.lng, view0.lat)])
              .then((r: any[]) => { if (r[0] && Number.isFinite(r[0].height) && performance.now() - t0 < FLY_MS * 0.6) ground = r[0].height; })
              .catch(() => { /* sin medida: queda la aproximada */ });
            let last = view0, final: MapCamera | null = null, arrived = false;
            // Distancia por recorrer sobre el suelo (m), para repartir el desplazamiento según la altura.
            const span = Math.max(1, C.Cartesian3.distance(from, C.Cartesian3.fromDegrees(view0.lng, view0.lat)));
            const target = new C.Cartesian3(), hpr = new C.HeadingPitchRange();
            scene.preRender.addEventListener(() => {
              const t = REDUCED ? 1 : clamp01((performance.now() - t0) / FLY_MS);
              // Hasta el fundido se sigue la cámara viva del mapa (si cambian las columnas, se reajusta);
              // desde ahí queda fija, porque el mapa pasa a moverse con el globo.
              if (!final) last = map.camera() ?? last;
              const c = final ?? last;
              const u = inOut(t);
              // Cámara final: la misma que la de MapLibre, apuntando al suelo real de los mosaicos.
              const focal1 = mlFocal(c), r1 = focal1 * mlMetersPerPx(c);
              const h1 = C.Math.toRadians(c.bearing), p1 = -C.Math.toRadians(90 - c.pitch);
              const range = Math.exp(lerp(Math.log(r0), Math.log(r1), u)); // acercamiento a ritmo parejo
              // El desplazamiento depende de la altura: lo que falta recorrer es siempre una fracción de lo que se ve,
              // así el destino ya está en pantalla antes de bajar y nunca se desliza el suelo de cerca.
              const left = 1 - Math.exp(-(0.45 * Math.max(0, range - r1)) / span);
              const k = t >= 1 ? 1 : 1 - left;
              const lon = C.Math.toDegrees(fromGeo.longitude) + C.Math.toDegrees(angleTo(fromGeo.longitude, C.Math.toRadians(c.lng))) * k;
              const lat = lerp(C.Math.toDegrees(fromGeo.latitude), c.lat, k);
              C.Cartesian3.fromDegrees(lon, lat, lerp(0, ground, u), C.Ellipsoid.WGS84, target);
              // El rumbo y la inclinación de la consola llegan en el último tramo.
              hpr.heading = h0 + angleTo(h0, h1) * smooth(0.35, 1, t);
              hpr.pitch = lerp(p0, p1, smooth(0.45, 1, t));
              hpr.range = range;
              cam.lookAt(target, hpr);
              // Mismo lente que MapLibre (distancia focal en píxeles) y el centro de la imagen sobre el del mapa.
              const focal = lerp(focal0, focal1, u), cw = canvas.clientWidth, ch = canvas.clientHeight;
              cam.frustum.fov = 2 * Math.atan(Math.max(cw, ch) / 2 / focal);
              const [sx, sy] = shift(c), m = smooth(0.25, 1, t);
              hostEl.style.transform = `translate3d(${(sx * m).toFixed(1)}px, ${(sy * m).toFixed(1)}px, 0)`;
              if (!final && (hpr.range < FADE_RANGE || t >= 0.7)) { final = c; fade(); }
              if (final && !arrived) {
                // El mapa, con la misma cámara que el globo (escala medida en el centro de la imagen).
                const zoom = Math.log2((EARTH * Math.cos(C.Math.toRadians(lat))) / (512 * (hpr.range / focal)));
                map.jump(t >= 1 ? final : { lng: lon, lat, zoom: Math.max(5, zoom), pitch: Math.min(60, Math.max(0, 90 + C.Math.toDegrees(hpr.pitch))), bearing: C.Math.toDegrees(hpr.heading) });
                if (t >= 1) { arrived = true; done(); }
              }
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
    if (!go) return undefined;
    let off = false;
    const arrive = () => { if (!off) cb.current.onArrived(); };
    if (!api.current) { arrive(); return undefined; }
    // La consola se está montando debajo: se espera su mapa (un instante) para saber adónde volar.
    const fade = () => { if (!off) cb.current.onFade(); };
    whenConsoleMap(1500).then((m) => { if (off) return; if (api.current) api.current.fly(m, fade, arrive); else arrive(); });
    return () => { off = true; };
  }, [go]);

  return (
    <div className="globe3d" aria-hidden="true">
      <div ref={host} className="globe3d-host" />
      <div ref={credits} className="globe-credits" />
    </div>
  );
}
