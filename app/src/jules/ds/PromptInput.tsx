/* Campo para escribirle a Jules (.svx-prompt). Copia de sync-front/src/components/ds/PromptInput.jsx.
   El texto crece mientras se escribe (hasta 6 renglones; después, scroll). Enter envía;
   Shift+Enter baja de renglón. Al tomar el foco, el campo se rodea con un halo suave de los
   colores de Jules. size: 'md' (con sombra) o 'sm' (panel lateral).
   ejemplos: textos que se escriben solos en el campo vacío (opcional).
   generando + onDetener: mientras Jules responde, el botón pasa a «Detener». */
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Button } from './Button';
import { Icon } from './Icon';

const RITMO = { escribir: 45, borrar: 20, quieto: 1800 };

const sinMovimiento = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function useEjemploEscrito(ejemplos: string[] | undefined, activo: boolean, fijo?: string) {
  const [texto, setTexto] = useState('');
  const hay = activo && !!ejemplos?.length && !sinMovimiento();

  useEffect(() => {
    if (!hay || !ejemplos) return undefined;
    let cual = 0;
    let letras = 0;
    let borrando = false;
    let espera: ReturnType<typeof setTimeout>;
    function paso() {
      const ejemplo = ejemplos![cual];
      if (!borrando && letras < ejemplo.length) {
        letras += 1;
        espera = setTimeout(paso, RITMO.escribir);
      } else if (!borrando) {
        borrando = true;
        espera = setTimeout(paso, RITMO.quieto);
      } else if (letras > 0) {
        letras -= 1;
        espera = setTimeout(paso, RITMO.borrar);
      } else {
        borrando = false;
        cual = (cual + 1) % ejemplos!.length;
        espera = setTimeout(paso, RITMO.escribir);
      }
      setTexto(ejemplos![cual].slice(0, letras));
    }
    paso();
    return () => clearTimeout(espera);
  }, [hay, ejemplos]);

  return hay ? texto : fijo;
}

export function PromptInput({
  id, label, placeholder, value, onChange, onSubmit, enviar = 'Enviar mensaje',
  size = 'md', className = '', ejemplos, generando = false, onDetener, detener = 'Detener respuesta',
}: {
  id: string; label?: string; placeholder?: string; value: string; onChange: (evento: ChangeEvent<HTMLTextAreaElement>) => void;
  onSubmit?: (evento: FormEvent) => void; enviar?: string; size?: 'md' | 'sm'; className?: string; ejemplos?: string[];
  generando?: boolean; onDetener?: () => void; detener?: string;
}) {
  const campo = useRef<HTMLTextAreaElement>(null);
  const vacio = !value.trim();
  const ayuda = useEjemploEscrito(ejemplos, value === '', placeholder);

  function ajustarAlto() {
    const elemento = campo.current;
    if (!elemento) return;
    elemento.style.height = 'auto';
    if (!elemento.value) return;
    elemento.style.height = `${elemento.scrollHeight}px`;
  }

  useLayoutEffect(ajustarAlto, [value]);

  function alEnviar(evento: FormEvent) {
    evento.preventDefault();
    if (generando || vacio) return;
    onSubmit?.(evento);
  }

  function alTeclear(evento: KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key === 'Enter' && !evento.shiftKey && !evento.nativeEvent.isComposing) {
      evento.preventDefault();
      evento.currentTarget.form?.requestSubmit();
    }
  }

  const tamanoBoton = size === 'sm' ? 'sm' : undefined;
  const tamanoIcono = size === 'sm' ? undefined : 'lg';

  return (
    <form className={['svx-prompt', `svx-prompt--${size}`, className].filter(Boolean).join(' ')} onSubmit={alEnviar}>
      <label htmlFor={id} className="sv-sr">{label}</label>
      <textarea
        ref={campo}
        id={id}
        rows={1}
        className="svx-prompt__input"
        placeholder={ayuda}
        value={value}
        onChange={onChange}
        onInput={ajustarAlto}
        onKeyDown={alTeclear}
      />
      {generando && onDetener ? (
        <Button type="button" iconOnly size={tamanoBoton} aria-label={detener} title={detener} onClick={onDetener}>
          <Icon name="detener" size={tamanoIcono} />
        </Button>
      ) : (
        <Button type="submit" iconOnly size={tamanoBoton} aria-label={enviar} title={enviar} disabled={vacio || generando}>
          <Icon name="arrow-up" size={tamanoIcono} />
        </Button>
      )}
    </form>
  );
}
