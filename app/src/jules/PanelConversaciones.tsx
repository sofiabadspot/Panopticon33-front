/* Panel con las conversaciones con Jules (a la izquierda de Jules maximizado). Copia de
   sync-front/src/components/jules/PanelConversaciones.jsx.
   sesion: conversaciones abiertas ahora (van primero, en "Esta sesión"). activa: la que se ve.
   onAbrir(id) / onNueva. abierto / onAlternar: se cierra con la flecha y queda una franja
   angosta que dice "Conversaciones". lado: de qué lado de la pantalla está. */
import { useState, type CSSProperties } from 'react';
import { Button } from './ds/Button';
import { Icon } from './ds/Icon';
import { EmptyState, Eyebrow, SearchInput, SkeletonLinea } from './ds/basicos';
import { useAnchoArrastrable } from './useAnchoArrastrable';

export interface ItemConversacion { id: string; titulo: string; meta: string }
export interface GrupoConversaciones { grupo: string; items: ItemConversacion[] }
interface Vacio { titulo: string; texto: string; sinResultados: { titulo: string; texto: string } }

export function PanelConversaciones({
  conversaciones, vacio, cargando = false, sesion = [], activa, onAbrir, onNueva, abierto, onAlternar, lado = 'derecha',
}: {
  conversaciones: GrupoConversaciones[]; vacio: Vacio; cargando?: boolean; sesion?: ItemConversacion[]; activa: string;
  onAbrir?: (id: string) => void; onNueva?: () => void; abierto: boolean; onAlternar: () => void; lado?: 'izquierda' | 'derecha';
}) {
  const [busqueda, setBusqueda] = useState('');
  const filtro = busqueda.trim().toLowerCase();
  const todos = sesion.length ? [{ grupo: 'Esta sesión', items: sesion }, ...conversaciones] : conversaciones;
  const grupos = todos
    .map((grupo) => ({ ...grupo, items: grupo.items.filter((item) => item.titulo.toLowerCase().includes(filtro)) }))
    .filter((grupo) => grupo.items.length);
  const renglonesCargando = Math.max(3, conversaciones.flatMap((grupo) => grupo.items).length);
  const izquierda = lado === 'izquierda';
  const flechaAbrir = izquierda ? 'chevron-right' : 'chevron-left';
  const flechaCerrar = izquierda ? 'chevron-left' : 'chevron-right';

  const { ancho, panelRef, propsBorde } = useAnchoArrastrable<HTMLElement>({ lado: izquierda ? 'derecha' : 'izquierda' });

  const clases = ['conversaciones', izquierda && 'conversaciones--izquierda'];

  if (!abierto) {
    return (
      <aside className={[...clases, 'conversaciones--cerrado'].filter(Boolean).join(' ')}>
        <button
          type="button"
          className="conversaciones__abrir svx-interactivo"
          aria-label="Abrir conversaciones"
          aria-expanded="false"
          onClick={onAlternar}
        >
          <span className="sv-btn sv-btn--secondary sv-btn--icon" aria-hidden="true">
            <Icon name={flechaAbrir} />
          </span>
          <Eyebrow as="span" className="conversaciones__vertical">Conversaciones</Eyebrow>
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={panelRef}
      className={[...clases, 'svx-entrar'].filter(Boolean).join(' ')}
      aria-labelledby="conversaciones"
      style={ancho ? { '--conversaciones-ancho': `${ancho}px` } as CSSProperties : undefined}
    >
      <div className="conversaciones__borde" aria-label="Cambiar el ancho de conversaciones" {...propsBorde} />
      <div className="conversaciones__encabezado">
        <Eyebrow as="h2" id="conversaciones" className="conversaciones__titulo">Conversaciones</Eyebrow>
        <Button variant="secondary" size="sm" onClick={onNueva}>
          <Icon name="plus" />
          Nueva
        </Button>
        <Button variant="secondary" iconOnly aria-label="Cerrar conversaciones" aria-expanded="true" onClick={onAlternar}>
          <Icon name={flechaCerrar} className="conversaciones__contraer" />
        </Button>
      </div>

      <div className="conversaciones__buscador">
        <SearchInput
          id="buscar-conversaciones"
          label="Buscar conversaciones"
          placeholder="Buscar conversaciones"
          value={busqueda}
          onChange={(evento) => setBusqueda(evento.target.value)}
        />
      </div>

      <nav className="conversaciones__lista" aria-label="Conversaciones anteriores" aria-busy={cargando}>
        {cargando && (
          <div className="conversaciones__grupo" aria-hidden="true">
            {Array.from({ length: renglonesCargando }, (_, indice) => (
              <div key={indice} className="conversaciones__cargando">
                <SkeletonLinea ancho="80%" />
                <SkeletonLinea ancho="45%" />
              </div>
            ))}
          </div>
        )}
        {!cargando && grupos.length === 0 && (
          <EmptyState
            sutil
            className="conversaciones__vacio svx-entrar"
            titulo={filtro ? vacio.sinResultados.titulo : vacio.titulo}
            texto={filtro ? vacio.sinResultados.texto : vacio.texto}
          />
        )}
        {!cargando && grupos.map((grupo) => (
          <div key={grupo.grupo} className="conversaciones__grupo svx-entrar">
            <Eyebrow as="span" className="conversaciones__grupo-titulo">{grupo.grupo}</Eyebrow>
            {grupo.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`conversacion svx-interactivo${item.id === activa ? ' conversacion--activa' : ''}`}
                aria-current={item.id === activa ? 'true' : undefined}
                onClick={() => onAbrir?.(item.id)}
              >
                <span className="conversacion__titulo">{item.titulo}</span>
                <span className="conversacion__meta">{item.meta}</span>
              </button>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  );
}
