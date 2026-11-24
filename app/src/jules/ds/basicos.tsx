/* Piezas chicas del DS de Sync que usa Jules. Copias de sync-front/src/components/ds:
   Tag.jsx, Eyebrow.jsx, Textarea.jsx, SearchInput.jsx, EmptyState.jsx, Badge.jsx, Skeleton.jsx
   y el formato de números de graficos/escala.js. */
import type { ButtonHTMLAttributes, ElementType, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';
import { Icon } from './Icon';

/* Tag (.sv-tag): globo redondeado y clickeable. */
export function Tag({ className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type="button" className={['sv-tag', className].filter(Boolean).join(' ')} {...props}>{children}</button>;
}

/* Título chiquito en mayúsculas (.svx-eyebrow). */
export function Eyebrow({ as: Etiqueta = 'p', className = '', children, ...props }: { as?: ElementType; className?: string; children: ReactNode; id?: string }) {
  return <Etiqueta className={`svx-eyebrow ${className}`.trim()} {...props}>{children}</Etiqueta>;
}

/* Área de texto (.sv-textarea). */
export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={['sv-textarea', className].filter(Boolean).join(' ')} {...props} />;
}

/* Campo de búsqueda con lupa (.sv-inputgroup + .sv-input). */
export function SearchInput({ id, label, placeholder, className = '', ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <div className={`sv-inputgroup ${className}`.trim()}>
      <Icon name="search" />
      <label htmlFor={id} className="sv-sr">{label}</label>
      <input id={id} className="sv-input" type="search" placeholder={placeholder} {...props} />
    </div>
  );
}

/* Estado vacío (.sv-empty). sutil: sin borde, a la izquierda y con letra chica. */
export function EmptyState({ titulo, texto, sutil = false, className = '' }: { titulo: string; texto?: string; sutil?: boolean; className?: string }) {
  return (
    <div className={['sv-empty', sutil && 'svx-empty--sutil', className].filter(Boolean).join(' ')}>
      <h3>{titulo}</h3>
      {texto && <p>{texto}</p>}
    </div>
  );
}

/* Badge de estado (.sv-badge). tone: neutral | positive | negative. */
export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'positive' | 'negative'; children: ReactNode }) {
  return <span className={['sv-badge', tone !== 'neutral' && `sv-badge--${tone}`].filter(Boolean).join(' ')}>{children}</span>;
}

/* Línea de carga (.sv-skeleton). */
export function SkeletonLinea({ ancho = '100%' }: { ancho?: string }) {
  return <div className="sv-skeleton svx-skeleton-texto" style={{ width: ancho }} />;
}

const FORMATO = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 1 });
export const numero = (valor: number | null | undefined) => (valor == null ? '—' : FORMATO.format(valor));
