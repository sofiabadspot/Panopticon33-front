# Auditoría UX/UI de la consola beta · 27-nov-2026

Revisión completa de `app/` antes de la beta del 15 de diciembre. Cubre el código y la consola en uso con tres roles: Analista, Administrador y Operador 911. No se cambió nada del código. Todos los hallazgos se verificaron en el código, y los marcados con 👁 también se vieron en pantalla.

Severidad:

- **Alta:** rompe algo visible o operativo, o bloquea el uso con teclado o lector de pantalla.
- **Media:** se nota como inconsistencia.
- **Baja:** detalle de pulido.

---

## 0. El diagnóstico en una frase

La consola tiene **dos sistemas de diseño conviviendo** y **ningún componente compartido para modales, menús, fechas, segmentados ni pestañas**:

- **El kit de la consola:** `src/ui/kit.tsx` + `app.css`.
- **Una copia del DS de Sync:** `src/jules/ds/*` + `jules.css`, usada por Jules y por el menú de cuenta.

Por eso cada pantalla resolvió esos controles a mano, y cada una lo hizo distinto. La forma de que quede entregable no es corregir pantalla por pantalla. Es esta:

1. **Elegir un solo sistema** (el de la consola) y llevar Jules a sus medidas.
2. **Crear los 10 componentes que faltan** (sección 7) y migrar las pantallas a ellos.
3. **Normalizar tokens:** espaciado, z-index, sombras y radios.
4. **Corregir en paralelo los bugs operativos**, que no esperan a la migración (sección 1).

---

## 1. Bugs y riesgos operativos (arreglar ya, aunque no se migre nada)

| # | Qué pasa | Dónde | Sev. |
|---|---|---|---|
| 1.1 | **C / D / 1-5 actúan sobre fichas que no se ven.** Cada `AlertSheet` montada escucha el teclado en `window`. Con una alerta en el lateral y otra en el muro de video, una tecla decide las dos. | `AlertSheet.tsx:96-107` | Alta |
| 1.2 | **Un Esc en un diálogo también cierra la ficha de abajo.** El Dialog del kit no hace `preventDefault` ni mueve el foco adentro. | `ui/kit.tsx:61`, `Console.tsx:304-311` | Alta |
| 1.3 | **Se pierden cambios sin aviso.** Esc, un clic en el mapa o "Volver" descartan formularios con cambios (evento, zona, cámara, rol), aunque ya calculan `dirty`. | `configPlace.tsx:201/428`, `configSections.tsx:122`, `EventSheet` | Alta |
| 1.4 | **Una fecha vacía se guarda como `NaN`.** `fromLocalInput("")` da NaN y la validación `fin <= inicio` da falso, así que no muestra error. | `EventSheet.tsx:115`, `api/format.ts:46` | Alta |
| 1.5 | **No hay estado de error.** Ninguna acción de la API tiene try/catch y el toast de éxito sale siempre. El toast solo tiene ícono de ✓. Con el backend real, un 500 va a decir "Zona eliminada". | todo `console/*`, `ui/kit.tsx:86` | Alta |
| 1.6 | **No hay error boundary.** Una excepción en una ficha deja la consola entera en blanco, mapa incluido. | `main.tsx:22-27` | Alta |
| 1.7 | **La ficha de alerta y el buscador ignoran el alcance.** Un operador "solo de su territorio" abre alertas de otro con `?s=alerta.…`. | `AlertSheet.tsx:37`, `Search.tsx:72/78`, `ctx.tsx:48` | Alta |
| 1.8 | **Descartar, despachar y confirmar facial son de un clic y sin deshacer.** Jules ya tiene un toast con "Deshacer" (`AgentFeed.tsx:89`); las acciones del operador no. | `AlertSheet.tsx:94/274`, `WhoArrives.tsx:31`, `FacialSheet.tsx:248` | Alta |
| 1.9 | **Cargar una lista la reemplaza entera.** El aviso llega recién en el toast, después de reemplazarla. | `configOps.tsx:376` | Alta |
| 1.10 | **Apagar una regla o bloquear un usuario es un interruptor inmediato**, sin confirmar. | `configOps.tsx:163`, `configSections.tsx:286` | Alta |
| 1.11 | **"Subir archivo" del CSV no se alcanza con teclado.** El input está `hidden` dentro de un `<label>`. | `CsvImport.tsx:66-69` | Alta |
| 1.12 | **No hay aviso de conexión perdida con la plataforma** (solo con Maic). Los datos viejos se ven como en vivo. | `Console.tsx:454` | Alta |
| 1.13 | **`--r-card` no existe**, así que `.w-sheet` y `.resolved` salen con esquinas rectas. | `app.css:1618, 1631` | Media |
| 1.14 | **IBM Plex Mono 600 no se carga.** Los 42 rótulos HUD salen con negrita simulada por el navegador. | `main.tsx:8-9` | Media |
| 1.15 | **Dos buscadores sin foco visible** (`outline:none` sin reemplazo). | `app.css:2128` (`.pm-search`), `:2595` (`.story-search`) | Alta |

---

## 2. Modales y paneles flotantes

Hay **11 overlays con 11 comportamientos distintos**.

| Overlay | Foco | Esc | Clic afuera | Cierre | Radio | z |
|---|---|---|---|---|---|---|
| Dialog del kit (`.scrim/.dialog`) | ❌ no entra, no vuelve | burbuja, sin preventDefault | cierra (también en formularios) | `.iconbtn` 32 | 12 | 50 |
| Dialog de Jules (`<dialog>`) | ✅ nativo | `cancel` nativo | no cierra | SVG propio, absoluto | — | top layer |
| Visor `.iv` | ❌ | captura | no | píldora "Esc" | — | 20 |
| Visor `.lb` (expediente) | — | — | `.lb-scrim` (código muerto) | `.iconbtn` | — | 5/80 |
| Expediente `.ds` | ✅ a mano | stopImmediate | no | `.ds-close` 36 | — | 70 |
| Evidencia sin lugar `.ev-loose` 👁 | autoFocus | captura | no | `.iconbtn` | **2** | 7 |
| Abanico `.qfan-pop` | ❌ | captura | no | círculo **a la izquierda** | — | 7 |
| Atajos `.cmd-pop.keys` | ❌ | global | sí | ninguno | — | — |
| Buscador `.search-pop` | — | blur | sí | — | — | 40 |
| Menú de Jules `.sv-menu` | ✅ | ✅ | ✅ | — | 8 | 50/70 |
| `.mapcard` | tooltip | — | — | — | — | 60 |

Problemas visibles:

- **Dos modales con aspecto distinto:**

  | | Kit | Jules |
  |---|---|---|
  | Ancho | 520 | 480 |
  | Fondo | panel | surface |
  | Título | 18 px peso 400 | 22 px peso 600 |
  | Header y footer | con divisores | sin divisores |
  | Sombra | token | escrita a mano |

- **Tres radios distintos en la misma pantalla de evidencia.** 👁 La tarjeta mide 2 px, los campos 8 px y el diálogo del kit 12 px.
- **Las acciones no siempre van en el footer.** OpenStory y OpinionGeneral las ponen dentro del cuerpo.
- **Tres visores de imagen para el mismo material:** `.iv`, `.lb` y `ZoomImg`. FacialSheet y FacialDossier muestran las mismas detecciones con visores distintos.
- **Cinco estrategias para Esc** (burbuja, captura, stopImmediate, `cancel` nativo, microtask). Hoy funciona por orden de registro; cualquier overlay nuevo lo puede romper.
- **Choques de z-index:** en 60 compiten los toasts, la `.mapcard` y el aviso "Haz clic en el mapa", y en 70 el menú de Jules y el expediente. 👁 El aviso de "Nueva lectura" cae **encima** del HUD de recorrido.

**Qué hacer:**

- Un solo `ui/Modal` sobre `<dialog>` + `showModal()` (foco, inert y Esc vienen gratis), con la apariencia del kit y `dismissOnBackdrop` apagado en formularios.
- Un `ui/Popover` para los paneles flotantes no modales.
- Un `useLayer()` con pila de Esc y tokens de z-index.

---

## 3. Dropdowns, selects y menús

- **Lo que ya está bien:** los 18 `<select>` nativos usan `.fld`, con un chevron propio, y se ven parejos entre sí.
- **Dos menús distintos:**
  - El `Menu` de Jules es completo: flechas, Home/End y foco de vuelta al disparador.
  - El menú "Agregar evidencia" de la CommandBar se declara `role="menu"` pero no tiene teclado y tiene otro fondo, radio y sombra. 👁 Sobre el mapa se lee muy mal mientras entra.
- **La consola importa el menú del DS de Jules** (`Console.tsx:24`). El menú de cuenta hereda así los tokens de Sync, en los que `--primary` y `--glass` significan otra cosa.
- **Selects usados como botón de acción:** "Sumar una zona entera" e "o elegir una zona…". Su valor siempre es `""`, y en Windows recorrer las opciones con flechas va agregando zonas sin querer. Corresponde un `Menu` o `Combobox`.
- **El selector "Motivo de la consulta" está implementado tres veces**, cada una con otra validación, otra etiqueta y otro placeholder: OpenStory, VehicleSheet e InvestigatePanel.
- **El combobox del buscador está incompleto:** falta `aria-activedescendant` y los ids de las opciones, y Esc tira el foco al body.
- **👁 El menú de cuenta mezcla tres cosas:** roles, escenarios de demo y cerrar sesión. Los escenarios tienen que desaparecer de la build de producción.
- **👁 Un menú de Jules con una sola opción** ("Conversación nueva"): debería ser un botón.

---

## 4. Fechas y rangos

Las **9 fechas son `datetime-local` nativas**, y no hay un componente de rango.

- **👁 Salen en formato de 12 h** ("09:54 a.m.", "02:54 p.m.") mientras el resto de la consola usa 24 h ("09:03"). El formato lo decide el navegador, no la app.
- **👁 Se cortan** en el formulario de evento: el ícono del calendario queda pegado al borde.
- **Cada formulario valida distinto:**

  | Dónde | Desde < Hasta | Campo vacío | Etiqueta visible |
  |---|---|---|---|
  | Evento | al enviar | **pasa con NaN** | sí ("Inicio/Fin") |
  | Bitácora | no valida (muestra "0 registros") | — | sí ("Desde/Hasta") |
  | Nueva investigación | al enviar | mensaje equivocado | no, solo `aria-label` |
  | Ventana de la investigación | en vivo | mensaje equivocado | no |
  | Evidencia "Cuándo pasó" | — | `aria-invalid` sin texto | sí |

- **Atajos rápidos de fecha en unos lugares sí y en otros no.** "Ventana del hecho / 7 días" está con `.lchip` en un lado y con `.seg` en otro. La bitácora, la investigación y el evento no tienen ninguno.
- **Ningún campo pone `min`/`max`.**
- **La conversión de zona horaria está duplicada:** EvidenceCard reimplementa `toLocalInput`.

**Qué hacer:**

- Crear `ui/DateTimeField` y `ui/DateRangeField`:
  - 24 h fijas y zona America/El_Salvador.
  - Valida vacío y desde < hasta, con un mensaje correcto.
  - Etiqueta visible.
  - `presets` opcionales: Última hora, 24 h, 7 días, Ventana del hecho.
- **Decisión pendiente:** seguir con el selector nativo estilizado (es más barato y accesible, pero el formato a.m./p.m. y el popup los pone el navegador) o hacer un selector propio con calendario y hora de 24 h. Para una consola de operación recomiendo **el propio**, porque el formato 12 h es un riesgo de lectura.

---

## 5. Otros controles y botones

- **Segmentados (`.seg`) con tres semánticas:**
  - con `aria-pressed`;
  - con `role="radio"` sin flechas;
  - **sin nada**: base del mapa, radio de medición y filtros de cámaras. Ahí el lector de pantalla no sabe cuál está elegido.
- **Cuatro implementaciones de pestañas:** `.ltabs` de la consola, `.fbar` (que parecen chips), el dock del expediente (la única completa) y `Tabs` de Jules (usado como selector).
- **El mismo concepto con controles distintos:** el radio de búsqueda es `.lchip` 100/250/500 m en un lugar y `.seg` 250/500/1000 m en otro.
- **Selección de unidades implementada dos veces** (`.rf-u` y `.wa-u`), con checkbox nativo sin estilo. Existe `.check` y no se usa.
- **👁 Input de archivo nativo sin estilo** ("Elegir archivos / Ningún archivo seleccionado") en Evidencia, mientras CsvImport lo esconde detrás de un botón.
- **Botones:**
  - `.btn.primary` y `.btn.solid` son el mismo estilo con dos nombres (15 usos de solid, 11 de primary).
  - **"Cancelar" en cuatro variantes:** ghost sm, secondary sm, sv-btn secondary y ghost xs. Al eliminar dice "Conservar".
  - **La acción principal cambia de lado:** a la derecha en formularios, a la izquierda y ancha en decisiones, a todo el ancho y sin Cancelar en el abanico.
  - **`.btn.danger` se usa una sola vez.** Los disparadores "Eliminar zona" y "Eliminar rol" son ghost, sin ninguna señal de peligro.
  - **Volver en tres estilos:** `.linklike`, `btn ghost sm` y la flecha de SheetHead. En la ficha de alerta, 👁 **dos "volver" con significados distintos**.
- **Tooltips en dos versiones:** el oscuro `.cmd-tip` y el **invertido** (fondo blanco) `[data-tip]` de Jules. 👁 Se nota en "Minimizar Jules".

---

## 6. Jules contra el resto de la consola

Medidas en pantalla 👁 y en el CSS:

| Pieza | Consola | Jules |
|---|---|---|
| Botón | 38–40 px, peso 500 | 40–46 px, peso **600** |
| Botón chico / de ícono | 32 / 32 | **38 / 40** |
| Campo de texto | 38 px, letra 14 | ~42 px, letra **16** |
| Cuerpo de texto | 13–14 px | **16/24** |
| Chips | rectos, radio 4, 22 px | **píldora**, 28 px |
| Tooltip | oscuro | **invertido** |
| Animación | .3 s | .15 s |
| Números | `es-SV` (60,100) | **`es-AR` (60.100)** |

**Qué hacer:** Jules usa los componentes de `ui/` y `jules.css` se reduce a lo propio (nebulosa, prompt, conversación). Hay que renombrar `--primary` y `--glass` dentro de Jules para que no pisen los de la consola.

---

## 7. Componentes que faltan (la base para que todo quede igual)

| Componente | Reemplaza a | Archivos que migran |
|---|---|---|
| `Modal` + `ConfirmDialog` | kit Dialog, jules Dialog, `.ds` | configPlace, configOps, CsvImport, OpenStory, Jules, Opinion, OpinionGeneral, FacialDossier |
| `Popover` + `useLayer` | `.qfan-pop`, `.ev-loose`, `.cmd-pop`, `.measure-card`, `.iv` | QuickFan, EvidenceCard, CommandBar |
| `Menu` (movido a `ui/`, con tokens de consola) | jules Menu, `.cmd-menu`, selects de acción | Console, CommandBar, EventSheet, InvestigatePanel |
| `Field` / `TextField` / `NumberField` / `SelectField` / `ReasonField` | `.field` a mano, labels huérfanos, `.err` sin estilo | todos los formularios |
| `Combobox` | Search, selector de zonas | Search.tsx |
| `DateTimeField` / `DateRangeField` | 9 `datetime-local` | AuditSheet, EventSheet, InvestigatePanel, EvidenceCard, StoryPanel, InvestigationDock |
| `SegmentedControl` + `Tabs` | 16 `.seg`, `.lchip` como radio, `.ltabs`, `.fbar`, jules Tabs | Console, configOps, configPlace, configSections, InvestigatePanel, OpinionGeneral |
| `Button` + `IconButton` + `ActionBar` | `.btn`/`.sv-btn`, `solid`, `title` faltantes | todos |
| `FileInput` | input oculto o nativo | CsvImport, EvidenceCard |
| `MediaViewer` | `.iv`, `.lb`, `ZoomImg` | ImageInspect, FacialDossier |
| `EmptyState size="inline"` + `ErrorState` + `toast.error` / `toast` con Deshacer | 8 estilos de vacío, toast solo de éxito | todas las fichas |

---

## 8. Fichas y paneles: anatomía y estados

- **El orden de las secciones cambia en cada ficha.** La plantilla propuesta:
  1. SheetHead.
  2. Estado o avisos.
  3. Imagen.
  4. KPIs.
  5. Detalle.
  6. Relacionados.
  7. Línea de tiempo.
  8. Pie con acciones.
- **Las acciones están en tres lugares:** pie, cabecera y medio del cuerpo. Regla propuesta:
  - **Decidir y guardar:** pie (`.pf`).
  - **Navegar** (ver, investigar, duplicar): cabecera.
  - **Eliminar:** una "zona de peligro" al final del cuerpo.
- **Los permisos se comunican de cuatro maneras:** aviso arriba, texto en el pie, aviso en el medio y ocultar sin explicar. Regla propuesta:
  - **Lo que el rol nunca va a tener:** se oculta.
  - **Lo que hoy no puede pero existe:** se deshabilita con el motivo visible.
- **"No encontrada" se resuelve distinto en cada ficha.** La mayoría muestra solo el título, sin cuerpo ni acción.
- **8 estilos de estado vacío:** `.empty`, `.w-empty`, `.cd-empty`, `.empty-state`, `.ds-empty`, `.wa-empty`, `.sv-empty`, `.es-inline`. Además hay listas sin estado vacío: cámaras de una zona, presets, reglas y usuarios.
- **El esqueleto de carga depende de un flag global.** No hay carga por ficha. Con backend real se van a ver ceros mientras llega el dato, en contra de la regla "Sin dato no es cero".
- **El tiempo sin decidir se calcula distinto en la bandeja y en la ficha**, así que la misma alerta puede verse atrasada en un lugar y en tiempo en el otro.
- **👁 La lista de la bandeja salta cuando entra una alerta nueva** mientras el operador está mirando otra.
- **👁 Cambiar de rol deja la pantalla negra unos segundos**, sin indicador.

---

## 9. Textos

- **Tuteo y voseo mezclados** (unos 30 textos en tuteo, unos 15 en voseo). 👁 Hay casos en la **misma frase**: "Haz clic en un hexágono … acercate para ver la grilla". El importador de CSV está entero en tuteo ("Descarga… complétala… súbela aquí") y el panel de al lado en voseo ("Buscá una placa"). **Decisión pendiente:** ver la sección 11.
- **El producto tiene tres nombres:** "Panóptico 33", "Panopticon 33" y "Panopticon". Maic aparece como "Maic" y como "MAIC".
- **👁 Placas en dos formatos:** "P 512-884" en la bandeja y "P512-884" en la ficha. 👁 En el aviso de lectura nueva la placa se corta en dos líneas ("P 512-" / "884").
- **El despacho se nombra de muchas formas:** Enviar refuerzos / Mandar unidades / Despachar / Refuerzos en camino / Unidades en camino.
- **"Evento" significa tres cosas:** el evento masivo, cada lectura de la historia y lo que le llega a Maic.
- **"Ver recorrido" abre dos cosas distintas** según dónde esté.
- **Diez formas de decir que falta un dato:** Sin medición, Sin datos., —, Sin fuente, Aún no empieza, Sin lecturas, Sin registro, Ninguna…
- **Formatos de número:** `es-SV` en la consola y `es-AR` en Jules. 👁 La fecha nativa sale en 12 h.
- **Comillas en tres estilos** (“…”, «…», "…") y "aquí" mezclado con "acá".
- **👁 La barra de búsqueda dice "…o preguntarle a Jules"** también en el rol Administrador, que no tiene Jules.
- **Términos internos a la vista:** POC, SPOTBOX, "simulado" y los escenarios de demo.

---

## 10. Tokens y CSS

- **Espaciado:** en `app.css` hay **869 valores en px sueltos contra 124 tokens**, un 12 % de uso de la escala. 6, 10 y 14 px suman unos 300 usos y no tienen token. La regla de `app.css:17` ("Nunca un px suelto") no se cumple.
- **Tamaños de letra:** existe una escala de 11 pasos y se usa bien unas 330 veces, pero hay unos 55 valores sueltos (incluido 15 px, que no está en la escala). Hay 15 `letter-spacing` distintos para rótulos.
- **Radios:** `--r-card` no está definido, y además hay valores de 1 y 3 px y 66 usos de `50%`.
- **Sombras:** 67 distintas. Las de diálogos, visor y expediente están escritas a mano.
- **Capas:** z-index de 1 a 100 sin escala, con choques en 50, 60 y 70.
- **Transiciones:** 54 distintas. Los tokens `--t-*` están escondidos en la línea 1505. `.btn`, `.chip` e `.iconbtn` se definen dos veces y la segunda definición pisa la transición.
- **Selectores repetidos:** 89 aparecen más de una vez en `app.css`. El bloque `.jbrief/.jlead/.jpoints` está dos veces y con valores que se contradicen.
- **278 estilos en línea.** Unos 50 son `fontSize` sobre `.hint`, unos 10 `gridTemplateColumns: '1fr auto'` y 8 `marginLeft: 'auto'`. `SheetHead` está entero en estilos en línea.
- **Colores fuera del tema:** las zonas del administrador en azul `#5B9CFF` (`AdminMapLayers.tsx:26`) contra la regla "solo grises", y `#6cd300` copiado a mano en `MapView.tsx:318`.
- **Contraste:**

  | Caso | Contraste | Dónde |
  |---|---|---|
  | Texto tenue sobre fila seleccionada | ~3.9:1 | `.item.sel` |
  | Blanco sobre rojo | ~4.1:1 | `.qfan-pill.danger` |
  | Borde de los controles | **1.6:1** | `.fld`, `.seg`, `.sv-input` |

  El tema ya define `--border-control` (3.3:1) para los bordes de los controles, pero no se usa.
- **Escalas propuestas:**

  | Escala | Pasos |
  |---|---|
  | Espaciado (grilla de 2 px) | 2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 24 · 32 · 48 · 64 |
  | Radio | 2 (HUD) · 4 (chips) · 8 (controles) · 12 (tarjetas) · full |
  | Altura de controles | 24 · 32 · 40 · 48 |
  | z-index | hud 10 · overlay 20 · takeover 30 · popover 40 · modal 50 · dossier 60 · lightbox 70 · toast 80 · tooltip 90 · login 100 |
  | Sombra | sm · md · lg · xl |
  | Movimiento | fast .15 · mid .25 · slow .5 |

---

## 11. Decisiones que necesito de vos

1. **Registro de los textos:** voseo, tuteo o usted. La consola es para el Ministerio de El Salvador. Hoy predomina el tuteo, pero el login, el buscador y las investigaciones van en voseo.
2. **Selector de fecha:** el nativo estilizado o uno propio con 24 h fijas (recomiendo el propio).
3. **Qué sistema manda:** recomiendo el de la consola y llevar Jules a sus medidas.
4. **Qué acciones faltantes entran en la beta:** cancelar o cerrar un evento, reabrir una alerta descartada, retirar unidades, eliminar lista, regla o cámara.

---

## 12. Orden de trabajo propuesto hasta el 15-dic

| Etapa | Qué | Resultado |
|---|---|---|
| **1. Bugs operativos** (1–2 días) | Sección 1 completa: teclado, Esc, cambios sin guardar, NaN, alcance, error boundary, toast de error y deshacer, confirmaciones de lista, regla y usuario, foco | La consola no hace nada que el operador no pidió |
| **2. Tokens** (1 día) | z-index, sombras, radios, `--border-control`, escala de espaciado, Plex Mono 600, foco | Base pareja para los componentes |
| **3. Componentes** (3–4 días) | Modal, Popover/useLayer, Menu, Field, DateRange, Segmented/Tabs, Button/ActionBar, FileInput, MediaViewer, EmptyState/ErrorState | Un solo DS en `src/ui/` |
| **4. Migración por pantalla** (3–4 días) | Una ficha o panel por tarea, con plantilla de anatomía y regla de permisos | Cada pantalla igual a las demás |
| **5. Textos** (1 día) | Glosario y registro elegido, aplicados en todos los textos | Copy consistente |
| **6. Verificación** | Recorrido por rol con teclado, lector de pantalla y 1280 px | Entregable |

Código muerto para borrar o marcar como fase 2: `InvestigatePanel.tsx`, `InvestigationDock.tsx`, `AuditSheet` (no se puede abrir), `ReasonDialog`/`OpenStoryHost`, `.lb-scrim`, `.user select`, `select.fchip`.

---

## Avance de la sección 1 (27-nov, tarde)

Probado en la consola como Operador 911 y como Administrador. No hay commit todavía.

| # | Estado | Qué se hizo |
|---|---|---|
| 1.1 | ✅ | C, D y 1-5 solo actúan en la ficha visible: la del muro si el muro está abierto, y nunca con un diálogo o un menú abiertos. |
| 1.2 | ✅ | El `Dialog` del kit ahora usa `<dialog>` nativo: atrapa el foco, Esc cierra solo el diálogo y el foco vuelve a quien lo abrió. Hacer clic afuera ya no cierra los formularios. |
| 1.3 | ✅ | Evento, zona, cámara y rol preguntan "¿Descartar los cambios?" antes de salir con Esc, la X, Volver, un clic en el mapa u otra sección. Cerrar la pestaña del navegador también avisa. |
| 1.4 | ✅ | Una fecha vacía **se guardaba como 1-ene-2000** (Chrome lee el campo vacío así), no como NaN. `fromLocalInput` ahora la rechaza. Hay error en Inicio, Fin y los umbrales propios, y el foco va al primer error. |
| 1.5 | 🟡 | El aviso ya tiene versión de error (`toast(msg, { tone: 'error' })`). Falta que la API devuelva si algo falló, cuando llegue el backend. |
| 1.6 | ✅ | Error boundary en la raíz (ofrece "Recargar") y en cada ficha ("Reintentar" o "Cerrar la ficha"). El mapa sigue andando. |
| 1.7 | ✅ | La ficha de alerta y el buscador filtran por el alcance del rol. |
| 1.8 | 🟡 | Descartar una alerta o una coincidencia facial ahora se puede deshacer durante 8 s (`reopenAlert`, `reopenFacial`). Confirmar una identidad pide un segundo paso que dice a quién y qué pasa. Falta poder retirar unidades ya despachadas, que necesita API. |
| 1.9 | ✅ | Antes de cargar una lista se avisa que reemplaza las N entradas actuales, y el botón dice "Reemplazar con…". También se avisa si el archivo está vacío o no es un CSV. |
| 1.10 | ✅ | Apagar una regla y quitar un acceso se confirman, y se pueden deshacer. Encender una regla o devolver un acceso sigue siendo inmediato. |
| 1.11 | ✅ | "Subir archivo" se alcanza con Tab y muestra el anillo de foco. |
| 1.12 | 🟡 | Hay un aviso "Sin conexión con la plataforma" cuando el equipo pierde la red. Falta conectarlo al canal en vivo del backend. |
| 1.13 | ✅ | `--r-card` → `--radius-lg`. |
| 1.14 | ✅ | Se carga IBM Plex Mono 600. |
| 1.15 | ✅ | Los buscadores del mapa de persona y de la historia tienen anillo de foco. |
| extra | ✅ | Los avisos pasaron abajo al centro: abajo a la derecha tapaban "Confirmar" en la ficha. |

Los textos nuevos están escritos sin vos ni tú, hasta que se decida el registro (sección 11).

## Avance de la etapa 2: tokens (27-nov, tarde)

| Qué | Estado |
|---|---|
| **Espaciado** | Escala completa: `--space-0-5` (2) · 1 (4) · 1-5 (6) · 2 (8) · 2-5 (10) · 3 (12) · 3-5 (14) · 4 (16) · 5 (20) · 6 · 8 · 12 · 16. Se pasaron **726 valores** de padding, margin y gap a tokens, con la medida idéntica (comparado elemento por elemento). Quedan unos 120 valores fuera de la escala (1, 3, 5, 7, 9, 18, 22, 28 px…); ajustarlos mueve cosas a la vista, así que van con la migración de cada pantalla. |
| **Capas** | `--z-map-base/hud/pop/overlay` adentro del mapa; `--z-takeover < popover < dossier < lightbox < toast < tooltip < login` sobre la consola. Se resolvieron los choques: los avisos (antes 60) ahora quedan por encima del expediente; la tarjeta del mapa es tooltip (90); el menú de Jules ya no está a la par del expediente. Los 1–4 sueltos quedan solo para apilar marcadores. |
| **Sombras** | `--shadow-sm` y `--shadow-xl` nuevos, y `--shadow-on-media` para lo que va sobre foto o video. Se reemplazaron 10 sombras escritas a mano. |
| **Radios** | Todos los 2, 4, 8 y 12 px escritos a mano pasaron a `--radius-*`. |
| **Movimiento** | `--t-*` y `--ease-*` subieron al `:root` principal. |
| **Foco de campos** | `--ring-field` en la consola y en Jules (antes había dos versiones). Los campos usan `outline: 2px solid transparent`, así el foco sigue viéndose en el alto contraste de Windows. |
| **Contraste** | Los bordes de campos, segmentados, chips de filtro y buscadores pasaron a `--border-control` (de 1.6:1 a 3.3:1). El texto tenue sobre la fila seleccionada sube a `--ink-muted`. El botón rojo del abanico pasó a tinte con texto rojo (antes blanco sobre rojo, 4.1:1). |
| **Texto sobre video** | `--on-media` y `--on-media-muted` en lugar de `#fff` y `rgba` sueltos. |
| **Jules** | `--primary`, `--on-primary`, `--glass` y `--status-negative-tint` ya no se pisan dentro de Jules: ahora son `--sv-primary`, `--sv-on-primary`, `--sv-hover` y `--sv-negative-tint`. Jules se ve igual (verificado) y una clase de la consola puesta dentro de Jules ya no queda invisible. |

Cambio visible: los bordes de los controles se ven más claros (de #353535 a #636363). Es el arreglo de contraste que se buscaba.

## Avance de la etapa 3: componentes compartidos (27-nov, tarde)

Todo en `app/src/ui/`. Probado en el navegador como Administrador y como Analista.

| Componente | Qué reemplaza | Dónde se usa ya |
|---|---|---|
| `Button` + `IconButton` (`ui/Button.tsx`) | El botón de Sync (`.sv-btn`, más alto y en semibold) y el alias `.btn.solid` | Todo Jules (a través de `jules/ds/Button`, que ahora reexporta este). Los 15 `solid` pasaron a `primary`. `.iconbtn` suma las variantes primary, secondary y danger y el tamaño md. Se borró el CSS de `.sv-btn`. |
| `Dialog` (kit) con `description` y `className` | El `<dialog>` propio de Jules (`.sv-dialog`) | Los 3 diálogos de Jules ahora son el de la consola: mismo ancho, título, divisores y pie con botones sm. "Contanos cómo te va" pasó el Enviar al pie y sumó Cancelar. Se borró el CSS de `.sv-dialog`. |
| `Menu` (`ui/Menu.tsx`) + `useMenuKeyboard` | El menú del DS de Jules que usaba la consola, y el menú de evidencia de la barra del mapa sin teclado | Menú de cuenta, Jules, y el menú "Agregar evidencia" (que mantiene el aspecto HUD pero ahora responde a flechas, Esc y foco). El CSS pasó a `app.css` con tokens de la consola, y el foco de las opciones usa el anillo. |
| `Segmented` (`ui/Segmented.tsx`) | `.seg` sin semántica, o con `role="radio"` sin flechas | Radio de "¿Quién llega?", base del mapa, filtros de cámaras y de eventos, criticidad de regla, tipo de lista, alcance y nivel de un rol (8 lugares). Es un radiogroup con flechas y tabindex rotativo. Los `.seg` con `aria-pressed` quedaron como están, porque ya son correctos. |
| `Field`, `DateTimeField`, `DateRangeField`, `rangeErrors` (`ui/Field.tsx`) | Etiquetas sueltas, errores sin `aria-describedby`, validación de fechas distinta en cada lugar y la conversión de zona horaria duplicada | Las fechas del formulario de evento y "Cuándo pasó" de la evidencia (con `max` = ahora). Si se decide un selector propio de 24 h, se cambia solo este archivo. `.err` ahora tiene estilo en cualquier lugar. |
| `FileInput` (`ui/FileInput.tsx`) | El input gris del navegador ("Elegir archivos / Ningún archivo seleccionado") y el input oculto del CSV | Las dos formas de agregar evidencia y la importación de CSV. Es un botón de la consola, muestra el nombre del archivo elegido y se alcanza con el teclado. |
| `SheetNotFound` (`SheetHead.tsx`) | 9 fichas "No encontrada" con solo el título | Alerta, zona (2), evento, cámara (2), medio aéreo, facial y rol. Explica por qué puede pasar y ofrece "Cerrar la ficha". |
| Vacío en línea (`.empty`) | 3 estilos distintos de vacío en sublistas | Las 21 sublistas de las fichas ahora se ven igual: a la izquierda y en texto secundario. Se sumaron los vacíos que faltaban en "Cámaras que la cubren" y "Presets". |
| Tooltips | Botones de ícono sin `title` | 16 botones ahora muestran su etiqueta al pasar el mouse. |
| Teclado | ↑ ↓ de la bandeja capturadas en toda la ventana | La bandeja ya no se mueve cuando hay un menú, una lista, un grupo de opciones o un diálogo abiertos. |

**Pendiente de esta etapa:**
- `MediaViewer`: unir los tres visores de imagen (`.iv`, `.lb`, `ZoomImg`).
- `Tabs` único.
- `Combobox` para el buscador.
- Pasar el resto de los formularios a `Field`: configOps, configPlace, configSections, VehicleSheet y OpenStory.
- Selector de fecha propio de 24 h, si se decide.

**Encontrado en el camino:**
- Con un enlace a una zona que no existe (`?s=zona.ZN-NOEXISTE`), el mapa muestra "Enfocado en ZN-NOEXISTE".
- Los ejemplos del formulario de opinión de Jules hablan de "andenes", que vienen de Sync y no corresponden a esta consola.
