/* Configuración — administrador. Cada sección es una lista; tocar un elemento abre su ficha de edición
   (Zona, Cámara). Lugar y Eventos dejan el mapa a la vista para dibujar y ubicar;
   las tablas anchas (Reglas, Listas, Roles, Usuarios) lo tapan. Ver configTabs.ts. */
import { CameraDetail, CamerasSection, ZoneDetail, ZonesSection } from './configPlace';
import { EventsSection, ListsSection, RulesSection } from './configOps';
import { RolesSection, UsersSection } from './configSections';
import type { ConfigTab } from './configTabs';

export function ConfigSheet({ tab = 'zonas', id }: { tab?: string; id?: string }) {
  switch (tab as ConfigTab) {
    case 'camaras': return id ? <CameraDetail id={id} /> : <CamerasSection />;
    case 'eventos': return <EventsSection />;
    case 'reglas': return <RulesSection />;
    case 'listas': return <ListsSection />;
    case 'roles': return <RolesSection />;
    case 'usuarios': return <UsersSection />;
    default: return id ? <ZoneDetail id={id} /> : <ZonesSection />;
  }
}
