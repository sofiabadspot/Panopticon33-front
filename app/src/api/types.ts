/* Contrato de datos de la consola. Los nombres siguen el glosario de la ontología;
   las etiquetas en español están en src/api/labels.ts. */

export type Role = 'command' | 'operator_911' | 'analyst' | 'admin' | 'auditor';

export interface User { id: string; name: string; role: Role; territory: string; active: boolean }

export type LngLat = [number, number];

export interface Zone {
  id: string; name: string; lat: number; lon: number; areaM2: number;
  /** Capacidad de referencia (personas) fijada por el Ministerio. */
  capacity: number; ring: LngLat[]; cameras: string[];
}

/** Estado de medición de una zona. "sin_cobertura" y "sin_datos" nunca se muestran como cero. */
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
  /** Despachada por Maic: va hacia un lugar (la alerta que la convocó). Sin esto, está en su puesto. */
  enRoute?: { lat: number; lon: number; label: string; alertId?: string; since: number } | null }

export type AlertKind = 'aglomeracion' | 'brecha_presencia' | 'placa_en_lista' | 'camara_caida';
export type Severity = 'critica' | 'media' | 'baja';
export type ReviewStatus = 'por_revisar' | 'confirmada' | 'descartada';
export type MaicStatus = 'enviada' | 'recibida' | 'despachada' | 'cerrada';

export interface Evidence { type: 'clip' | 'imagen' | 'pendiente'; src?: string; poster?: string; caption: string }

export interface PlateMatch {
  read: string; listed: string; confidence: number; reason: string; caseId: string; since: string;
  vehicle: { type: string; color: string; make: string }; direction: string;
}

export interface TimelineEntry { at: number; label: string; by?: string }

export interface Alert {
  id: string; kind: AlertKind; severity: Severity; createdAt: number; updatedAt: number;
  zoneId: string | null; cameraId: string; lat: number; lon: number;
  rule: { id: string; name: string; threshold: string; measured: string; persistence: string };
  /** Mediciones repetidas de la misma zona y regla, sumadas a esta alerta. */
  observations: number;
  evidence: Evidence;
  plate?: PlateMatch;
  eventId?: string;
  review: ReviewStatus; reviewedBy?: string; discardReason?: string;
  maic: MaicStatus | null; maicId?: string;
  timeline: TimelineEntry[];
}

export interface PlateRead {
  id: string; plate: string; at: number; cameraId: string; street: string; lat: number; lon: number;
  confidence: number; normalized: boolean; listed: boolean; evidence: Evidence;
}

export interface MassEvent {
  id: string; name: string; venue: string; zoneIds: string[]; start: number; end: number;
  expected: number; plannedOfficers: number;
  /** Umbrales propios: reemplazan a los de la zona mientras dura el evento. */
  thresholds: { occupancyPct: number; perOfficer: number; persistenceMin: number } | null;
  createdBy: string;
}

export interface Rule {
  id: string; kind: AlertKind; name: string; scope: string;
  threshold: number | null; unit: string; persistenceMin: number; enabled: boolean;
  /** Los umbrales los fija el Ministerio; mientras no lo haga, el valor es un supuesto. */
  source: 'ministerio' | 'supuesto';
}

export interface WatchList {
  id: string; name: string; origin: string; mode: 'API' | 'Copia periódica';
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
