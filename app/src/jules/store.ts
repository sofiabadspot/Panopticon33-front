/* Estado de la charla con Jules. Vive en el contexto de la consola (ctx.tsx), así no se pierde
   cuando Jules deja el lateral (se abre una ficha) y vuelve. Sale de
   sync-front/src/components/jules/Jules.jsx (charlas por id, la activa, el estado de Jules)
   y de lugarJules.js (minimizado, maximizado y el ancho elegido, que siguen igual al cambiar
   de lo que se ve).
   Estado de Jules: idle → think (piensa DEMORA ms, con los pasos de «Pensando») → speak (escribe
   la respuesta palabra por palabra) → idle. */
import { useEffect, useMemo, useState } from 'react';
import type { PanelId, Sheet } from '../console/ctx';
import type { ComparacionProps } from './Comparacion';
import type { Dato } from './RespuestaJules';

/** Lo que tarda Jules en "pensar" (Sync: 1800 ms). */
export const DEMORA = 1800;
/** Pasos de "pensando" (un texto o una lista) que se reparten en DEMORA. */
export const PASOS = ['Pensando'];

export interface AccionJules { label: string; sheet?: Sheet; panel?: PanelId }
export interface RespuestaData { texto?: string; conclusion?: string; datos?: Dato[]; comparacion?: ComparacionProps; acciones?: AccionJules[] }
export type Mensaje =
  | { de: 'persona'; texto: string; respuesta: RespuestaData; hora: string }
  | ({ de: 'jules'; trabajo?: { segundos: number; pasos: string[] }; hora?: string } & RespuestaData);
export type EstadoJules = 'idle' | 'think' | 'speak';

export interface JulesStore {
  charlas: Record<string, Mensaje[]>;
  activa: string;
  mensajes: Mensaje[];
  enSesion: boolean;
  estado: EstadoJules;
  /** La respuesta recién llegada (índice en la charla): es la única que se escribe de a palabras. */
  nueva: number | null;
  /** Títulos que puso la persona, por id de charla. */
  nombres: Record<string, string>;
  preguntar: (texto: string, respuesta: RespuestaData) => void;
  terminoDeEscribir: () => void;
  detener: () => void;
  abrir: (id: string) => void;
  nuevaConversacion: () => void;
  borrar: () => void;
  renombrar: (titulo: string) => void;
  minimizado: boolean; setMinimizado: (v: boolean) => void;
  maximizado: boolean; setMaximizado: (v: boolean) => void;
  /** Ancho que eligió la persona para el lateral, en px (null = el de la consola). */
  ancho: number | null; setAncho: (v: number | null) => void;
}

/** Hora para las conversaciones de esta sesión ("09:52"), en la hora de El Salvador. */
export const hora = () => new Date().toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/El_Salvador' });

export function useJulesStore(): JulesStore {
  const [charlas, setCharlas] = useState<Record<string, Mensaje[]>>({ 'sesion-1': [] });
  const [activa, setActiva] = useState('sesion-1');
  const [estado, setEstado] = useState<EstadoJules>('idle');
  const [nueva, setNueva] = useState<number | null>(null);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [minimizado, setMinimizado] = useState(false);
  const [maximizado, setMaximizado] = useState(false);
  const [ancho, setAncho] = useState<number | null>(null);
  const mensajes = useMemo(() => charlas[activa] ?? [], [charlas, activa]);
  const enSesion = activa.startsWith('sesion-');

  // Jules piensa un rato y responde; se calma cuando termina de escribir (terminoDeEscribir).
  useEffect(() => {
    if (estado !== 'think') return undefined;
    const ultima = mensajes[mensajes.length - 1];
    if (!ultima || ultima.de !== 'persona') return undefined;
    const desde = Date.now();
    const espera = setTimeout(() => {
      setNueva(mensajes.length);
      // Cuánto trabajó y por qué pasos pasó: se ve arriba de la respuesta.
      const trabajo = { segundos: Math.max(1, Math.round((Date.now() - desde) / 1000)), pasos: PASOS };
      setCharlas((todas) => ({ ...todas, [activa]: [...(todas[activa] ?? []), { de: 'jules', ...ultima.respuesta, trabajo, hora: hora() }] }));
      setEstado('speak');
    }, DEMORA);
    return () => clearTimeout(espera);
  }, [estado, mensajes, activa]);

  return useMemo<JulesStore>(() => {
    const abrir = (id: string) => {
      setActiva(id);
      setEstado('idle');
      setNueva(null);
    };
    return {
      charlas, activa, mensajes, enSesion, estado, nueva, nombres,
      preguntar: (texto, respuesta) => {
        if (estado === 'think' || !texto.trim()) return;
        setCharlas((todas) => ({ ...todas, [activa]: [...(todas[activa] ?? []), { de: 'persona', texto, respuesta, hora: hora() }] }));
        setEstado('think');
      },
      terminoDeEscribir: () => setEstado('idle'),
      // Detener: si está pensando, no responde (la pregunta queda); si está escribiendo, la
      // respuesta se muestra entera de una.
      detener: () => { setEstado('idle'); setNueva(null); },
      abrir,
      // Nueva: la actual (si tiene algo) queda en "Esta sesión".
      nuevaConversacion: () => {
        if (enSesion && !mensajes.length) { abrir(activa); return; }
        let id = `sesion-${Object.keys(charlas).filter((c) => c.startsWith('sesion-')).length + 1}`;
        if (charlas[id]) id = `sesion-${Date.now()}`;
        setCharlas((todas) => ({ ...todas, [id]: [] }));
        abrir(id);
      },
      // Borrar (solo las de esta sesión): se va de la lista y empieza una nueva.
      borrar: () => {
        const id = `sesion-${Date.now()}`;
        setCharlas((todas) => {
          const resto = { ...todas };
          delete resto[activa];
          return { ...resto, [id]: [] };
        });
        abrir(id);
      },
      // Vacío, vuelve al título automático.
      renombrar: (titulo) => {
        const limpio = titulo.trim();
        setNombres((antes) => {
          const resto = { ...antes };
          delete resto[activa];
          return limpio ? { ...resto, [activa]: limpio } : resto;
        });
      },
      minimizado, setMinimizado, maximizado, setMaximizado, ancho, setAncho,
    };
  }, [charlas, activa, mensajes, enSesion, estado, nueva, nombres, minimizado, maximizado, ancho]);
}
