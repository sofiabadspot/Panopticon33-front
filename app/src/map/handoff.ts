/* Relevo entre el globo de la entrada y el mapa de la consola.
   Al pulsar "Entrar", la consola se monta debajo de la entrada. Su mapa publica aquí su cámara para que el
   globo vuele exactamente hasta ella (mismo centro, zoom, inclinación, rumbo y lugar en pantalla) y el
   fundido final no muestre ningún salto. En el último tramo el globo y el mapa se mueven con la misma cámara mientras se funden. */

export type MapCamera = {
  lng: number; lat: number; zoom: number;
  pitch: number; bearing: number;         // grados, como en MapLibre
  fov: number;                            // campo de visión vertical, en radianes
  rect: { left: number; top: number; width: number; height: number }; // caja del mapa en la ventana
};

export type MapView = { lng: number; lat: number; zoom: number; pitch: number; bearing: number };
/** `jump`: mueve la cámara del mapa (el tramo final del vuelo lo hacen el globo y el mapa a la par). */
export type ConsoleMap = { camera: () => MapCamera | null; jump: (v: MapView) => void };

let current: ConsoleMap | null = null;
const waiting = new Set<(m: ConsoleMap) => void>();

/** Lo llama el mapa principal de la consola al crearse; devuelve la función para retirarlo. */
export function provideConsoleMap(m: ConsoleMap): () => void {
  current = m;
  waiting.forEach((w) => w(m));
  waiting.clear();
  return () => { if (current === m) current = null; };
}

/* Lo que se entrega siempre llama al mapa vigente: si el mapa se vuelve a crear (en desarrollo React monta dos
   veces), el globo sigue hablando con el que está en pantalla y no con uno ya descartado. */
const live: ConsoleMap = {
  camera: () => current?.camera() ?? null,
  jump: (v) => current?.jump(v),
};

/** El mapa de la consola en cuanto exista (o null si no aparece a tiempo). */
export function whenConsoleMap(timeoutMs: number): Promise<ConsoleMap | null> {
  if (current) return Promise.resolve(live);
  return new Promise((ok) => {
    const w = () => { window.clearTimeout(t); ok(live); };
    const t = window.setTimeout(() => { waiting.delete(w); ok(null); }, timeoutMs);
    waiting.add(w);
  });
}
