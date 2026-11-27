/* Jules en la columna derecha de la consola. Copia de sync-front/src/components/jules/Jules.jsx
   (mismo diseño e interacciones), adaptada a Panóptico 33:
   · Vive en .rcol (docked para mando, ficha para los demás roles), no en el lugar fijo de Sync.
   · El nombre va como "jules" en Erbaum Light, en minúscula (manual de marca), sin bajada.
   · La charla vive en el contexto de la consola (store), así no se pierde al abrir una ficha.
   · Las respuestas salen de answerJules (datos de la consola) y sus botones abren fichas o paneles.
   · No hay conversaciones guardadas de antes: el historial muestra las de esta sesión.
   Encabezado: Nebulosa, nombre y opciones (opinión, más opciones, maximizar, minimizar).
   Minimizado: franja angosta con la Nebulosa; toda la franja vuelve a abrir a Jules.
   Maximizado: tapa la consola debajo de la barra y muestra a la izquierda las conversaciones
   (PanelConversaciones). Restaurar (o Esc) vuelve al lateral. */
import { useCallback, useEffect, useRef, useState, type ReactNode, type UIEvent } from 'react';
import { useToast } from '../ui/kit';
import { Nebulosa } from '../ui/Nebulosa';
import { Button } from './ds/Button';
import { Dialog } from './ds/Dialog';
import { Icon } from './ds/Icon';
import { Menu } from './ds/Menu';
import { PromptInput } from './ds/PromptInput';
import { Eyebrow, Tag } from './ds/basicos';
import { Copiar } from './Copiar';
import { OpinionGeneral } from './OpinionGeneral';
import { PanelConversaciones } from './PanelConversaciones';
import { RespuestaJules } from './RespuestaJules';
import { Trabajo } from './Trabajo';
import { TurnoJules } from './TurnoJules';
import { sinConversaciones } from './datos';
import { DEMORA, PASOS, type AccionJules, type JulesStore, type Mensaje } from './store';
import { useAnchoArrastrable } from './useAnchoArrastrable';

const TEXTOS = {
  nombre: 'Jules',
  detener: 'Detener respuesta',
  sugeridas: 'Preguntas sugeridas',
  otras: 'Otras preguntas',
  enviar: 'Enviar pregunta',
  minimizar: 'Minimizar Jules',
  abrir: 'Abrir Jules',
  maximizar: 'Maximizar Jules',
  restaurar: 'Restaurar Jules',
  cerrar: 'Cerrar',
  copiar: 'Copiar respuesta',
  copiada: 'Respuesta copiada',
  copiarPregunta: 'Copiar',
  preguntaCopiada: 'Copiada',
  editar: 'Editar',
  nueva: 'Conversación nueva',
  opinion: 'Opinión sobre Jules',
  gracias: 'Gracias, lo vamos a tener en cuenta.',
  mas: 'Más opciones',
  ancho: 'Cambiar el ancho de Jules',
  descargar: 'Descargar conversación',
  renombrar: 'Cambiar el título',
  borrar: 'Borrar conversación',
  borrarTitulo: '¿Borrar esta conversación?',
  borrarTexto: 'Se borra de «Esta sesión» y no se puede recuperar.',
  cancelar: 'Cancelar',
  borrada: 'Conversación borrada.',
  irAbajo: 'Ir a lo último',
};

/* Límites del ancho al arrastrar el borde (--layout-panel-min y --layout-panel-max de Sync). */
const LIMITES: [number, number] = [280, 560];

/* Título automático de una charla nueva: su primera pregunta, sin los signos de pregunta y con
   mayúscula ("¿en qué horario…?" → "En qué horario…"). */
const tituloDe = (pregunta: string) => {
  const limpio = pregunta.replace(/[¿?]/g, '').trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
};

const sinMovimiento = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface JulesProps {
  store: JulesStore;
  /** Nombre de pila de la persona (saludo de la bienvenida). */
  nombre: string;
  /** Lo primero que dice, en las conversaciones de esta sesión (lateral). */
  intro?: ReactNode;
  /** Título de la bienvenida (maximizado, charla vacía). */
  saludo?: string;
  /** Lo importante de la pantalla, debajo del campo en la bienvenida (en Sync, las tarjetas). */
  tarjetas?: ReactNode;
  /** Preguntas sugeridas. */
  preguntas?: string[];
  placeholder: string;
  /** Pregunta escrita o sugerida: la responde la consola (answerJules) y la suma a la charla. */
  onPreguntar: (texto: string) => void;
  /** Qué hace el botón de una respuesta en la consola (abrir una ficha o un panel). */
  onAccion: (accion: AccionJules) => void;
  /** Jules abierto como ficha (no docked): botón para cerrarlo. */
  onCerrar?: () => void;
}

export function Jules({ store, nombre, intro, saludo, tarjetas, preguntas = [], placeholder, onPreguntar, onAccion, onCerrar }: JulesProps) {
  const { mensajes, enSesion, estado, nueva, activa, minimizado, setMinimizado, maximizado, setMaximizado } = store;
  const mostrarAviso = useToast();
  const [conHistorial, setConHistorial] = useState(true);
  const [texto, setTexto] = useState('');
  const final = useRef<HTMLDivElement>(null);
  const [opinando, setOpinando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [renombrando, setRenombrando] = useState(false);
  // Si la persona subió a leer algo anterior, aparece el botón para ir abajo.
  const [lejos, setLejos] = useState(false);
  const lejosRef = useRef(false);
  useEffect(() => { lejosRef.current = lejos; }, [lejos]);
  const pensando = estado === 'think';
  const [paso, setPaso] = useState(0);

  // Ancho del lateral, arrastrando su borde izquierdo: la columna de la consola sigue al mouse.
  const { panelRef, propsBorde } = useAnchoArrastrable<HTMLElement>({
    lado: 'izquierda', limites: LIMITES, onMover: store.setAncho, medir: (panel) => panel.parentElement?.offsetWidth ?? panel.offsetWidth,
  });

  useEffect(() => {
    if (estado !== 'think') return undefined;
    setPaso(0);
    const cambio = setInterval(() => setPaso((antes) => Math.min(antes + 1, PASOS.length - 1)), DEMORA / PASOS.length);
    return () => clearInterval(cambio);
  }, [estado]);

  const terminoDeEscribir = store.terminoDeEscribir;

  // Esc restaura a Jules maximizado (si no hay una ventana abierta encima). preventDefault: la
  // consola no cierra la ficha con este mismo Esc.
  useEffect(() => {
    if (!maximizado) return undefined;
    function alTeclear(evento: KeyboardEvent) {
      if (evento.key === 'Escape' && !evento.defaultPrevented && !document.querySelector('dialog[open]')) {
        evento.preventDefault();
        setMaximizado(false);
      }
    }
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  }, [maximizado, setMaximizado]);

  // Sigue a lo último: también cuando termina de escribir y entran las cifras y el pie.
  useEffect(() => {
    if (mensajes.length) final.current?.scrollIntoView({ block: 'end' });
  }, [mensajes, estado]);

  // Lejos de lo último: más de dos renglones grandes (--space-16) por encima.
  function alDesplazar(evento: UIEvent<HTMLDivElement>) {
    const charla = evento.currentTarget;
    const resto = charla.scrollHeight - charla.scrollTop - charla.clientHeight;
    setLejos(resto > parseFloat(getComputedStyle(charla).getPropertyValue('--space-16')) * 2);
  }

  // Mientras Jules escribe, la charla sigue a lo último (si la persona no subió a leer otra cosa).
  const seguirAbajo = useCallback(() => {
    if (!lejosRef.current) final.current?.scrollIntoView({ block: 'end' });
  }, []);

  function irAbajo() {
    final.current?.scrollIntoView({ block: 'end', behavior: sinMovimiento() ? 'auto' : 'smooth' });
  }

  // Título de la charla (arriba, con Jules maximizado).
  const titulo = store.nombres[activa] ?? (mensajes.length && mensajes[0].de === 'persona' ? tituloDe(mensajes[0].texto) : TEXTOS.nueva);

  // Descargar: la charla en texto plano (.txt), con quién dijo qué.
  function descargar() {
    const lineas = mensajes.map((m) => (m.de === 'persona'
      ? `Tú: ${m.texto}`
      : `Jules: ${[m.conclusion, m.texto, ...(m.datos ?? []).map((d) => `${d.etiqueta}: ${d.valor}`)].filter(Boolean).join('\n')}`));
    const archivo = new Blob([`${titulo}\n\n${lineas.join('\n\n')}\n`], { type: 'text/plain' });
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(archivo);
    enlace.download = `${titulo}.txt`;
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  function abrirConversacion(id: string) {
    store.abrir(id);
    setRenombrando(false);
    setTexto('');
  }

  function nuevaConversacion() {
    store.nuevaConversacion();
    setRenombrando(false);
    setTexto('');
  }

  function borrar() {
    setBorrando(false);
    store.borrar();
    setRenombrando(false);
    setTexto('');
    mostrarAviso(TEXTOS.borrada);
  }

  // Editar una pregunta: vuelve al campo para cambiarla y mandarla de nuevo.
  function editar(pregunta: string) {
    setTexto(pregunta);
    document.getElementById('pregunta-jules')?.focus();
  }

  function preguntar(pregunta: string) {
    if (pensando || !pregunta.trim()) return;
    onPreguntar(pregunta.trim());
  }

  function enviar() {
    preguntar(texto);
    setTexto('');
  }

  // El botón de una respuesta actúa sobre la consola: si Jules está maximizado, vuelve al
  // lateral para que se vea.
  function accionar(accion: AccionJules) {
    setMaximizado(false);
    onAccion(accion);
  }

  // Las de esta sesión con algo preguntado, la más nueva primero. El título es la primera pregunta.
  const sesion = Object.entries(store.charlas)
    .filter(([id, charla]) => id.startsWith('sesion-') && charla.length)
    .reverse()
    .map(([id, charla]) => {
      const primera = charla[0] as Extract<Mensaje, { de: 'persona' }>;
      return { id, titulo: store.nombres[id] ?? tituloDe(primera.texto), meta: primera.hora };
    });

  function guardarTitulo(nuevo: string) {
    store.renombrar(nuevo);
    setRenombrando(false);
  }

  const hechas = new Set(mensajes.filter((m) => m.de === 'persona').map((m) => m.texto));
  const pendientes = preguntas.filter((p) => !hechas.has(p));

  // Maximizado gana sobre minimizado (se maximiza desde el lateral abierto).
  const chico = minimizado && !maximizado;
  // Maximizado y sin preguntas todavía: la bienvenida va centrada, como un chat nuevo.
  const bienvenida = maximizado && enSesion && !mensajes.length && !pensando;

  const campo = (
    <PromptInput
      id="pregunta-jules"
      size={maximizado ? 'md' : 'sm'}
      label={placeholder}
      placeholder={placeholder}
      value={texto}
      onChange={(evento) => setTexto(evento.target.value)}
      onSubmit={enviar}
      enviar={TEXTOS.enviar}
      generando={estado !== 'idle'}
      onDetener={store.detener}
      detener={TEXTOS.detener}
    />
  );

  const sugeridas = estado === 'idle' && pendientes.length > 0 && (
    <section className={`jules-lateral__sugerencias${mensajes.length ? ' jules-lateral__sugerencias--seguir svx-entrar' : ''}`}>
      {/* En la bienvenida, sin título: van debajo del campo, como atajos. */}
      {!bienvenida && <Eyebrow as="h3">{mensajes.length ? TEXTOS.otras : TEXTOS.sugeridas}</Eyebrow>}
      <div className="jules-lateral__globos" aria-label={bienvenida ? TEXTOS.sugeridas : undefined} role={bienvenida ? 'group' : undefined}>
        {pendientes.map((p) => (
          <Tag key={p} className="jules-lateral__sugerencia svx-interactivo" onClick={() => preguntar(p)}>
            {p}
          </Tag>
        ))}
      </div>
    </section>
  );

  return (
    <section
      ref={panelRef}
      className={['jules-lateral', 'jules-ds', 'svx-fondo-marca', chico && 'jules-lateral--minimizado', maximizado && 'jules-lateral--maximizado'].filter(Boolean).join(' ')}
      aria-label={TEXTOS.nombre}
    >
      {/* Lateral abierto: el borde izquierdo se arrastra (o se mueve con ← →) para cambiar el ancho. */}
      {!chico && !maximizado && (
        <div className="jules-lateral__borde conversaciones__borde" aria-label={TEXTOS.ancho} {...propsBorde} />
      )}
      {maximizado && (
        <PanelConversaciones
          lado="izquierda"
          conversaciones={[]}
          vacio={sinConversaciones}
          sesion={sesion}
          activa={activa}
          onAbrir={abrirConversacion}
          onNueva={nuevaConversacion}
          abierto={conHistorial}
          onAlternar={() => setConHistorial((antes) => !antes)}
        />
      )}
      {chico ? (
        // Franja: toda es un botón para volver a abrir a Jules. De fondo, la Nebulosa estirada a
        // lo alto, difuminada y suave: sigue "viva" y refleja si Jules piensa o habla.
        <button type="button" className="jules-lateral__abrir svx-interactivo" aria-expanded="false" aria-label={TEXTOS.abrir} title={TEXTOS.abrir} onClick={() => setMinimizado(false)}>
          <span className="jules-lateral__aura" aria-hidden="true"><Nebulosa state={estado} size={64} /></span>
          <Nebulosa state={estado} size={36} />
          <span className="jules-lateral__vertical jules-nombre">jules</span>
          <Icon name="chevron-left" />
        </button>
      ) : (
        <header className="jules-lateral__encabezado">
          {/* 24 px: casi el alto del renglón del título (26 px), así logo y nombre se leen como un bloque. */}
          <Nebulosa state={estado} size={24} />
          <div className="jules-lateral__nombre">
            {/* Solo el título: "jules" en el lateral; maximizado, el de la charla. */}
            {!maximizado ? (
              <span className="jules-lateral__titulo jules-nombre">jules</span>
            ) : renombrando ? (
              <input
                autoFocus
                className="sv-input jules-lateral__titulo-campo"
                aria-label={TEXTOS.renombrar}
                defaultValue={titulo}
                onFocus={(evento) => evento.target.select()}
                onBlur={(evento) => guardarTitulo(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === 'Enter') evento.currentTarget.blur();
                  if (evento.key === 'Escape') { evento.stopPropagation(); evento.preventDefault(); setRenombrando(false); }
                }}
              />
            ) : (
              <button type="button" className="jules-lateral__titulo jules-lateral__titulo-boton svx-interactivo" data-tip={TEXTOS.renombrar} onClick={() => setRenombrando(true)}>
                <span className="jules-lateral__titulo-texto">{titulo}</span>
              </button>
            )}
          </div>
          {/* Opciones, en --ink, cada una con su tooltip. */}
          <div className="jules-lateral__opciones">
            <Button variant="ghost" iconOnly className="jules-icono" aria-label={TEXTOS.opinion} data-tip={TEXTOS.opinion} onClick={() => setOpinando(true)}>
              <Icon name="opinion" />
            </Button>
            <Menu
              label={TEXTOS.mas}
              data-tip={TEXTOS.mas}
              className="jules-lateral__mas"
              trigger={<Icon name="mas" />}
              triggerClassName="iconbtn jules-icono"
              align="end"
              fijo
              items={[
                { label: TEXTOS.nueva, onSelect: nuevaConversacion },
                ...(maximizado ? [{ label: TEXTOS.renombrar, onSelect: () => setRenombrando(true) }] : []),
                ...(mensajes.length ? [
                  { label: TEXTOS.descargar, onSelect: descargar },
                  ...(enSesion ? [{ label: TEXTOS.borrar, onSelect: () => setBorrando(true), peligro: true, separado: true }] : []),
                ] : []),
              ]}
            />
            {maximizado ? (
              <Button variant="ghost" iconOnly className="jules-icono" aria-label={TEXTOS.restaurar} data-tip={TEXTOS.restaurar} onClick={() => setMaximizado(false)}>
                <Icon name="contraer" />
              </Button>
            ) : (
              <>
                <Button variant="ghost" iconOnly className="jules-icono" aria-label={TEXTOS.maximizar} data-tip={TEXTOS.maximizar} onClick={() => { setMinimizado(false); setMaximizado(true); }}>
                  <Icon name="expand" />
                </Button>
                <Button variant="ghost" iconOnly className="jules-icono" aria-expanded="true" aria-label={TEXTOS.minimizar} data-tip={TEXTOS.minimizar} onClick={() => setMinimizado(true)}>
                  <Icon name="chevron-right" />
                </Button>
                {onCerrar && (
                  <Button variant="ghost" iconOnly className="jules-icono" aria-label={TEXTOS.cerrar} data-tip={TEXTOS.cerrar} onClick={onCerrar}>
                    <Icon name="x" />
                  </Button>
                )}
              </>
            )}
          </div>
        </header>
      )}

      <div onScroll={alDesplazar} className={`jules-lateral__charla${bienvenida ? ' jules-lateral__charla--bienvenida' : ''}`} aria-live="polite" hidden={chico}>
        {bienvenida ? (
          <div className="jules-bienvenida__saludo">
            <Nebulosa state={texto ? 'listen' : estado} size={96} />
            <div className="jules-bienvenida__textos">
              <h2 className="jules-bienvenida__titulo">{saludo ?? `Hola ${nombre}, ¿qué quieres revisar?`}</h2>
            </div>
          </div>
        ) : (
          // La intro es de la pantalla: solo en las conversaciones de ahora. Maximizado no va: el
          // saludo de la bienvenida ya dijo de qué habla.
          enSesion && !maximizado && intro && (typeof intro === 'string' ? <p className="jules-lateral__intro">{intro}</p> : intro)
        )}

        {bienvenida && <div className="jules-bienvenida__campo">{campo}</div>}

        {bienvenida && tarjetas && <div className="jules-lateral__tarjetas">{tarjetas}</div>}

        {mensajes.map((m, i) => (m.de === 'persona' ? (
          // La pregunta, a la derecha. Abajo, al pasar el mouse (o al llegar con teclado): la
          // hora, copiar y editar.
          <div key={i} className="jules-lateral__persona svx-entrar">
            <p className="svx-bubble jules-lateral__pregunta">{m.texto}</p>
            <div className="jules-lateral__persona-acciones">
              {m.hora && <span className="jules-lateral__hora">{m.hora}</span>}
              <Copiar texto={m.texto} etiqueta={TEXTOS.copiarPregunta} hecha={TEXTOS.preguntaCopiada} />
              {enSesion && (
                <Button size="sm" variant="ghost" iconOnly className="jules-accion" aria-label={TEXTOS.editar} data-tip={TEXTOS.editar} onClick={() => editar(m.texto)}>
                  <Icon name="editar" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <TurnoJules key={i}>
            {m.trabajo && <Trabajo {...m.trabajo} />}
            <RespuestaJules
              conclusion={m.conclusion}
              texto={m.texto}
              datos={m.datos}
              comparacion={m.comparacion}
              hora={m.hora}
              acciones={(m.acciones ?? []).map((a) => ({ label: a.label, onClick: () => accionar(a) }))}
              copiar={TEXTOS.copiar}
              copiada={TEXTOS.copiada}
              opinar
              escribir={i === nueva}
              onTermina={terminoDeEscribir}
              onEscribe={seguirAbajo}
            />
          </TurnoJules>
        )))}

        {/* Mientras piensa, la Nebulosa va abajo de la pregunta, justo arriba del campo. */}
        {pensando && (
          <TurnoJules estado="think" tamano={32} className="jules-turno--pensando">
            {/* key: cada paso nuevo entra suave. El brillo recorre el texto. */}
            <span key={paso} className="jules-lateral__pensando svx-brillo svx-entrar">{PASOS[paso]}</span>
          </TurnoJules>
        )}

        {/* En la bienvenida (maximizado), debajo del campo. En el lateral van en el pie (ver abajo). */}
        {bienvenida && sugeridas}
        {/* Botón para volver a lo último, pegado abajo de la charla. */}
        {lejos && (
          <Button variant="secondary" size="sm" iconOnly className="jules-lateral__abajo svx-entrar" aria-label={TEXTOS.irAbajo} data-tip={TEXTOS.irAbajo} onClick={irAbajo}>
            <Icon name="arrow-down" />
          </Button>
        )}
        <div ref={final} />
      </div>

      {/* En la bienvenida el campo está en el medio de la charla. */}
      {/* Pie: las preguntas sugeridas como chips, justo arriba del campo. */}
      {!bienvenida && <div className="jules-lateral__pie" hidden={chico}>{sugeridas}{campo}</div>}

      <OpinionGeneral
        open={opinando}
        onClose={() => setOpinando(false)}
        onEnviar={() => { setOpinando(false); mostrarAviso(TEXTOS.gracias); }}
      />
      <Dialog
        open={borrando}
        onClose={() => setBorrando(false)}
        title={TEXTOS.borrarTitulo}
        description={TEXTOS.borrarTexto}
        actions={(
          <>
            <Button variant="ghost" size="sm" onClick={() => setBorrando(false)}>{TEXTOS.cancelar}</Button>
            <Button variant="danger" size="sm" onClick={borrar}>{TEXTOS.borrar}</Button>
          </>
        )}
      />
    </section>
  );
}
