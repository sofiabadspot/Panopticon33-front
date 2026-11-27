/* Botón de la consola (y de Jules): un solo sistema, sobre .btn y .iconbtn de app.css.
   variant: primary (acción principal, vidrio blanco) · secondary (contorno) · ghost (sin fondo)
            · danger (borra o apaga algo) · positive (confirma una decisión).
   size: xs 26 · sm 32 · md 40 (por defecto) · lg 48. Con iconOnly: sm 32 (por defecto) o md 40.
   iconOnly exige aria-label, y el mismo texto sale como tooltip (title) si no se pasa otro. */
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'positive';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  block?: boolean;
  'data-tip'?: string;
}

export function Button({ variant = 'primary', size, iconOnly = false, block = false, className = '', type = 'button', title, children, ...props }: ButtonProps) {
  const clases = iconOnly
    ? ['iconbtn', variant !== 'ghost' && variant, size === 'md' && 'md', className]
    : ['btn', variant, size && size !== 'md' && size, block && 'block', className];
  // Un botón de solo ícono sin tooltip propio usa su etiqueta (salvo que ya tenga data-tip, el tooltip de Jules).
  const tip = title ?? (iconOnly && !props['data-tip'] ? props['aria-label'] : undefined);
  return (
    <button type={type} className={clases.filter(Boolean).join(' ')} title={tip} {...props}>
      {children}
    </button>
  );
}

/** Botón de solo ícono: la etiqueta es obligatoria (lector de pantalla y tooltip). */
export function IconButton(props: Omit<ButtonProps, 'iconOnly' | 'aria-label'> & { label: string }) {
  const { label, variant = 'ghost', ...rest } = props;
  return <Button {...rest} variant={variant} iconOnly aria-label={label} />;
}
