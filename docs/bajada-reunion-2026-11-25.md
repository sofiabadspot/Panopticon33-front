# Bajada · Reunión Panopticon 33 · 25 nov 2026

Sofía Abad y Gerardo López revisaron la consola beta, 14:14–14:44 UTC. Notas y transcripción en [Claude Meetings](https://claude.ai/meetings/TG7vWKet5KiEVmNCHMutQk).

**Entregable del viernes 27/11:** el flujo de validación y la visualización de evidencia de los tres casos de uso (omnipresencia policial, reconocimiento facial y lectura de placas), en una sola capa clara y navegable.

Prioridades: **P0** entra el viernes · **P1** después del viernes · **P2** idea a futuro.

## Orden de trabajo

Una por una, en este orden. Entre paréntesis, el punto del detalle más abajo.

**Para el viernes (P0)**

1. [x] Commitear el buscador del panel de alertas (2.5)
2. [x] Hexágonos H3 de tamaño fijo (1.2). El dato vive en celdas fijas de res 10, ~65 m (`HEX_RES` en `coverage.ts`). Lo que se ve son hexágonos de pocos píxeles según el zoom, sin borde, que se leen como un degradé: el hexágono es la forma de tomar el dato, no algo que el usuario tenga que leer
3. [x] Sacar el mapa de calor y mostrar la densidad por hexágono (1.1, 1.4). La gente es un campo continuo sobre toda la ciudad (el fondo de la ciudad es SIMULADO), de amarillo a rojo. Las zonas ya no dibujan contorno: se delimita el evento en curso con un borde de hexágonos
4. [~] Escala de colores de cobertura policial por hexágono, haya o no evento (1.3). Ya existe como lectura "Cobertura" de los hexágonos (verde ≤2 min, amarillo ≤4, rojo más), en toda la ciudad. Falta validarla con Gerardo y que coincida con el estado de la zona: hoy Redondel Olímpico dice "Sin cobertura" con sus hexágonos en verde
5. [ ] Separar lenguajes: alertas como íconos, cobertura como color del hexágono (2.1)
6. [ ] Elegir la iconografía de criticidad: Propuesta A o B, y cómo se marca el nivel (2.3)
7. [ ] Mostrar la criticidad en los íconos de alerta del mapa y de la lista (2.2)
8. [ ] Una sola alerta por placa: cada nueva lectura actualiza la alerta existente (2.4, 3.2)
9. [ ] "Ver recorrido" de placa con la captura y la cámara en cada punto (3.1). Ya hay un avance sin commitear: cada parada muestra su captura y se puede ocultar desde el HUD
10. [ ] Facial: sacar el paso "Reconstruir en 3D" (4.3)
11. [ ] Facial: la ficha muestra captura, todas las fotos de la lista y la reconstrucción 3D (4.2)
12. [ ] Facial: el operador 911 confirma o descarta la coincidencia (4.1)
13. [ ] Facial: al confirmar la identidad se genera y se escala la alerta (4.5)
14. [ ] Facial: filtro del 911 por lista (4.4)
15. [ ] Facial: una sola alerta por persona, con "Ver recorrido" (4.6)
16. [ ] Vistas por defecto: Operador 911 (alertas y unidades) y Mando (todo) (5.1, 5.2)
17. [ ] Agendar el seguimiento con Gerardo para el resto de los roles (8)

**Después del viernes (P1)**

18. [ ] Vista por defecto del Analista: hexágonos por filtro y período (5.3)
19. [ ] Vistas de Admin y Auditor, según lo que salga del seguimiento (5.4)
20. [x] Filtrar hexágonos por personas, cobertura o alertas (1.5). Un solo chip "Hexágonos" en la barra de capas con tres lecturas; el chip "Cobertura" aparte se sacó
21. [ ] Al crear un evento, elegir sus hexágonos en el mapa (1.6)
22. [ ] Criterios de criticidad configurables (2.6)
23. [ ] Ícono secundario de antigüedad de la alerta (2.7)
24. [ ] Mover "Buscar identidad" a la vista del Analista (4.7)
25. [ ] Simplificar el flujo de búsqueda de identidad de Julio (4.8)
26. [ ] Enrolamiento: cómo se agrega una persona a cada lista (4.9)
27. [ ] Escalar a un operador o supervisor, sin asignar unidades (6.2)
28. [ ] Escalamiento automático a MAIC por condiciones, vía Jules (6.3)

**A futuro (P2)**

29. [ ] Anillos kRing para encontrar qué unidad puede responder (1.7)
30. [ ] Asignar una unidad directo a una alerta (6.4)

---

## 1. Mapa: hexágonos H3 como base

Hoy el mapa usa un `heatmap` de MapLibre ([MapView.tsx:213](../app/src/map/MapView.tsx)) y los hexágonos H3 son una capa más que se prende aparte (`hex`, `covhex`, con [coverage.ts](../app/src/api/coverage.ts)). Gerardo pidió que **toda** la información del mapa se organice sobre la grilla H3.

| # | Cambio | Prioridad | Dónde |
|---|---|---|---|
| 1.1 | Sacar el mapa de calor y mostrar densidad, cobertura y alertas por hexágono | P0 | `MapView.tsx` (capa `heat`), `coverage.ts` |
| 1.2 | Usar hexágonos más chicos que los actuales (más granularidad). El tamaño es fijo y no cambia con el zoom | P0 | `resForZoom`, `peopleRes` en `coverage.ts` |
| 1.3 | Escala de colores por hexágono que muestre qué zonas tienen cobertura policial y cuáles no, haya o no evento | P0 | `MapView.tsx`, tokens de color en `app.css` |
| 1.4 | Si los hexágonos no se ven bien, quedan igual como base de cálculo (cobertura, distancias) aunque se dibuje otra cosa | P0 | `coverage.ts` |
| 1.5 | Filtrar hexágonos por personas, cobertura o cantidad de alertas | P1 | `HexMetric` en `coverage.ts` |
| 1.6 | Al crear un evento, elegir en el mapa los hexágonos donde ocurre | P1 | `EventSheet.tsx`, `EventsPanel.tsx` |
| 1.7 | Anillos que se expanden (`gridDisk` / kRing, como Uber) para encontrar qué unidad puede responder | P2 | `hexRing` en `coverage.ts` |

Referencia que mostró Gerardo: el artículo de Uber sobre H3 (índice espacial hexagonal) y la charla "H3: Tiling the Earth with Hexagons".

## 2. Alertas: criticidad, íconos y agrupación

| # | Cambio | Prioridad | Dónde |
|---|---|---|---|
| 2.1 | Separar lenguajes: **las alertas son íconos** y **los estados de cobertura son colores** dentro del hexágono. Así la criticidad deja de pisarse con el color del calor | P0 | `icons.tsx`, `MapView.tsx` |
| 2.2 | Darle criticidad a las alertas. Ejemplo: faltan policías para 170.000 personas pesa más que un auto robado | P0 | `Severity` ya existe en `types.ts`; falta mostrarla (`icons.tsx` hoy no tiene niveles) |
| 2.3 | Elegir cómo se ve la criticidad: tamaño, color, número 1–3 sobre el ícono o barras de señal. Cerrar Propuesta A o B | P0 | [propuesta-iconos-alertas.html](propuesta-iconos-alertas.html) |
| 2.4 | **Una sola alerta por placa o persona.** Si otra cámara la vuelve a detectar, se actualiza esa alerta ("ahora está en tal lugar"); no se crea otra | P0 | generación de alertas en `api/index.ts` / `seed.ts`, `QueuePanel.tsx` |
| 2.5 | Buscador del panel de alertas por número, placa, zona, calle, cámara o tipo. **Ya está hecho** (cambios sin commitear) | Hecho | `QueuePanel.tsx` |
| 2.6 | Criterios de criticidad configurables por el cliente | P1 | `ConfigSheet.tsx` / `configSections.tsx` (Reglas y umbrales) |
| 2.7 | Ícono secundario de antigüedad: la alerta pierde valor con el tiempo | P1 | `icons.tsx` |

## 3. Lectura de placas

| # | Cambio | Prioridad | Dónde |
|---|---|---|---|
| 3.1 | En "Ver recorrido", cada punto del recorrido abre la captura (snapshot) de esa cámara en ese momento. Hoy se ve la ruta pero no qué cámara la leyó ni la foto | P0 | `AlertSheet.tsx` (`RouteCard`, línea ~299), `VehicleSheet.tsx`, overlay `route` en `MapView.tsx` |
| 3.2 | El recorrido vive dentro de la alerta única de la placa (ver 2.4) | P0 | `AlertSheet.tsx` |

## 4. Reconocimiento facial

Entra en el entregable del viernes.

| # | Cambio | Prioridad | Dónde |
|---|---|---|---|
| 4.1 | El operador 911 tiene la última palabra: confirma o descarta la coincidencia. La plataforma solo entrega la coincidencia | P0 | `FacialSheet.tsx`, `api/facial.ts` |
| 4.2 | La ficha de coincidencia muestra captura, **todas** las fotos de la lista (no una) y la reconstrucción 3D | P0 | `FacialSheet.tsx:66` (hoy la reconstrucción es un hueco `fig(null, …)`) |
| 4.3 | Sacar el paso "Reconstruir en 3D": cada perfil ya tiene su reconstrucción, que se va afinando con cada detección | P0 | `FacialSheet.tsx` |
| 4.4 | Filtro del operador 911 para ver solo eventos faciales de ciertas listas | P0 | `QueuePanel.tsx` |
| 4.5 | Al confirmar la identidad se genera y se escala la alerta | P0 | `api/facial.ts` |
| 4.6 | Detecciones repetidas de la misma persona actualizan una sola alerta, con "Ver recorrido" igual que las placas | P0 | ver 2.4 y 3.1 |
| 4.7 | "Buscar identidad" (registro, pasaporte, bases del gobierno) sale de la vista del 911 y queda para el Analista | P1 | `InvestigatePanel.tsx`; prototipo de Julio en [prototipo-julio.md](prototipo-julio.md) |
| 4.8 | Simplificar el flujo de búsqueda de identidad del prototipo de Julio: a ninguno de los dos les resultó claro | P1 | — |
| 4.9 | Definir el enrolamiento: cómo se agrega una persona a cada lista (orden de captura, en investigación, etc.) | P1 | `AdminPanels.tsx` (Listas) |

## 5. Vistas por rol

Todos los filtros quedan disponibles para todos; lo que cambia es lo que cada rol ve al entrar.

| # | Rol | Vista por defecto | Prioridad |
|---|---|---|---|
| 5.1 | Operador 911 | Alertas y unidades; filtrar y priorizar lo urgente | P0 |
| 5.2 | Mando | Todo | P0 |
| 5.3 | Analista | Hexágonos por filtro y período, más que alertas en vivo | P1 |
| 5.4 | Resto de roles (Admin, Auditor) | Se revisa en el seguimiento con Gerardo | P1 |

Dónde: `shell/session.tsx` (pestaña inicial del rol), `console/Console.tsx`.

## 6. Escalamiento y MAIC

MAIC entrega su propia plataforma. Nosotros le mandamos eventos, pero lo que podamos cubrir con nuestra información lo resolvemos sin depender de ellos.

| # | Cambio | Prioridad | Dónde |
|---|---|---|---|
| 6.1 | **Se mantiene** el botón manual "Confirmar y enviar a Maic" para el viernes | P0 (sin cambios) | `AlertSheet.tsx:148` |
| 6.2 | Mientras no esté claro el protocolo de MAIC, el escalamiento va a un operador o supervisor, sin asignar unidades | P1 | `AlertSheet.tsx` |
| 6.3 | Escalamiento automático a MAIC cuando se cumplan ciertas condiciones (la capa de decisión de Jules), en lugar del botón | P1 | `console/jules.ts` |
| 6.4 | Asignar una unidad a una alerta: revisar si tiene una misión pendiente y, si no, despacharla. Hoy esto se coordina por radio | P2 | `markers.tsx`, `AlertSheet.tsx` |

## 7. Preguntas abiertas

- ¿Qué resolución H3 usamos?
- ¿Qué escala de colores muestra cobertura / sin cobertura?
- ¿Cómo se dibuja H3 directo sobre el mapa sin que se vuelva ilegible?
- ¿Cómo se cargan y configuran los criterios de criticidad?
- Iconografía de criticidad: ¿Propuesta A o B? ¿Tamaño, color, número o barras?
- ¿Sumamos el indicador de antigüedad?
- Modelo operativo de alertas y despacho: se define con MAIC.
- ¿Qué condiciones disparan el escalamiento automático a MAIC?
- ¿Cómo funciona el enrolamiento en listas?
- ¿Las detecciones faciales se ven desde el feed en vivo, como alerta cuando la persona está en una lista, o las dos cosas?

## 8. Tareas

- [ ] **Sofía · viernes 27/11** — Flujo de validación y visualización de evidencia de los tres casos de uso en una sola capa (secciones 1–5, todo lo P0).
- [ ] **Sofía · hoy** — Agendar seguimiento con Gerardo para revisar el resto de los roles y puntos.
