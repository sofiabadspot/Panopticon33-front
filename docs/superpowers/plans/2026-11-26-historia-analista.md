# Historia del analista — plan de construcción

> **Para agentes:** SUB-SKILL REQUERIDO: usar superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Objetivo:** que el analista abra la Historia de un sujeto (placa, persona de lista, persona sin identificar) y la recorra como en "Historias de GEV": capítulos, mapa que viaja, reproductor y evidencia agregada.

**Arquitectura:**
- La lógica de los capítulos es una función pura en `api/story.ts`, sin datos ni React, y se prueba con `node --test`.
- `api/index.ts` le pasa los datos (lecturas, detecciones, antecedentes) y guarda las historias en el estado, igual que las investigaciones.
- La consola entra en "modo historia" cuando `storyId` está puesto. Ese modo reemplaza:
  - el panel izquierdo, por `StoryPanel`
  - la ficha derecha, por `StoryChapters`
  - la fila de abajo, por `StoryPlayer`
- El mapa recibe el recorrido con el capítulo actual (`routeAt`) en lugar de animarlo entero.

**Tecnología:** React 19, TypeScript, MapLibre GL 6, Vite. Sin backend: todo sale de los datos sembrados. No hay runner de pruebas: la lógica pura se prueba con `node --test` (Node 24 quita los tipos solo) y la interfaz se verifica en el navegador.

**Spec:** [docs/superpowers/specs/2026-11-26-historia-analista-design.md](../specs/2026-11-26-historia-analista-design.md)

**Maqueta aprobada:** `/private/tmp/claude-501/-Users-sofiaabad-Documents-GitHub-Panopticon33-front/89755e27-4c99-4a6d-9095-da2036e232f5/scratchpad/historia-design/historia-analista.html`. Está en un directorio temporal: si ya no está, se usa el boceto ASCII del spec.

## Restricciones globales

- **Textos:** en español rioplatense (voseo), igual que la consola.
- **Lo inferido no se lee como observado:**
  - El tramo entre detecciones siempre va punteado.
  - Los antecedentes sin cámara no tienen punto en el mapa y el recorrido no pasa por ellos.
- **Sin evidencia ficticia:** donde no hay clip ni captura va el marcador B/N (`/assets/logo-spotvision-bn.png`), como en `markers.tsx`.
- **Motivo:** toda historia pide motivo de `SEARCH_REASONS`, salvo que venga de una investigación, que ya lo tiene y se hereda. Audita "Abrir historia". Agregar evidencia audita "Agregar evidencia".
- **No se exporta nada:** ni informe, ni PDF, ni enlace.
- **Qué ve el analista de una persona de lista:**
  - Ve: nombre, documento enmascarado (`docId`), lista, motivo de la lista y fotos de la lista.
  - No ve: `risk`.
  - `canOpenSheet` no cambia: el analista sigue sin abrir la ficha facial.
- **Coincidencias descartadas:** no se puede abrir la historia de una coincidencia facial con `status === 'descartada'`.
- **Reproducción:** cada capítulo dura 4 s a 1×. Velocidades: 0,5×, 1× y 2×. Arranca en pausa en el capítulo 1. Atajos: `Espacio`, `←`, `→`, `Esc`, que no corren mientras se escribe en un campo.
- **Agrupar lecturas:** lecturas seguidas en la misma cámara a menos de 2 min forman un capítulo. Un antecedente en la misma cámara a menos de 2 min de una detección se funde con ella.
- **Encuentro:** otro sujeto en la misma cámara a menos de 90 s.
- **Estilo:** las piezas HUD existentes (`route-hud`, `measure-card`, `lchip`, `kbd`, `btn`) y los tokens del tema. Nada de literales de color nuevos.
- **Commits:** hay trabajo de Sofía sin commit en los mismos archivos. Cada paso "Commit" se hace **solo si Sofía lo pide**. Si no, se saltea y se sigue.

## Puntos de revisión

1. **Historia con 0 o 1 detección:** el mapa no puede romperse (hoy `MapView` dibuja recorrido solo con 2 paradas o más). Se espera:
   - con 1, un punto sin línea;
   - con 0, el estado vacío "Sin detecciones en esta ventana".
   Se prueba en la tarea 1 (`buildChapters` con 0 y 1) y en la tarea 4 (verificación).
2. **Antecedentes sin ubicación:** si entran al encuadre o al recorrido, el mapa salta a (0,0). Se espera que queden fuera de las paradas del mapa. Se prueba en la tarea 1 (`routeStops` los excluye).
3. **Teclado mientras se escribe:** un `Espacio` en el formulario de evidencia no tiene que reproducir. Se prueba en la tarea 5 (verificación).
4. **Abrir sin motivo, o una coincidencia descartada:** la historia no se abre. Se prueba en la tarea 2 (`openStory` devuelve `null`).
5. **Cambiar de rol o de escenario con una historia abierta** (por ejemplo "Cargando datos", que vacía los datos): sin error, y la historia se cierra o queda vacía. Se prueba en la tarea 3 (`storyId` se borra al desmontar la consola por cambio de rol; con datos vacíos se ve el estado vacío).

---

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `src/api/story.ts` (nuevo) | Lógica pura: arma los capítulos, los momentos clave y los huecos. Solo `import type`. |
| `tests/story.test.ts` (nuevo, fuera de `src`) | Pruebas con `node --test`. |
| `src/api/types.ts` | Tipos `StorySubject`, `StoryChapter` y `Story`. |
| `src/api/facial.ts` | Exporta `facialMatches()` y la historia sembrada de una persona sin identificar. |
| `src/api/index.ts` | Estado `stories`, `openStory`, `storyChapters`, `addStoryEvidence`, `toggleKeyMoment`, `storySubjectLabel`. |
| `src/console/ctx.tsx` | `storyId` y `setStoryId`. |
| `src/console/story/StoryPanel.tsx` (nuevo) | Columna izquierda: sujeto, motivo, ventana, acerca de, momentos clave y "Agregar evidencia". |
| `src/console/story/StoryChapters.tsx` (nuevo) | Columna derecha: buscador y lista de capítulos con sus huecos. |
| `src/console/story/StoryPlayer.tsx` (nuevo) | Fila de abajo: reproductor y atajos. |
| `src/console/story/OpenStory.tsx` (nuevo) | Diálogo de motivo y hook `useOpenStory()` para cada punto de entrada. |
| `src/console/story/EvidenceCard.tsx` (nuevo) | Tarjeta "Agregar evidencia" sobre el mapa. |
| `src/console/story/useStory.ts` (nuevo) | Estado de reproducción compartido (capítulo actual, reproduciendo, velocidad). |
| `src/map/MapView.tsx` | Modo controlado del recorrido (`routeAt`), tipo de parada y tarjeta con video. |
| `src/console/Console.tsx` | Modo historia: qué va en cada columna y en la fila de abajo. |
| Puntos de entrada | `Search.tsx`, `InvestigationDock.tsx`, `panels/InvestigatePanel.tsx`, `sheets/VehicleSheet.tsx`, `sheets/AlertSheet.tsx`. |
| `src/styles/app.css` | Estilos `.story-*`. |

---

### Task 1: Lógica de capítulos (pura, con pruebas)

**Archivos:**
- Crear: `app/src/api/story.ts`, `app/tests/story.test.ts`
- Modificar: `app/src/api/types.ts` (agregar al final)

**Interfaces:**
- Produce, en `types.ts` (tal cual el spec):
  - `StorySubject = { k: 'placa'; plate: string } | { k: 'persona'; matchId: string } | { k: 'sin_identificar'; faceId: string }`
  - `StoryChapter { id; at; lat: number | null; lon: number | null; place; cameraId?; confidence?; reads; evidence: Evidence[]; source: 'sistema' | 'analista' | 'antecedente'; addedBy?; srcLabel?; key?; keyLabel?; alertId?; note?; mentions?: StorySubject }`
  - `Story { id; subject; title; reason; caseId?; createdAt; createdBy; invId?; window?: { from: number; to: number }; added: StoryChapter[]; keyOverrides: Record<string, boolean> }`

  Ajustes respecto del spec: `lat` y `lon` pueden ser `null` (antecedentes sin cámara), y se suman `source: 'antecedente'`, `srcLabel`, `keyLabel`, `window` y `mentions` (para la persona sin identificar).
- Produce, en `story.ts`:
  - `export interface Sight { at: number; cameraId: string; place: string; lat: number; lon: number; confidence: number; evidence: Evidence }`
  - `export interface Prior { at: number; label: string; src: string; camera?: { id: string; lat: number; lon: number; place: string } }`
  - `export interface Other { label: string; sights: { at: number; cameraId: string }[] }`
  - `export function buildChapters(sights: Sight[], priors: Prior[], added: StoryChapter[], opts: { alertAt?: { at: number; alertId: string }; others?: Other[]; keyOverrides?: Record<string, boolean>; window?: { from: number; to: number } }): StoryChapter[]`
  - `export function routeStops(chs: StoryChapter[]): StoryChapter[]`: solo los que tienen `lat`.
  - `export function gapBefore(chs: StoryChapter[], i: number): { min: number; impossible: boolean } | null`: `impossible` si para cubrir la distancia hace falta más de 90 km/h.
  - `export const GROUP_MS = 120_000, ENCOUNTER_MS = 90_000, CHAPTER_MS = 4_000`

- [ ] **Paso 1: escribir las pruebas que fallan** en `app/tests/story.test.ts` (`import { test } from 'node:test'; import assert from 'node:assert/strict'; import { buildChapters, routeStops, gapBefore } from '../src/api/story.ts';`):
  - `vacío`: `buildChapters([], [], [], {})` → `[]`.
  - `una detección`: devuelve 1 capítulo, `source === 'sistema'`, `key === true` y `keyLabel === 'Primera detección'` (también es la última: queda un solo momento con la etiqueta "Primera detección").
  - `agrupa lecturas`: dos lecturas en `SM-05` a 0 y 60 s y una en `SM-09` a 300 s → 2 capítulos, el primero con `reads === 2`.
  - `no agrupa a más de 2 min`: `SM-05` a 0 y a 130 s → 2 capítulos.
  - `antecedente sin cámara`: `{ at: -10 días, label: 'Denuncia', src: 'Fiscalía' }` → capítulo con `source === 'antecedente'`, `lat === null` y `srcLabel === 'Fiscalía'`; `routeStops` lo excluye.
  - `antecedente fundido`: un prior con cámara `SM-05` a +60 s de una lectura en `SM-05` → no se suma capítulo y la lectura queda con `note === prior.label`.
  - `orden`: un capítulo agregado por el analista a una hora intermedia queda entre las dos lecturas, con `source === 'analista'`.
  - `momentos clave`: primera y última detección marcadas; `alertAt` marca el capítulo más cercano con `keyLabel === 'Se generó ' + alertId`; un `Other` en la misma cámara a 60 s marca `keyLabel === 'Encuentro con ' + label`; `keyOverrides[id] = false` desmarca.
  - `ventana`: con `window`, quedan afuera las lecturas fuera de `from`–`to`; los antecedentes y lo agregado no se filtran.
  - `gapBefore`: dos paradas a 3 km con 1 min entre sí → `impossible === true`; a 3 km con 10 min → `false`; para un antecedente → `null`.
- [ ] **Paso 2: correrlas y ver que fallan.** `cd app && node --test tests/` → FAIL (no existe `story.ts`).
- [ ] **Paso 3: implementar `story.ts`.** Solo `import type`, sin `enum`. El id de cada capítulo es determinista: `${source}-${at}-${cameraId ?? i}`, así `keyOverrides` sobrevive a reconstruirlos. La distancia, con la misma aproximación que `metersBetween` en `api/index.ts` (copiada, porque `story.ts` no puede importar código).
- [ ] **Paso 4: correr.** `cd app && node --test tests/` → todas pasan. `cd app && npx tsc --noEmit -p .` → sin errores.
- [ ] **Paso 5: commit** (solo si Sofía lo pide).

### Task 2: Datos y API de historias

**Archivos:**
- Modificar: `app/src/api/facial.ts`, `app/src/api/index.ts`

**Interfaces:**
- Consume: `buildChapters`, `Sight`, `Prior` y `Other` (tarea 1).
- Produce, en `facial.ts`:
  - `export const facialMatches = (): FacialMatch[] => matches`
  - `export const UNKNOWN_FACES: { id: string; label: string; capture: string; sights: FacialDetection[]; seenWith: string }[]`: una persona sin identificar, `id: 'SI-0007'`, rotulada "Sin identificar · rostro de la captura {capture}", con 4 detecciones en cámaras que existen (`SM-*`) dentro de las últimas 3 h y `seenWith` = el `id` de la coincidencia de LB-0291.
- Produce, en `index.ts`:
  - Estado: `stories: Story[]` (inicial `[]`).
  - `export function canOpenStory(s: StorySubject): boolean`: `false` si es una persona cuya coincidencia está `descartada` o no existe.
  - `export function openStory(s: StorySubject, reason: string, user: User, from?: { invId: string }): Story | null`: `null` sin motivo o si `!canOpenStory`. Si ya hay una historia del mismo sujeto, la devuelve. Si viene de una investigación, hereda su motivo y su ventana (`window = { from, to }` de la investigación) y guarda `invId`. Audita "Abrir historia". Endpoint: `POST /v1/stories`.
  - `export function storyChapters(st: Story, range: 'ventana' | 'todo'): StoryChapter[]`. Las entradas salen de:
    - **placa:** `vehicleProfile(plate).reads` (evidencia: `read.evidence`). Los otros sujetos para los encuentros son las placas de la investigación (`invId`) o, si no hay, `companions` con sus `readsOf`.
    - **persona:** `detections` (evidencia: `{ type: 'imagen', src: capture }`), con `story` como antecedentes. La cámara de `src` se busca en `state.cameras`; si no está, queda sin ubicación. La alerta: la primera `FC-` de esa coincidencia, si existe.
    - **sin identificar:** `UNKNOWN_FACES`.
    - **las tres:** si el capítulo tiene clip (`cameraClip(cameraId)`), suma `{ type: 'clip', src, poster }` a la evidencia. Las coincidencias en la misma cámara a menos de 2 min con `seenWith` marcan `mentions: { k: 'sin_identificar', faceId }`.
  - `export function storySubjectLabel(s: StorySubject): { title: string; sub: string; photos?: string[]; facts: [string, string][] }`: para una persona, nombre, documento enmascarado, lista y motivo. Nunca `risk`.
  - `export function addStoryEvidence(id: string, ch: Omit<StoryChapter, 'id' | 'source' | 'addedBy' | 'reads'>, user: User): void`: audita "Agregar evidencia". Endpoint: `POST /v1/stories/{id}/evidence`.
  - `export function toggleKeyMoment(id: string, chapterId: string): void`.

- [ ] **Paso 1: implementar** lo anterior. El tipo de la evidencia agregada es el `ProofKind` del expediente, guardado en `evidence: [{ type: 'pendiente', caption: '{tipo} · {título} · {fuente}' }]`, para no simular archivos.
- [ ] **Paso 2: verificar tipos.** `cd app && npx tsc --noEmit -p .` → sin errores. `node --test tests/` → sigue pasando.
- [ ] **Paso 3: verificar en el navegador** (consola de la página, `http://localhost:5173`, rol Analista): con `import('/src/api/index.ts')` llamar:
  - `openStory({k:'placa',plate:'P 512-884'}, 'Solicitud de la Fiscalía', user)` → `Story`.
  - `storyChapters(...)` → 7 o más capítulos en orden.
  - `openStory` sobre la coincidencia descartada (`status === 'descartada'`) → `null`.
  - `openStory(..., '', user)` → `null`.
- [ ] **Paso 4: commit** (solo si Sofía lo pide).

### Task 3: Modo historia en la consola

**Archivos:**
- Modificar: `app/src/console/ctx.tsx`, `app/src/console/Console.tsx`, `app/src/styles/app.css`
- Crear: `app/src/console/story/useStory.ts`, `app/src/console/story/StoryPanel.tsx`, `app/src/console/story/StoryChapters.tsx`

**Interfaces:**
- Consume: `storyChapters`, `storySubjectLabel`, `toggleKeyMoment`, `routeStops`, `gapBefore`.
- Produce:
  - En `ctx`: `storyId: string | null`, `setStoryId(id: string | null)`. Abrir una historia cierra la ficha (`close()`) y no toca `invId`, así al salir se vuelve a la investigación.
  - En `useStory.ts`: `export function useStoryPlayback(n: number): { at: number; setAt(i: number): void; playing: boolean; setPlaying(b: boolean): void; speed: 0.5 | 1 | 2; setSpeed(s: 0.5 | 1 | 2): void }`. Avanza cada `CHAPTER_MS / speed`, se detiene en el último y vuelve a `at = 0` cuando cambia `n`. El estado vive en un contexto `StoryPlaybackProvider` que monta `Console` alrededor del modo historia, para que panel, capítulos, mapa y reproductor lean el mismo `at`.
  - `export function StoryPanel({ story }: { story: Story })` y `export function StoryChapters({ story }: { story: Story })`.
- En `Console.tsx`, con `c.storyId` y rol `analyst`:
  - `lcol` muestra `StoryPanel` en lugar de las pestañas y el panel;
  - `rcol` muestra `StoryChapters` (ancho `400px`);
  - la fila de abajo muestra `StoryPlayer` (tarea 5) en lugar de `InvestigationDock`;
  - la barra de comandos y el aviso de foco se ocultan;
  - el `hist-pill` no se muestra.
- `StoryPanel` sigue la maqueta:
  - encabezado "HISTORIA" y el sujeto (para una placa, la placa con su estilo; para una persona, foto, nombre, documento y lista);
  - motivo, y de qué investigación viene;
  - selector de ventana (`lchip`: "Ventana del hecho" / "7 días", que llama a `storyChapters` con `"ventana"` o `"todo"`), solo si `story.window`. Solo las placas vienen de una investigación, y sus lecturas son de 7 días;
  - "Acerca de": capítulos, cámaras, primera → última hora y una frase con los tramos que no cierran y lo agregado;
  - momentos clave: estrella, etiqueta y hora; clic salta al capítulo;
  - abajo, el botón "Agregar evidencia" (tarea 6).
- `StoryChapters` sigue la maqueta:
  - buscador que filtra por lugar, cámara o texto;
  - filas con número (antecedentes con "—"), lugar, detalle, píldoras ("★ {keyLabel}", "Antecedente · {src}", "Agregado por {nombre}", "⚠ El tramo no cierra"), hora (con fecha si no es de hoy) y el actual resaltado;
  - entre filas, "+N min sin cámaras · tramo inferido" si `gapBefore` da más de 5 min;
  - clic en una fila: `setAt(i)` y pausa;
  - botón chico de estrella en cada fila → `toggleKeyMoment`;
  - en un capítulo con `mentions`: "Aparece con: persona sin identificar · Ver su historia" (usa `useOpenStory` de la tarea 7; hasta entonces queda el texto sin acción).
- Estado vacío (0 capítulos): en las dos columnas, "Sin detecciones en esta ventana", con "Ver todo" si hay ventana.

- [ ] **Paso 1: implementar** `ctx`, `useStory`, `StoryPanel`, `StoryChapters` y el cambio de columnas en `Console`, más los estilos `.story-*` en `app.css` (tokens del tema; huecos y píldoras como en la maqueta).
- [ ] **Paso 2: verificar.**
  - `npx tsc --noEmit -p .` sin errores.
  - En el navegador, como Analista, poner `storyId` desde la consola de la página (`openStory` + exponer `setStoryId` en `window.__p33` solo en dev): se ven las dos columnas con los datos de P 512-884, y clic en un capítulo lo resalta.
  - Con el escenario "Cargando datos", estado vacío sin errores en consola.
  - Cambiar de rol con una historia abierta: la consola vuelve a montar sin errores.
- [ ] **Paso 3: commit** (solo si Sofía lo pide).

### Task 4: Recorrido controlado en el mapa

**Archivos:**
- Modificar: `app/src/map/MapView.tsx`, `app/src/console/Console.tsx`, `app/src/styles/app.css`

**Interfaces:**
- Consume: `routeStops` y el `at` de `useStoryPlayback` (lo traduce `Console` al índice de la parada).
- Produce, en `MapView`:
  - `RouteStop` suma `kind?: 'det' | 'add'` (el rombo de lo agregado) y `clip?: { src: string; poster?: string }`.
  - Prop nueva `routeAt?: number | null`. Con un número:
    - no se anima solo;
    - se dibuja el tramo hecho (punteado fuerte, como ahora) hasta la parada `routeAt`, y lo que falta con `route-ghost` (punteado tenue, ya existe);
    - la cámara va con `easeTo` (700 ms) a la parada actual, sin cambiar el zoom si ya está a 15 o más; si no, zoom 16;
    - solo la parada actual muestra su tarjeta (`SnapCard`); si tiene `clip`, es un `<video muted loop autoPlay playsInline>` en lugar de la imagen;
    - el `route-hud` muestra la referencia "Agregado" solo si hay paradas `add`.
  - Con 1 sola parada: el punto y su tarjeta, sin línea.

  Sin `routeAt`, todo sigue como hoy.
- En `Console`: en modo historia, `route` = las paradas de `routeStops(chapters)` (etiqueta = número de capítulo, "+" para lo agregado), `routeLabel` = el título del sujeto y `routeAt` = la parada que corresponde al capítulo actual. Si el capítulo actual es un antecedente sin ubicación, `routeAt` queda en la parada anterior.

- [ ] **Paso 1: implementar.**
- [ ] **Paso 2: verificar en el navegador.**
  - Cambiar el capítulo desde la lista: el mapa se mueve y la tarjeta cambia de parada.
  - Una historia de 1 detección (persona con una sola detección en la ventana, o ventana recortada): un punto sin errores.
  - Sin historia, abrir el recorrido de una placa desde una alerta: se anima como antes.
  - `read_console_messages` sin errores.
- [ ] **Paso 3: commit** (solo si Sofía lo pide).

### Task 5: Reproductor

**Archivos:**
- Crear: `app/src/console/story/StoryPlayer.tsx`
- Modificar: `app/src/console/Console.tsx`, `app/src/styles/app.css`

**Interfaces:**
- Consume: `useStoryPlayback`, los capítulos y `setStoryId`.
- Produce: `export function StoryPlayer({ chapters, onExit }: { chapters: StoryChapter[]; onExit: () => void })`. Contiene, como en la maqueta:
  - botón play/pausa redondo;
  - "NN / NN · hh:mm" y la cámara;
  - barra con un punto por capítulo, a la misma distancia: antecedente con borde punteado, agregado como rombo, el actual más grande y momentos clave con ★ arriba;
  - la hora real en los extremos;
  - clic en un punto salta;
  - velocidad (`seg` 0,5× / 1× / 2×);
  - "Salir de la historia" con `kbd` Esc.
- Atajos, con `window keydown`: `Espacio` reproduce o pausa, `←` y `→` pasan de capítulo, `Esc` llama a `onExit`. Se ignoran si el foco está en `input, textarea, select, [contenteditable]` o con modificadores. `Esc` hace `preventDefault` para que el `Esc` de la consola no cierre otra cosa.

- [ ] **Paso 1: implementar.**
- [ ] **Paso 2: verificar en el navegador.**
  - `Espacio` reproduce: los capítulos avanzan cada 4 s a 1× y cada 2 s a 2×.
  - Se detiene en el último.
  - `→` y `←` saltan.
  - Con el foco en el buscador de capítulos, `Espacio` escribe un espacio y no reproduce.
  - `Esc` sale y vuelve a la investigación (si había) o al panel Investigaciones.
- [ ] **Paso 3: commit** (solo si Sofía lo pide).

### Task 6: Agregar evidencia

**Archivos:**
- Crear: `app/src/console/story/EvidenceCard.tsx`
- Modificar: `app/src/console/story/StoryPanel.tsx`, `app/src/console/Console.tsx`, `app/src/styles/app.css`

**Interfaces:**
- Consume: `addStoryEvidence` y `placeLabel`.
- Produce: `export function EvidenceCard({ story, p, onClose }: { story: Story; p: LngLat | null; onClose: () => void })`. Usa la clase `measure-card`, como Registrar incidentes. Campos:
  - origen (`lchip` Interna / Externa);
  - tipo (`lchip` Imagen / Video / Documento / Registro);
  - título (obligatorio, de 3 caracteres o más);
  - hora (`datetime-local`; por defecto, la del capítulo actual);
  - fuente (obligatoria);
  - enlace (opcional);
  - coordenadas en mono con "clic en otro punto para moverlo";
  - Cancelar y "Agregar a la historia".

  Al agregar, el capítulo nuevo aparece en su lugar por hora y el reproductor salta a él.
- En `Console`: "Agregar evidencia" pone el mapa en espera de clic (`onMapClick`); el punto elegido se dibuja con el marcador de incidente "nuevo" (`mk-incident new`) y se abre la tarjeta. `Esc` en el formulario cierra la tarjeta y no sale de la historia: `EvidenceCard` hace `preventDefault` y `StoryPlayer` ignora un `Esc` con `defaultPrevented`.

- [ ] **Paso 1: implementar.**
- [ ] **Paso 2: verificar en el navegador.**
  - Agregar un video externo a las 12:24 → aparece entre los capítulos correctos, con "Agregado por {usuario}", como rombo en el mapa y en la barra, y queda en la bitácora (rol Auditor → Bitácora, acción "Agregar evidencia").
  - `Espacio` dentro del título no reproduce.
- [ ] **Paso 3: commit** (solo si Sofía lo pide).

### Task 7: Puntos de entrada y lista de historias

**Archivos:**
- Crear: `app/src/console/story/OpenStory.tsx`
- Modificar: `app/src/console/Search.tsx`, `app/src/console/InvestigationDock.tsx`, `app/src/console/panels/InvestigatePanel.tsx`, `app/src/console/sheets/VehicleSheet.tsx`, `app/src/console/sheets/AlertSheet.tsx`, `app/src/console/story/StoryChapters.tsx`

**Interfaces:**
- Consume: `openStory`, `canOpenStory`, `setStoryId` y `SEARCH_REASONS`.
- Produce: `export function useOpenStory(): (s: StorySubject, from?: { invId: string }) => void`.
  - Con `from`, abre directo (hereda el motivo).
  - Sin `from`, abre el diálogo de motivo: el `Dialog` de `jules/ds/Dialog.tsx` o el patrón de motivo de `VehicleSheet`, el que ya usa la ficha de vehículo. Elegir el motivo y confirmar llama a `openStory` y `setStoryId`.
  - Si `canOpenStory` es `false`, no hace nada: el botón ni aparece.
- Entradas (todas solo para el rol `analyst`):
  1. **Search:**
     - placa → "Historia de {placa}" (grupo Placas, ícono `route`);
     - nombre, `listRef` o `docId` de una persona de lista no descartada → "Historia de {nombre}" (grupo Personas, ícono `person_search`);
     - "sin identificar" → "Historia de la persona sin identificar SI-0007".
  2. **`InvestigationDock`:** en cada carril de vehículo fijado, junto al botón de recorrido, un botón "Ver historia" (ícono `play_arrow`) → `useOpenStory()({k:'placa', plate}, { invId })`.
  3. **`VehicleSheet`:** botón "Ver historia" junto a "Ver recorrido en el mapa".
  4. **`AlertSheet`:** si el rol es analista y la alerta es de placa → "Ver historia".
     El spec también nombra la alerta de persona, pero el analista no abre las alertas `FC-` (se convierten en la ficha facial, que no es suya): a la historia de una persona se llega por el buscador.
  5. **`StoryChapters`:** el enlace "Ver su historia" de `mentions`.
- **`InvestigatePanel`:** sin investigación abierta, sección "Historias" debajo de la lista de investigaciones, con cada historia de `state.stories` (título del sujeto, motivo y cuándo se abrió); clic la reabre.

- [ ] **Paso 1: implementar.**
- [ ] **Paso 2: verificar en el navegador**, como Analista:
  - Entrar por cada uno de los 5 caminos y que se abra la historia correcta.
  - El buscador no ofrece la coincidencia descartada.
  - Sin motivo, el botón de confirmar está deshabilitado.
  - La historia queda listada en "Historias" y se reabre.
  - Como Operador 911, ninguno de estos botones aparece.
- [ ] **Paso 3: commit** (solo si Sofía lo pide).

### Task 8: Repaso final

- [ ] **Paso 1:** `cd app && node --test tests/ && npx tsc --noEmit -p .` → todo pasa.
- [ ] **Paso 2:** recorrer en el navegador los cinco puntos de revisión de arriba y las tres historias de la demo (P 512-884, LB-0291 y SI-0007). Sacar una captura del modo historia reproduciendo. `read_console_messages` sin errores nuevos.
- [ ] **Paso 3:** comparar con la maqueta: columnas, orden de los elementos y textos.
