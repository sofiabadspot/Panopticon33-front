import { createContext, useContext, useState, type ReactNode } from 'react';
import { audit, sessionFor } from '../api';
import type { Role, User } from '../api/types';

/* El rol define qué se ve: cada usuario ve solo sus vistas y su territorio.
   En producción el rol llega del token de Keycloak; en la demo se elige al ingresar
   (y se puede cambiar en la barra superior). La sesión se guarda en este navegador. */

const ROLES: Role[] = ['command', 'operator_911', 'analyst', 'admin'];

type SessionCtx = {
  user: User;
  role: Role;
  setRole: (r: Role) => void;
  signedIn: boolean;
  signIn: (r: Role) => void;
  signOut: () => void;
};

const Ctx = createContext<SessionCtx | null>(null);

function read<T>(key: string, fallback: T, ok: (v: string) => boolean = () => true): T {
  try { const v = localStorage.getItem(key); return v !== null && ok(v) ? (v as unknown as T) : fallback; } catch { return fallback; }
}
function write(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* sin almacenamiento */ }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>(() => read<Role>('p33.role', 'command', (v) => ROLES.includes(v as Role)));
  const [signedIn, setSignedIn] = useState<boolean>(() => read<string>('p33.session', '') === '1');
  const user = sessionFor(role).user;

  const set = (r: Role) => { write('p33.role', r); setRole(r); };
  const signIn = (r: Role) => {
    // Cada ingreso empieza limpio: el mapa con la pestaña inicial del rol y el lateral cerrado
    // (lo que haya quedado en la dirección de la sesión anterior no se reabre). Jefatura sigue
    // viendo a Jules a la derecha: no es una ficha, aparece cuando el lateral está cerrado.
    try { window.history.replaceState(null, '', `${window.location.pathname}?s=`); } catch { /* sin historial */ }
    set(r);
    write('p33.session', '1');
    setSignedIn(true);
    audit(sessionFor(r).user, 'Inicio de sesión', 'Consola', 'Ingreso a Panopticon 33');
  };
  const signOut = () => {
    audit(user, 'Cierre de sesión', 'Consola', 'Salida de Panopticon 33');
    write('p33.session', null);
    setSignedIn(false);
  };

  return <Ctx.Provider value={{ user, role, setRole: set, signedIn, signIn, signOut }}>{children}</Ctx.Provider>;
}
export function useSession() { return useContext(Ctx)!; }
