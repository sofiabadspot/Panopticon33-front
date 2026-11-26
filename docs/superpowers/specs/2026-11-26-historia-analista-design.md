# Historia del sujeto — vista Analista

Fecha: 26/11/2026 · Proto Panopticon 33 (`app/`) · Entrega: viernes 27/11

## Intención

El analista trabaja **después** del hecho: arma un caso y lo tiene que poder mostrar (al fiscal, al mando, al ministro). Hoy la consola le deja investigar **un lugar** ("¿Qué pasó acá?"), pero no seguir **a alguien** de punta a punta.

La Historia resuelve eso. El analista elige a quién o qué sigue (una placa, una persona de una lista, una persona sin identificar) y la consola le arma **la línea completa de cuándo y dónde se lo vio, con la evidencia de cada momento**. La puede reproducir como una historia y completar con lo que sabe.

Referencia: "Historias de GEV" en God's Eye View (`src/stories/` del repo de referencia). De ahí se toma la idea:
- capítulos a un costado
- el mapa que viaja de un punto al siguiente
- una barra de reproducción abajo, con los momentos clave marcados
- el medio (el clip) flotando sobre el lugar
- "Acerca de" y "Momentos clave"

No se toma el compartir ni ningún tipo de exportación.

Viene de la reunión del 26/11. Decisiones que cubre:
- la vista de ruta tiene una línea de tiempo navegable y deja agregar evidencia
- cada punto de detección muestra el clip de la cámara
- los analistas fijan datos internos y externos en el mapa

No cubre el informe exportable que también se habló: por ahora no se exporta nada (pedido de la usuaria, 26/11).

## Objetivos

- Abrir la Historia de un sujeto desde donde el analista lo encuentra:
  - el buscador
  - un vehículo fijado en una investigación por lugar
  - la ficha del vehículo
  - una alerta de placa o de persona
- Ver todas sus detecciones como **capítulos** en orden de fecha, cada uno con su hora, su lugar, su cámara, su certeza y su evidencia.
- **Reproducir** la historia: el mapa recorre los capítulos, con el tramo inferido punteado entre detecciones (lo que hicimos hoy) y el clip o la captura flotando en cada punto.
- **Navegar** la línea de tiempo: saltar a un capítulo, adelantar, pausar, con teclado.
- **Agregar evidencia** al mapa, interna o externa, que se suma como capítulo marcado "agregado por el analista".

## Fuera de alcance

- No hay búsqueda facial real a partir de una imagen subida. La "persona sin identificar" sale de datos simulados.
- No hay globo 3D ni Google 3D Maps (decisión de la reunión: postergado). Se usa el mapa 2D inclinado que ya existe.
- No se exporta nada: ni informe, ni PDF, ni enlace para compartir.
- No hay redes sociales (v2).
- No se comparte entre usuarios ni hay permisos finos sobre la historia. Queda para el backend.
- No reemplaza la investigación por lugar: conviven.

## Lo que la haría un fracaso aunque funcione

- **Que lo inferido se lea como observado.** El tramo entre dos cámaras siempre va punteado. Nunca se muestra como "pasó por acá" algo que ninguna cámara vio.
- **Que muestre evidencia ficticia como real.** El proto ya tiene una regla: sin imágenes inventadas, y donde no hay evidencia va el marcador B/N. Se respeta.
- **Que se pueda abrir sin motivo o sin quedar en la bitácora.** Toda historia pide motivo, igual que la ficha de vehículo, y queda auditada.
- **Que el analista no pueda distinguir lo que trajo el sistema de lo que agregó él.**

## Restricciones

- Sin backend: todo sale de `api/seed.ts`, `api/facial.ts` y `api/index.ts`. Cada función nueva documenta su endpoint, como el resto de la API.
- El mapa es MapLibre (`map/MapView.tsx`). Ya tiene:
  - recorrido animado (`route`, `playRoute`)
  - capturas proyectadas (`SnapCard`)
  - el cuadro "Recorrido" (`route-hud`)
  - modo foco
- Hoy el analista **no puede abrir la ficha facial** (`canOpenSheet`: `facial` es solo del operador 911 y de Mando). La Historia de una persona tiene que mostrarle sus detecciones sin abrirle la ficha de decisión del 911.
- La consola tiene tres columnas (izquierda: lista; centro: mapa; derecha: ficha) más una fila de abajo, que hoy ocupa la línea de tiempo de la investigación (`InvestigationDock`).
- Hay cambios sin commit en muchos archivos. Se construye encima, sin pisarlos.

## Enfoques considerados

| | Qué es | A favor | En contra |
|---|---|---|---|
| **A. Modo historia** (elegido) | Abrir una historia pone la consola en ese modo: capítulos a la derecha, sujeto y momentos clave a la izquierda, barra de reproducción abajo, mapa recorriendo. | Es lo que muestra GEV. Reusa recorrido, capturas, tramos punteados y la fila de abajo. Sirve igual para placa y para persona. | Es el más trabajoso: reproductor y modo nuevo. |
| B. Pestaña en la ficha | Pestaña "Historia" en el expediente y en la ficha del vehículo, con la lista de detecciones. | Es el más barato. | No se reproduce, queda partido por tipo de sujeto y no es lo que se pidió. |
| C. Informe aparte | Página que se genera al cerrar el caso. | Sirve para entregar. | No sirve para trabajar el caso. |

Se eligió **A**: la usuaria delegó la decisión pensando en el arquetipo Analista. Lo de **C** (exportar) quedó afuera por pedido de la usuaria.

## Diseño

### Sujeto

Una historia sigue a **un** sujeto:
- **Placa:** sus lecturas de 7 días (`vehicleProfile(plate).reads`).
- **Persona de una lista:** las detecciones de su coincidencia facial (`FacialMatch.detections`) y los hechos de su historia (`FacialMatch.story`) que tienen lugar.
- **Persona sin identificar:** un rostro sin identidad, simulado con una historia sembrada. Se rotula "Sin identificar · rostro de la captura X".

**Qué ve el analista de una persona de lista** *(decidido por la usuaria, 26/11)*:
- Ve: nombre, documento enmascarado, lista, motivo de la lista y fotos de la lista. Se muestran en el panel izquierdo de la historia y en el buscador.
- No ve el nivel de riesgo ni sus notas: son para quien interviene en la calle.
- Sigue sin poder abrir la ficha facial del 911 (`canOpenSheet` no cambia).
- *(Decisión de diseño)* No se puede abrir la historia de una coincidencia que el 911 descartó ("no es la misma persona"): esas detecciones son de otra persona. `openStory` lo impide y el buscador no la ofrece.

**Qué entra en la historia de una persona de lista** *(decisión de diseño)*:
- Las `detections` son capítulos observados, como las lecturas de una placa.
- Los hechos de `story` entran como **antecedentes**, con otra marca: "Antecedente · {fuente}".
  - Si su fuente es una cámara (por ejemplo CAM-014), se ubican en esa cámara.
  - Si la fuente no es una cámara (Denuncia, Fiscalía), van en la lista de capítulos **sin punto en el mapa**. El recorrido no pasa por ellos.
- Un hecho que coincide con una detección (misma cámara, menos de 2 min) se funde en el capítulo de la detección, y su texto queda como nota.
- La historia de una persona cubre todo lo que hay (hasta 40 días). La reproducción va por capítulos, así que los huecos largos no pesan.

### Cómo se abre

Siempre pide **motivo**, salvo que venga de una investigación, que ya lo tiene y se hereda. Usa los motivos de `SEARCH_REASONS` y queda en la bitácora como "Abrir historia".

Puntos de entrada:
1. **Buscador:** escribir una placa o el nombre o identificador de una persona de lista muestra "Historia de …" (solo para el analista).
2. **Investigación por lugar:** cada vehículo fijado suma el botón "Ver historia".
3. **Ficha de vehículo:** botón "Ver historia".
4. **Alerta de placa o de persona:** si el rol es analista, botón "Ver historia".
5. **Persona sin identificar** *(decisión de diseño)*: se llega desde un capítulo de otra historia que la menciona ("Aparece con: persona sin identificar · Ver su historia"). También desde el buscador, escribiendo "sin identificar".

Las historias abiertas se guardan en el estado, como las investigaciones, y se listan en la pestaña **Investigaciones** en una sección propia, "Historias".

### Capítulos

- **Un capítulo es una detección:** hora, cámara, calle, certeza y evidencia (la captura y, si existe, el clip de la cámara, con `cameraClip(cameraId)`).
- Lecturas seguidas en la misma cámara con menos de 2 minutos entre sí forman un solo capítulo, con "×N lecturas".
- Los capítulos que agrega el analista llevan una marca distinta, "Agregado por {nombre}", y van en su lugar por hora.
- Entre dos capítulos se ve el hueco de tiempo ("+38 min sin cámaras") y si el recorrido "no cierra" (la velocidad necesaria es imposible). Ya existe una regla parecida en `FacialSheet`.

**Ventana** *(decisión de diseño)*: si la historia viene de una investigación, arranca con la ventana de la investigación y un selector "Ventana del hecho / 7 días", igual que `InvestigationDock`. Desde cualquier otra entrada muestra todo.

### Momentos clave

Se marcan solos:
- primera detección
- la alerta que generó (si hubo)
- encuentro con otro sujeto en la misma cámara a menos de 90 s (la regla de `InvestigationDock`) *(decisión de diseño)*:
  - si la historia viene de una investigación, el otro sujeto es un vehículo fijado en ella;
  - si no, es un acompañante de `vehicleProfile(plate).companions`;
  - para personas, solo los vínculos de `FacialMatch.links` que tienen detección.
- última vez visto

El analista puede marcar o desmarcar cualquier capítulo como momento clave. Los momentos clave son puntos sobre la barra de reproducción y una lista a la izquierda.

### Pantalla (modo historia)

```
┌───────────────┬───────────────────────────────────────┬─────────────────────┐
│ HISTORIA      │                                       │ CAPÍTULOS  12       │
│ P 512-884     │        mapa (modo foco)               │ 1 11:43 SM-05  ●    │
│ Motivo · Caso │   ●───╌╌╌╌╌●  ┌clip─────┐            │ 2 11:51 SM-09       │
│               │              ╲ │ SM-09   │            │ 3 12:02 SM-12 ★     │
│ Acerca de     │               ●└─────────┘            │ ▶ 4 12:10 …  ahora  │
│ Momentos clave│                                       │ + Agregado: video   │
│ ★ Alerta 12:02│                                       │   de vecino 12:20   │
│ ★ Última vista│                                       │                     │
│ [+ Evidencia] │                                       │ [Buscar en la hist.]│
│               │                                       │                     │
├───────────────┴───────────────────────────────────────┴─────────────────────┤
│ ⏸  04/12 · 12:10 · SM-12  ●──●──★──▶──●───●─────●──●  0.5× 1× 2×  [Salir]   │
└─────────────────────────────────────────────────────────────────────────────┘
```

- **Columna izquierda:** cambia su contenido mientras dura la historia.
  - el sujeto (placa o persona) y el motivo
  - "Acerca de": cuántas detecciones, en qué ventana y cuántas cámaras
  - momentos clave
  - "Agregar evidencia"
- **Columna derecha:** la lista de capítulos, con un buscador como el de GEV. Clic en un capítulo salta a él. Se ve cuál se está reproduciendo.
- **Mapa:** modo foco (ya existe). El recorrido se va dibujando hasta el capítulo actual. El mapa se acerca y se mueve suave a cada capítulo (`easeTo`). La tarjeta del capítulo actual flota sobre el punto con el clip en bucle si hay video, la captura si no, o el marcador B/N.
- **Fila de abajo:** la barra de reproducción. Reemplaza a la línea de tiempo de la investigación mientras la historia está abierta.
  - play y pausa
  - capítulo actual y su hora
  - la barra con un segmento por capítulo y estrellas en los momentos clave
  - velocidad (0,5×, 1×, 2×)
  - "Salir de la historia"
- **Teclado:** `Espacio` reproduce o pausa, `←` y `→` pasan de capítulo, `Esc` sale. Mientras se escribe en un campo no corren.

### Reproducción

- El tiempo de la reproducción no es el tiempo real: cada capítulo dura lo mismo (unos 4 s a 1×) más el viaje al siguiente. Así un hueco de 3 horas no deja la pantalla quieta.
- La hora real siempre se lee en el capítulo y en la barra, y los huecos largos se rotulan.
- Arranca en pausa, en el capítulo 1, con el recorrido entero visto desde lejos. Play empieza el viaje.

### Agregar evidencia

1. "Agregar evidencia" pide un clic en el mapa (mismo patrón que Registrar incidentes).
2. Se completa:
   - **origen:** interna (alerta, lectura, cámara de la red, incidente registrado) o externa (cámara privada, video de un vecino, noticia, denuncia)
   - **tipo:** imagen, video, documento o registro, el mismo `ProofKind` del expediente
   - título, hora, fuente y enlace (opcional)
3. Entra como capítulo en su lugar por hora, con la marca "Agregado por …", y queda en la bitácora ("Agregar evidencia").
4. Sin archivos reales: se muestra el recuadro del tipo con su título y su fuente, como hoy en el expediente.
5. *(Decisión de diseño)* El origen "interna" es solo una etiqueta del formulario: no se elige un objeto del sistema. Lo que trajo el sistema ya está en los capítulos; lo agregado siempre es del analista.

### Datos y API

En `api/types.ts`:

```ts
export type StorySubject =
  | { k: 'placa'; plate: string }
  | { k: 'persona'; matchId: string }
  | { k: 'sin_identificar'; faceId: string };
export interface StoryChapter { id: string; at: number; lat: number; lon: number; place: string; cameraId?: string;
  confidence?: number; reads: number; evidence: Evidence[]; source: 'sistema' | 'analista'; addedBy?: string;
  key?: boolean; alertId?: string; note?: string }
export interface Story { id: string; subject: StorySubject; title: string; reason: string; caseId?: string;
  createdAt: number; createdBy: string; invId?: string; added: StoryChapter[]; keyOverrides: Record<string, boolean> }
```

En `api/index.ts` (cada función dice su endpoint, y las que corresponde pasan por `audit()`):

| Función | Qué hace |
|---|---|
| `openStory(subject, reason, user, invId?)` | Crea la historia y audita "Abrir historia". |
| `storyChapters(story)` | Arma los capítulos del sistema más los agregados, en orden, con los momentos clave ya calculados. |
| `addStoryEvidence(id, chapter, user)` | Suma evidencia y audita "Agregar evidencia". |
| `toggleKeyMoment(id, chapterId, user)` | Marca o desmarca un momento clave. |

En el estado: `stories: Story[]`.

En la consola (`console/ctx.tsx`): `storyId` y `setStoryId`, igual que `invId`. Con una historia abierta, la consola entra en modo historia.

Componentes nuevos (nombres a criterio del constructor):
- `StoryPanel` (izquierda)
- `StoryChapters` (derecha)
- `StoryPlayer` (fila de abajo)

`MapView` necesita poder:
- dibujar el recorrido **hasta** un capítulo dado, sin animarlo entero solo
- ir a un punto
- mostrar la tarjeta flotante de un capítulo con video

Hoy `playRoute` anima todo de una vez: hay que sumarle un modo controlado desde afuera (el índice del capítulo actual).

## Qué queda a criterio del constructor

- Nombres de archivos y componentes, y cómo partir `MapView` para el modo controlado.
- La duración exacta de cada capítulo y del viaje entre capítulos.
- Las historias sembradas para la demo: al menos una placa (la que hoy tiene recorrido, P 512-884), una persona de lista y una sin identificar.
- El estilo, siguiendo los componentes HUD que ya usa la consola (`route-hud`, `measure-card`, `lchip`, `kbd`).
