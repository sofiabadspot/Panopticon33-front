/* Jules en la columna derecha. Agente con autonomía acotada (julesAgent.ts): hace solo lo reversible,
   propone lo que mueve policías y lo hace con aprobación.
   Diseño e interacciones: los de Sync (src/jules, copia de sync-front/src/components/jules).
   Acá va solo lo propio de Panóptico 33:
   · Para mando: saludo con el nombre y, debajo, la lectura del momento, lo que propone, lo que ya hizo
     y lo que vigila (runAgent),
     arriba de la charla; en la bienvenida maximizada, el saludo es el título y el resumen va
     debajo del campo.
   · Los demás roles: una intro con lo que se le puede preguntar.
   · Las respuestas salen de answerJules (c.askJules) y sus botones abren fichas o paneles. */
import { useEffect } from 'react';
import { Jules } from '../../jules/Jules';
import type { AccionJules } from '../../jules/store';
import { JULES_SUGGESTIONS } from '../jules';
import { agentTick, type Look } from '../julesAgent';
import { AgentFeed } from './AgentFeed';
import { useConsole } from '../ctx';
import { useApi } from '../../api';
import { useSession } from '../../shell/session';
import { usePermissions } from '../permissions';

/** Nombre de pila (sin títulos abreviados como "Cmdte."). */
const firstName = (name: string) => name.split(' ').filter((w) => !/\.$/.test(w))[0] ?? name;
function greeting(now = new Date()) {
  const h = Number(now.toLocaleString('en-US', { timeZone: 'America/El_Salvador', hour: 'numeric', hour12: false }));
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

export function JulesSheet({ docked = false }: { docked?: boolean }) {
  const c = useConsole();
  const { user, role } = useSession();
  const perm = usePermissions();
  const alerts = useApi((s) => s.alerts); const zs = useApi((s) => s.zoneStatus); const cams = useApi((s) => s.cameras);
  // Lo que Jules hace solo (reversible) corre fuera del render, cada vez que cambian los datos.
  // El agente corre mientras Jules está en el lateral (no como ficha), y solo si el rol tiene a Jules.
  useEffect(() => { if (docked && perm.jules) agentTick(role); }, [alerts, zs, cams, role, docked, perm.jules]);
  const nombre = firstName(user.name);
  const saludo = `${greeting()}, ${nombre}.`;
  const go = (a: AccionJules | Look) => { if (a.panel) c.setPanel(a.panel); if (a.sheet) c.open(a.sheet); };
  // En el lateral: Jules trabajando en vivo (revisa, encuentra, propone, responde y sigue).
  const resumen = <AgentFeed user={user} saludo={saludo} onLook={go} />;

  const mando = docked;
  return (
    <Jules
      store={c.jules}
      nombre={nombre}
      intro={mando
        ? <section className="jbrief svx-entrar">{resumen}</section>
        : 'Pregúntame por el estado de las zonas, la presencia policial, las alertas o una placa. Las decisiones siguen siendo tuyas.'}
      saludo={mando ? saludo : undefined}
      tarjetas={mando ? <section className="jbrief">{resumen}</section> : undefined}
      preguntas={JULES_SUGGESTIONS}
      placeholder="Pregúntale a Jules"
      onPreguntar={c.askJules}
      onAccion={go}
      onCerrar={docked ? undefined : c.close}
    />
  );
}
