/* Contrato de datos de la consola. Los nombres siguen el glosario de la ontología;
   las etiquetas en español están en src/api/labels.ts. */

export type Role = 'command' | 'operator_911' | 'analyst' | 'admin';

export interface User { id: string; name: string; role: Role; territory: string; active: boolean }

/** Sector del territorio: agrupa zonas. Decide a qué operadores 911 les llegan sus alertas.
    "Nacional" no es un territorio: es el alcance de quien ve todo el país. */
export interface Territory { name: string; note: string }

/** Capas del mapa que se pueden dar o quitar por rol (las mismas de la franja de capas). */
export type LayerKey = 'zones' | 'events' | 'alerts' | 'units' | 'cameras' | 'hex' | 'drones' | 'helis';
/** Qué hace un rol con una capa: no la ve, la puede prender, o la ve al entrar. */
export type LayerAccess = 'oculta' | 'disponible' | 'inicio';
/** Configuración de un arquetipo. Los roles se definen primero; cada usuario hereda la de su rol,
    limitada a su territorio. */
export interface RoleConfig {
  role: Role;
  layers: Record<LayerKey, LayerAccess>;
  /** Qué alertas ve: todas, o solo las de su territorio. */
  alertScope: 'todas' | 'territorio';
  /** Con alcance "todas": desde qué criticidad (null = todas las criticidades). */
  minSeverity: Severity | null;
}

export type LngLat = [number, number];

export interface Zone {
  id: string; name: string; lat: number; lon: number; areaM2: number;
  /** Capacidad de referencia (personas) fijada por el Ministerio. */
  capacity: number; ring: LngLat[]; cameras: string[];
  /** Territorio al que pertenece: decide a qué operadores 911 les llegan sus alertas. */
  territory: string;
  /** Hexágonos H3 (HEX_RES) que la delimitan. Sin esto, salen de su contorno (zonas anteriores). */
  cells?: string[];
}

/** Estado de medición de una zona (las cámaras, no la policía). "sin_cobertura" se muestra "Sin medición": la palabra
    "cobertura" queda para la cobertura policial. "sin_cobertura" y "sin_datos" nunca se muestran como cero. */
export type Coverage = 'medida' | 'sin_cobertura' | 'sin_datos';

export interface ZoneStatus {
  zoneId: string; coverage: Coverage; updatedAt: number;
  /** Estimación central y rango. null cuando no hay medición. */
  count: number | null; low: number | null; high: number | null;
  densityPerM2: number | null; occupancy: number | null;
  /** Personas cada 2 minutos, últimos 60 min. */
  trend: (number | null)[];
  flowIn: number | null; flowOut: number | null;
  /** Unidades presentes (radio y tiempo del Ministerio). null si no hay fuente de ubicación. */
  officers: number | null; perOfficer: number | null;
}

export type CameraStatus = 'operativa' | 'degradada' | 'caida' | 'fuera_de_preset';
export interface Camera {
  id: string; street: string; lat: number; lon: number; heading: number; status: CameraStatus;
  kind: 'mixta' | 'vehicular' | 'peatonal'; ptz: boolean; presets: string[]; zoneId: string | null;
  compute: string; fps: number; lastFrameAt: number;
}

export type UnitType = 'Patrulla' | 'Motorizada' | 'A pie';
export type UnitStatus = 'disponible' | 'en_servicio' | 'sin_reporte' | 'desconocida';
export interface Unit { id: string; type: UnitType; status: UnitStatus; lat: number; lon: number; lastReportAt: number; zoneId: string | null;
  /** Placa del vehículo (las unidades a pie no tienen). Simulada hasta conectar MAIC. */
  plate?: string | null;
  /** Mandada como refuerzo: va hacia un lugar (la alerta que la convocó, o un punto). Sin esto, está en su puesto. */
  enRoute?: { lat: number; lon: number; label: string; alertId?: string; since: number } | null;
  /** Tarea asignada por su jefatura (control, custodia, traslado). Simulada hasta conectar MAIC. */
  task?: { label: string; since: number } | null }

/** persona_en_lista: reconocimiento facial en un punto de control (sale de la pestaña Personas, api/facial.ts). */
export type AlertKind = 'aglomeracion' | 'brecha_presencia' | 'placa_en_lista' | 'persona_en_lista' | 'camara_caida';
export type Severity = 'critica' | 'media' | 'baja';
export type ReviewStatus = 'por_revisar' | 'confirmada' | 'descartada';
/** Despacho de refuerzos, desde la plataforma (no Maic): unidades en camino, o ya en el lugar. */
export type DispatchStatus = 'en_camino' | 'en_lugar';

export interface Evidence { type: 'clip' | 'imagen' | 'pendiente'; src?: string; poster?: string; caption: string }

export interface PlateMatch {
  read: string; listed: string; confidence: number; reason: string; caseId: string; since: string;
  vehicle: { type: string; color: string; make: string }; direction: string;
}

/** Una lectura de la placa de una alerta: dónde, cuándo, con qué certeza y la captura de la cámara. */
export interface Sighting { at: number; cameraId: string; street: string; lat: number; lon: number; confidence: number; evidence: Evidence }

export interface TimelineEntry { at: number; label: string; by?: string }

export interface Alert {
  id: string; kind: AlertKind; severity: Severity; createdAt: number; updatedAt: number;
  zoneId: string | null; cameraId: string; lat: number; lon: number;
  rule: { id: string; name: string; threshold: string; measured: string; persistence: string };
  /** Mediciones repetidas de la misma zona y regla, sumadas a esta alerta. */
  observations: number;
  evidence: Evidence;
  plate?: PlateMatch;
  /** Placa: cada vez que una cámara volvió a leer el vehículo desde que se creó la alerta. La primera es la
      lectura que la creó y la última, dónde está ahora (es también lat, lon y cameraId de la alerta).
      Una placa en lista tiene una sola alerta abierta: las lecturas nuevas se suman acá. */
  sightings?: Sighting[];
  eventId?: string;
  review: ReviewStatus; reviewedBy?: string; discardReason?: string;
  /** Refuerzos mandados al confirmar (null: confirmada sin refuerzos, o sin confirmar). */
  dispatch: DispatchStatus | null;
  timeline: TimelineEntry[];
}

/** Incidente registrado a mano por un operador (p. ej. un robo que entra por el 911): un punto en el mapa,
    con su dirección. No es una alerta: no lo generó una regla, lo cuenta una persona. */
export type IncidentKind = 'robo' | 'rina' | 'accidente' | 'sospechoso' | 'otro';
export interface Incident { id: string; kind: IncidentKind; lat: number; lon: number; address: string; note: string; at: number; by: string }

export interface PlateRead {
  id: string; plate: string; at: number; cameraId: string; street: string; lat: number; lon: number;
  confidence: number; normalized: boolean; listed: boolean; evidence: Evidence;
}

export interface MassEvent {
  id: string; name: string; venue: string; zoneIds: string[]; start: number; end: number;
  expected: number; plannedOfficers: number;
  /** Hexágonos H3 (HEX_RES) donde ocurre: su área en el mapa. Las zonas del evento son las que tocan. */
  cells?: string[];
  /** Aforo máximo del evento (personas en todas sus zonas). null = la suma de la capacidad de sus zonas. */
  capacity: number | null;
  /** Umbrales propios: reemplazan a los de la zona mientras dura el evento. */
  thresholds: { occupancyPct: number; perOfficer: number; persistenceMin: number } | null;
  createdBy: string;
}

export interface Rule {
  id: string; kind: AlertKind; name: string; scope: string;
  /** Criticidad de las alertas que crea la regla: fija el tiempo objetivo para decidirlas. */
  severity: Severity;
  threshold: number | null; unit: string; persistenceMin: number; enabled: boolean;
  /** Los umbrales los fija el Ministerio; mientras no lo haga, el valor es un supuesto. */
  source: 'ministerio' | 'supuesto';
  /** La regla es global; una zona puede tener su propio umbral. Los eventos fijan los suyos en el evento. */
  overrides: RuleOverride[];
}
export interface RuleOverride { target: 'zona'; targetId: string; threshold: number; persistenceMin: number }

/** Lista contra la que se comparan placas o rostros. Las que vienen de otra institución se sincronizan
    solas (API o copia periódica); las de carga manual se actualizan subiendo un archivo. */
export type ListMode = 'API' | 'Copia periódica' | 'Carga manual';
export interface WatchList {
  id: string; name: string; kind: 'vehiculos' | 'personas'; origin: string; mode: ListMode;
  entries: number; lastSyncAt: number; maxAgeMin: number;
}

export interface AuditEntry { id: string; at: number; user: string; role: Role; action: string; object: string; detail: string; reason?: string }

export interface MaicLink { connected: boolean; lastMessageAt: number; mode: 'sandbox' | 'producción' }

/** Investigación del analista: parte de un hecho (dónde y cuándo) y junta lo que se fija de lo que pasó ahí. */
export interface InvNote { at: number; by: string; text: string }
export interface InvPlace { lat: number; lon: number; label: string; radiusM: number }
export interface Investigation {
  id: string; title: string;
  /** Motivo y número de caso: se dan una vez, al crearla, y cubren cada consulta que se hace dentro. */
  reason: string;
  place: InvPlace; from: number; to: number;
  createdAt: number; createdBy: string;
  /** Vehículos fijados, en el orden en que se fijaron. */
  plates: string[];
  notes: InvNote[];
}

/* ── Historia del analista ── */
export type StorySubject = { k: 'placa'; plate: string } | { k: 'persona'; matchId: string } | { k: 'sin_identificar'; faceId: string };

export interface StoryChapter {
  id: string;
  at: number;
  /** null en los antecedentes sin cámara: no son una posición observada. */
  lat: number | null;
  lon: number | null;
  place: string;
  cameraId?: string;
  confidence?: number;
  reads: number;
  evidence: Evidence[];
  source: 'sistema' | 'analista' | 'antecedente';
  addedBy?: string;
  srcLabel?: string;
  key?: boolean;
  keyLabel?: string;
  alertId?: string;
  note?: string;
  mentions?: StorySubject;
}

export interface Story {
  id: string;
  subject: StorySubject;
  title: string;
  reason: string;
  caseId?: string;
  createdAt: number;
  createdBy: string;
  invId?: string;
  window?: { from: number; to: number };
  added: StoryChapter[];
  keyOverrides: Record<string, boolean>;
}
