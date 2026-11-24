/* Ingreso a Panopticon 33, en tres momentos (artefacto de marca, artboards "Pantalla de carga"
   y "Portada · Entrar al centro de mando"):
   1. Ingreso: la pantalla de carga a pantalla completa y un modal de vidrio al centro.
   2. Mundo: el globo con El Salvador encendido, la ficha del centro de mando y el botón para entrar.
   3. Entrada: el globo se acerca a El Salvador y se abre la consola.
   El rol no se elige aquí: llega de la cuenta (Keycloak) y, en la demo, se cambia dentro de la consola. */
import { useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import { useApi } from '../api';
import { Icon } from '../ui/kit';
import { BrandLockup, P33Logo } from '../ui/Logo';
import { useSession } from './session';
import { WorldGlobe } from './WorldGlobe';

type Phase = 'login' | 'loading' | 'world' | 'zoom' | 'done';

export function Login() {
  const { role, signIn } = useSession();
  const cameras = useApi((s) => s.cameras);
  const maic = useApi((s) => s.maic);
  const units = useApi((s) => s.units);
  const zones = useApi((s) => s.zones);
  const [phase, setPhase] = useState<Phase>('login');
  const [userName, setUserName] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [tried, setTried] = useState(false);
  // Globo fotorrealista en grises: se prepara desde el principio, mientras la persona escribe.
  const [globe, setGlobe] = useState<'pending' | 'ok' | 'fail'>('pending');
  const [fly, setFly] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const real = globe === 'ok';
  // La pantalla de carga se desmonta cuando el mundo ya la tapó: escondida seguía animándose y restaba cuadros.
  const [loadGone, setLoadGone] = useState(false);

  const missingUser = !userName.trim();
  const missingPass = !password;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (missingUser || missingPass || phase !== 'login') return;
    setPhase('loading');
    // "Iniciando plataforma" un instante y luego el mundo.
    window.setTimeout(() => { setPhase('world'); window.setTimeout(() => setLoadGone(true), 1200); }, 1100);
  };
  const enter = () => {
    if (phase !== 'world') return;
    setPhase('zoom');
    // Con el globo real, el vuelo hasta el sector marca el ritmo; si no, el acercamiento dibujado.
    if (real) setFly(true); else window.setTimeout(() => { setPhase('done'); signIn(role); }, 1300);
  };

  return (
    <div className={`login is-${phase} ${real ? 'globe-real' : ''}`}>
      {/* 1 · Pantalla de carga */}
      {!loadGone && <div className="login-layer login-load">
        {/* El arte se separa en dos capas fijas (base y luz). Solo gira la máscara de luz:
            así la animación va por la placa de video y no redibuja miles de puntos por cuadro. */}
        <div className="carga-stage" aria-hidden="true">
          <img className="carga-img" src="/assets/p33-carga-base.svg" alt="" />
          <div className="carga-orbit"><img className="carga-img carga-counter" src="/assets/p33-carga-luz.svg" alt="" /></div>
        </div>
        <div className="login-vignette" aria-hidden="true" />
        <p className="login-cap" aria-live="polite">{phase === 'loading' ? 'Iniciando plataforma' : 'Centro de mando'}</p>
      </div>}

      {/* 2 · Mundo. Globo real en grises si hay clave de Google; si no, el globo dibujado del artefacto
          (escenario 16:10 que cubre la pantalla, con la ficha fija junto a El Salvador). */}
      <div className="login-layer login-world" aria-hidden={phase !== 'world' && phase !== 'zoom' && phase !== 'done'}>
        {globe !== 'ok' && (
          <div className="world-stage">
            <img src="/assets/p33-mundo.jpg" alt="Globo con los continentes en puntos y El Salvador encendido" />
            {globe === 'fail' && <WorldCard cameras={cameras.length} />}
          </div>
        )}
        {globe !== 'fail' && (
          <>
            <WorldGlobe live={phase === 'world' || phase === 'zoom' || phase === 'done'} go={fly} cardRef={cardRef} onStatus={setGlobe} onArrived={() => { setPhase('done'); signIn(role); }} />
            {real && <WorldCard cameras={cameras.length} anchorRef={cardRef} />}
          </>
        )}
        {/* Portada del prototipo de Julio: firma, título, cifras, ficha sobre San Salvador, botón y línea de estado. */}
        {(phase === 'world' || phase === 'zoom') && (<>
          <header className="world-top">
            <BrandLockup size={20} />
            <h1 className="world-title">Presencia continua sobre el territorio.</h1>
            <p className="world-sub">Panopticon observa cada cámara las 24 horas, detecta lo que importa y lo convierte en acción a través de MAIC.</p>
          </header>
          <dl className="world-stats">
            {[[String(cameras.length), 'Cámaras del sector piloto'], ['24/7', 'Presencia de Panopticon'], ['1.4 s', 'De la detección a la alerta'], ['3', 'Capacidades: multitudes, placas, rostros']].map(([v, l]) => (
              <div key={l} className="world-stat"><dt>{v}</dt><dd>{l}</dd></div>
            ))}
          </dl>
          <div className="world-cta">
            <button type="button" className="btn primary lg world-go" onClick={enter} disabled={phase !== 'world'} autoFocus>
              <Icon name="radar" />Entrar al centro de mando
            </button>
            <span className="world-note">Activa el audio de la consola</span>
          </div>
          <Ticker lines={[
            maic.connected ? `MAIC conectado — ${units.length} unidades PNC visibles` : 'MAIC sin conexión',
            `Salvador del Mundo — ${cameras.length} cámaras sincronizadas`,
            `${zones.length} zonas vigiladas — conteo de personas en vivo`,
            'Lectura de placas activa',
            'SPOTBOX en sitio — 4 de 4 en línea',
          ]} live={maic.connected} />
        </>)}
      </div>

      {/* Modal de ingreso */}
      {(phase === 'login' || phase === 'loading') && (
        <main className="login-main">
          <form className="login-modal glass" onSubmit={submit} noValidate aria-busy={phase === 'loading'} aria-labelledby="lg-title">
            {/* Dentro de la tarjeta, solo el producto; la firma de SPOTVISION va debajo, fuera de la tarjeta. */}
            <div className="login-brand"><P33Logo size={24} /></div>
            <div className="login-head">
              <span className="login-kicker mono">Acceso restringido</span>
              <h1 id="lg-title">Ingresar al centro de mando</h1>
            </div>

            <div className="field">
              <label htmlFor="lg-user">Usuario</label>
              <input id="lg-user" className="fld" autoComplete="username" autoFocus value={userName}
                aria-invalid={tried && missingUser} aria-describedby={tried && missingUser ? 'lg-user-err' : undefined}
                onChange={(e) => setUserName(e.target.value)} />
              {tried && missingUser && <span id="lg-user-err" className="err"><Icon name="error" />Escribí tu usuario.</span>}
            </div>

            <div className="field">
              <label htmlFor="lg-pass">Contraseña</label>
              <div className="login-pass">
                <input id="lg-pass" className="fld" type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                  aria-invalid={tried && missingPass} aria-describedby={tried && missingPass ? 'lg-pass-err' : undefined}
                  onChange={(e) => setPassword(e.target.value)} />
                <button type="button" className="iconbtn" aria-pressed={show} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  title={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShow((s) => !s)}>
                  <Icon name={show ? 'visibility_off' : 'visibility'} />
                </button>
              </div>
              {tried && missingPass && <span id="lg-pass-err" className="err"><Icon name="error" />Escribí tu contraseña.</span>}
            </div>

            {/* Acción principal del oscuro: vidrio blanco (relleno suave, borde fino, letra blanca). */}
            <button type="submit" className="btn primary lg block login-go" disabled={phase !== 'login'}>
              {phase === 'loading' ? 'Ingresando…' : 'Ingresar'}
              {phase === 'login' && <Icon name="arrow_forward" />}
            </button>
          </form>
          <footer className="login-endorse">
            <span className="mono">Desarrollado por</span>
            <img src="/assets/logo-spotvision.png" alt="SPOTVISION" />
          </footer>
        </main>
      )}
    </div>
  );
}

/** Línea de estado de la portada: cambia de mensaje cada 3,2 s. */
function Ticker({ lines, live }: { lines: string[]; live: boolean }) {
  const [i, setI] = useState(0);
  useEffect(() => { const t = window.setInterval(() => setI((n) => n + 1), 3200); return () => window.clearInterval(t); }, []);
  return (
    <div className="world-ticker glass" aria-live="polite">
      <i className={`live-dot ${live ? '' : 'off'}`} aria-hidden="true" /><span>{lines[i % lines.length]}</span>
    </div>
  );
}

/** Ficha del centro de mando. Con anchorRef sigue a San Salvador sobre el globo real (--ax, --ay). */
function WorldCard({ cameras, anchorRef }: { cameras: number; anchorRef?: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={anchorRef} className={`world-card glass ${anchorRef ? 'anchored' : ''}`}>
      <div className="world-card-hd"><b>Centro de mando · San Salvador</b><span className="mono">POC</span></div>
      <span className="mono world-card-sub">{cameras} cámaras · Ministerio de Seguridad</span>
      <span className="mono world-card-live"><i className="live-dot" aria-hidden="true" />Panopticon 33 en línea</span>
    </div>
  );
}
