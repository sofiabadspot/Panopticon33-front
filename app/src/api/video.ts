/* Video de las cámaras (muro de video).
   Regla de evidencia: solo material real. Las tres cámaras con clip son las de los eventos de
   tránsito del prototipo (salidas reales de Panopticon, rostros pixelados); el resto muestra el
   marcador en B/N. En producción cada mosaico es el flujo en vivo (WebRTC o HLS) del servidor de video. */
import { cameras } from './seed';

const CLIPS: Record<number, { src: string; poster: string }> = {
  14: { src: '/media/colision.mp4', poster: '/media/colision.jpg' },
  22: { src: '/media/infraccion.mp4', poster: '/media/infraccion.jpg' },
  27: { src: '/media/infraccion-2.mp4', poster: '/media/infraccion-2.jpg' },
};
const byId = new Map(Object.entries(CLIPS).map(([i, clip]) => [cameras[Number(i)]?.id, clip]));
export const cameraClip = (id: string) => byId.get(id) ?? null;
