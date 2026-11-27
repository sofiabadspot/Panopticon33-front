import { StrictMode, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createBrowserRouter, Navigate } from 'react-router-dom';
import '@fontsource/ibm-plex-sans/300.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@fontsource/ibm-plex-mono/600.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './data/generated/theme.css';
import './styles/app.css';
import './styles/jules.css';
import { Console } from './console/Console';
import { IconSheet } from './views/IconSheet';
import { SessionProvider, useSession } from './shell/session';
import { Login } from './shell/Login';
import { ToastProvider } from './ui/kit';
import { ErrorBoundary } from './ui/ErrorBoundary';

// Una sola pantalla: la consola. Paneles y fichas se abren sobre el mapa (?p=…&s=…).
// El router se crea al entrar (no al cargar la página): así lee la dirección ya limpia por signIn.
const makeRouter = () => createBrowserRouter([
  { path: '/', element: <Console /> },
  // Hoja de referencia del sistema iconográfico (se revisa antes de aplicarlo al mapa)
  { path: '/iconos', element: <IconSheet /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

// Sin sesión, la pantalla de ingreso; con sesión, la consola.
function Gate() {
  const { signedIn } = useSession();
  const router = useMemo(() => (signedIn ? makeRouter() : null), [signedIn]);
  // Al entrar, la consola se monta debajo del ingreso y el ingreso se funde con ella (sin negro entre medio).
  // El ingreso avisa cuándo terminó (onDone); por las dudas, se retira solo a los 12 s.
  // showLogin sigue en true en el primer render con sesión: así el ingreso no se desmonta ni vuelve a empezar.
  const [showLogin, setShowLogin] = useState(!signedIn);
  useEffect(() => {
    if (!signedIn) { setShowLogin(true); return undefined; }
    const t = window.setTimeout(() => setShowLogin(false), 12000);
    return () => window.clearTimeout(t);
  }, [signedIn]);
  return (
    <>
      {signedIn && router && <ErrorBoundary scope="la consola" onReset={() => location.reload()} resetLabel="Recargar"><RouterProvider key="app" router={router} /></ErrorBoundary>}
      {(showLogin || !signedIn) && <div key="login" className={`login-shell ${signedIn ? 'leaving' : ''}`}><Login onDone={() => setShowLogin(false)} /></div>}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <ToastProvider>
        <Gate />
      </ToastProvider>
    </SessionProvider>
  </StrictMode>,
);
