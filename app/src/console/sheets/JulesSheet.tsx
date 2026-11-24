/* Jules en la columna derecha (fase 2: consulta y recomienda, no ejecuta).
   Diseño e interacciones: los de Sync (src/jules, copia de sync-front/src/components/jules).
   Acá va solo lo propio de Panóptico 33:
   · Para mando: saludo con el nombre de la persona y el resumen del momento (julesBriefing),
     arriba de la charla; en la bienvenida maximizada, el saludo es el título y el resumen va
     debajo del campo.
   · Los demás roles: una intro con lo que se le puede preguntar.
   · Las respuestas salen de answerJules (c.askJules) y sus botones abren fichas o paneles. */
import { Jules } from '../../jules/Jules';
import type { AccionJules } from '../../jules/store';
import { JULES_SUGGESTIONS, julesBriefing } from '../jules';
import { useConsole } from '../ctx';
import { useApi } from '../../api';
import { useSession } from '../../shell/session';

/** Nombre de pila (sin títulos abreviados como "Cmdte."). */
const firstName = (name: string) => name.split(' ').filter((w) => !/\.$/.test(w))[0] ?? name;
function greeting(now = new Date()) {
  const h = Number(now.toLocaleString('en-US', { timeZone: 'America/El_Salvador', hour: 'numeric', hour12: false }));
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
}

export function JulesSheet({ docked = false }: { docked?: boolean }) {
  const c = useConsole();
  const { user, role } = useSession();
  useApi((s) => s.alerts); useApi((s) => s.zoneStatus); // el resumen se actualiza con los datos en vivo
  const brief = julesBriefing(role);
  const nombre = firstName(user.name);
  const saludo = `${greeting()}, ${nombre}.`;

  const go = (a: AccionJules) => { if (a.panel) c.setPanel(a.panel); if (a.sheet) c.open(a.sheet); };

  const resumen = (
    <>
      <p className="jlead">{brief.lead}</p>
      <ul className="jpoints svx-escalonado">
        {brief.points.map((p, i) => (
          <li key={i} className={p.tone}>
            <i aria-hidden /><span>{p.text}</span>
            {p.action && <button className="linklike" onClick={() => go(p.action!)}>{p.action.label}</button>}
          </li>
        ))}
      </ul>
    </>
  );

  const mando = role === 'command';
  return (
    <Jules
      store={c.jules}
      nombre={nombre}
      intro={mando
        ? <section className="jbrief svx-entrar"><h3 className="jules-saludo">{saludo}</h3>{resumen}</section>
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
