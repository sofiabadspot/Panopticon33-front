import type { AlertKind, CameraStatus, Coverage, DispatchStatus, ReviewStatus, Role, Severity, UnitStatus } from './types';

/* Etiquetas visibles. Glosario de la ontología: "Aglomeración" = crowding, etc. */

export const ROLE_LABEL: Record<Role, string> = {
  command: 'Mando',
  operator_911: 'Operador 911',
  analyst: 'Analista',
  admin: 'Administrador',
};

export const KIND_LABEL: Record<AlertKind, string> = {
  aglomeracion: 'Aglomeración',
  brecha_presencia: 'Falta policía',
  placa_en_lista: 'Placa en lista',
  persona_en_lista: 'Persona en lista',
  camara_caida: 'Cámara caída',
};

/** Qué pasó, en palabras simples (para quien tiene que decidir). La medición técnica va en el detalle. */
export const KIND_PHRASE: Record<AlertKind, string> = {
  aglomeracion: 'Hay más gente de la que la zona soporta',
  brecha_presencia: 'Faltan policías para la gente que hay',
  placa_en_lista: 'Pasó un vehículo con reporte',
  persona_en_lista: 'Pasó una persona de una lista',
  camara_caida: 'Una cámara dejó de transmitir',
};

export const KIND_ICON: Record<AlertKind, string> = {
  aglomeracion: 'groups',
  brecha_presencia: 'local_police',
  placa_en_lista: 'directions_car',
  persona_en_lista: 'face',
  camara_caida: 'videocam_off',
};

export const SEVERITY_LABEL: Record<Severity, string> = { critica: 'Crítica', media: 'Media', baja: 'Baja' };
export const SEVERITY_RANK: Record<Severity, number> = { critica: 0, media: 1, baja: 2 };
/** Tiempo objetivo para que el 911 decida, por criticidad (minutos). Propuesta inicial, a validar con
    Gerardo; después se configura en Reglas y umbrales. Pasado este tiempo la alerta muestra su atraso. */
export const SEVERITY_TARGET_MIN: Record<Severity, number> = { critica: 2, media: 5, baja: 15 };

export const REVIEW_LABEL: Record<ReviewStatus, string> = { por_revisar: 'Por revisar', confirmada: 'Confirmada', descartada: 'Descartada' };

export const DISPATCH_LABEL: Record<DispatchStatus, string> = { en_camino: 'Unidades en camino', en_lugar: 'Unidades en el lugar' };

export const CAMERA_LABEL: Record<CameraStatus, string> = { operativa: 'Operativa', degradada: 'Degradada', caida: 'Caída', fuera_de_preset: 'Fuera de preset' };

export const UNIT_LABEL: Record<UnitStatus, string> = { disponible: 'Disponible', en_servicio: 'En servicio', sin_reporte: 'Sin reporte reciente', desconocida: 'Estado desconocido' };

export const COVERAGE_LABEL: Record<Coverage, string> = { medida: 'Medida', sin_cobertura: 'Sin medición', sin_datos: 'Sin dato' };

/** Motivos de descarte: lista corta, un clic. Alimentan el ajuste de umbrales. */
export const DISCARD_REASONS = [
  'Falsa detección',
  'Lectura de placa errónea',
  'Duplicada de otra alerta',
  'Situación normal o autorizada',
  'Cámara fuera de preset',
] as const;

export const SEARCH_REASONS = [
  'Investigación de robo de vehículo',
  'Seguimiento de alerta confirmada',
  'Solicitud de la Fiscalía',
  'Requerimiento judicial',
] as const;
