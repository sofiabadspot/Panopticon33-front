/* Secciones de Configuración, en el orden en que se arma el sistema:
   1. Lugar: dónde se vigila (zonas → cámaras). Por ahora hay un solo territorio, San Salvador: no se edita. Usan el mapa: la ficha deja el mapa a la vista.
   2. Operación: qué se vigila y cuándo avisar (eventos, reglas y criticidad, listas).
   3. Acceso: quién ve qué (roles, usuarios). Son tablas anchas: la ficha tapa el mapa. */
export type ConfigTab = 'zonas' | 'camaras' | 'eventos' | 'reglas' | 'listas' | 'roles' | 'usuarios';

export const CONFIG_GROUPS: { label: string; tabs: [ConfigTab, string, string][] }[] = [
  { label: 'Lugar', tabs: [['zonas', 'Zonas', 'layers'], ['camaras', 'Cámaras', 'videocam']] },
  { label: 'Operación', tabs: [['eventos', 'Eventos', 'flag'], ['reglas', 'Reglas y criticidad', 'tune'], ['listas', 'Listas', 'database']] },
  { label: 'Acceso', tabs: [['roles', 'Roles', 'shield'], ['usuarios', 'Usuarios', 'person']] },
];
export const TABS = CONFIG_GROUPS.flatMap((g) => g.tabs);

/** Secciones que se trabajan sobre el mapa: la ficha es angosta y el mapa queda visible. */
export const MAP_TABS: ConfigTab[] = ['zonas', 'camaras', 'eventos'];
