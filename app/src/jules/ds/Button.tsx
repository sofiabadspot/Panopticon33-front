/* Botón del DS de Sync (.sv-btn). Copia de sync-front/src/components/ds/Button.jsx.
   variant: primary | secondary | ghost | danger. size 'sm'. iconOnly: botón de solo ícono. */
import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm';
  iconOnly?: boolean;
  'data-tip'?: string;
}

export function Button({ variant = 'primary', size, iconOnly = false, className = '', type = 'button', children, ...props }: ButtonProps) {
  const clases = ['sv-btn', `sv-btn--${variant}`, size === 'sm' && 'sv-btn--sm', iconOnly && 'sv-btn--icon', className];
  return (
    <button type={type} className={clases.filter(Boolean).join(' ')} {...props}>
      {children}
    </button>
  );
}
