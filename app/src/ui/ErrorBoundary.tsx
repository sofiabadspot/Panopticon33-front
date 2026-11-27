import { Component, type ReactNode } from 'react';
import { EmptyState } from './kit';

/** Si una parte de la consola falla al dibujarse, se cae solo esa parte: el mapa y el resto siguen andando.
    `scope` dice qué se cayó ("esta ficha", "la consola"); `onReset` ofrece salir (p. ej., cerrar la ficha). */
export class ErrorBoundary extends Component<{ scope: string; onReset?: () => void; resetLabel?: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(`Falló ${this.props.scope}:`, error); }
  render() {
    if (!this.state.error) return this.props.children;
    const { scope, onReset, resetLabel = 'Cerrar' } = this.props;
    return (
      <div className="pb" role="alert">
        <EmptyState icon="error" title={`No se pudo mostrar ${scope}`}
          action={<div style={{ display: 'flex', gap: 8 }}>
            <button className="btn secondary sm" onClick={() => this.setState({ error: null })}>Reintentar</button>
            {onReset && <button className="btn ghost sm" onClick={onReset}>{resetLabel}</button>}
          </div>}>
          Algo falló al dibujarla. Lo demás de la consola sigue funcionando. Si vuelve a pasar, conviene avisar a soporte.
        </EmptyState>
      </div>
    );
  }
}
