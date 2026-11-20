# Panopticon 33 — consola (prototipo de validación)

SPOTVISION Government · Physical AI Agent: SENTINEL · Orquestación: MAIC · Agente: Jules

Prototipo navegable de la consola de operación. Sirve para validar pantallas con el Ministerio de Seguridad antes del desarrollo. La geografía es real (calles, cruces y coordenadas). Los eventos son simulados, salvo los tres clips de tránsito y los recortes de trazabilidad, que son salidas reales de SENTINEL (con rostros pixelados).

## Cómo ejecutarlo

1. Abre una terminal en esta carpeta.
2. Ejecuta `python3 -m http.server 8000`.
3. Abre `http://localhost:8000` en Chrome o Edge.

Debe servirse desde un servidor local. Si se abre `index.html` con doble clic, el navegador bloquea parte de los recursos.

## Vistas del mapa

La consola tiene cuatro vistas, que se alternan desde la barra inferior. La predeterminada es **Mapa**.

| Vista | Qué muestra | Motor | Necesita Internet y clave |
|---|---|---|---|
| **Mapa** (predeterminada) | El mapa estándar de Google con un estilo oscuro en la paleta de SPOTVISION | MapLibre GL JS + Google Map Tiles API (2D) | Sí |
| **Satélite** | Imagen satelital de Google con calles y nombres encima | MapLibre GL JS + Google Map Tiles API (2D) | Sí |
| **3D** | Ciudad fotorrealista en 3D | CesiumJS + Google Photorealistic 3D Tiles | Sí |
| **Táctico** | Vías y edificios de OpenStreetMap dibujados por la consola | three.js | No |

La clave se lee de `config.local.js`. Ese archivo está fuera del código de la consola y excluido del control de versiones (`.gitignore`). Para cambiar de clave, copia `config.example.js` como `config.local.js` y pega la nueva. Si el archivo no existe, la clave falla o no hay Internet, la consola arranca sola en vista táctica.

El estilo de marca del modo Mapa está en `js/map-google-2d.js` (`ROADMAP_STYLE`). Se envía a Google al abrir la sesión de mosaicos, y Google devuelve el mapa ya coloreado. La imagen satelital no se puede recolorear: solo se atenúa con el botón de la luna.

### Lectura del mapa (omnipresencia)

- **Barra de capas** con conteos: cámaras, cobertura, zonas, unidades e incidentes. Cada una se enciende o apaga.
- **Cobertura honesta:** campo de visión de cada cámara operativa y celdas rojas punteadas donde las vías principales no tienen cobertura (puntos ciegos). El cálculo está en `Coverage` (`js/core.js`).
- **Línea de estado del HUD:** frescura de cada fuente (SENTINEL, MAIC), cámaras operativas, cobertura de vías principales y puntos ciegos.
- **Incidentes** con codificación redundante: crítica = rombo rojo con pulso, media = triángulo amarillo, baja = círculo azul. En atención = aro verde.
- **Zoom semántico:** de lejos, mapa de calor de aglomeraciones; de cerca, área de cada zona.
- **Encuadres rápidos:** Sector, Plaza, Roosevelt, Escalón y Estadio (teclas 1 a 5).
- **Al abrir una alerta:** mosaico de las 4 cámaras operativas más cercanas y unidades de MAIC con tiempo estimado.

### Condiciones de uso de Google que el código respeta

- El logo de Google y el texto de derechos se muestran siempre (`#gmapCredits` en 2D, `#geoCredits` en 3D). No deben ocultarse ni taparse.
- No se descargan ni se guardan mosaicos. Las vistas de Google no funcionan sin conexión.
- El mapa se usa solo para visualizar. SENTINEL analiza el video de las cámaras, nunca las imágenes del mapa.
- No hay buscador de direcciones; si se agrega uno sobre estas vistas, debe ser el de Google.

### Seguridad de la clave

En una aplicación web la clave siempre es visible para quien inspeccione la página. La protección real son las restricciones configuradas en Google Cloud:

- **Restricción de API:** solo Map Tiles API.
- **Restricción de sitio web:** `http://localhost:8000/*` y `http://127.0.0.1:8000/*` para pruebas; el dominio real de la consola en producción.

## Estructura

```
index.html            Página única: intro, consola, Jules
config.local.js       Clave de Google (local, no versionado)
config.example.js     Plantilla del archivo anterior
css/style.css         Estilos. Tokens del SPOTVISION Design System 2.0, tema Government
js/core.js            §1 Config · §1b Routes (red vial y rutas) · §2 MockDB (datos simulados) y Coverage (cobertura) · §3 Api · §4 Sfx (audio)
js/map-tactical.js    §5 Globe (globo táctico) · §6 City (mapa táctico; fuente de verdad del mapa)
js/map-google-3d.js   §6b GeoMap (vista 3D fotorrealista; espejo de City)
js/map-google-2d.js   §6c GMap (vistas Mapa y Satélite de Google; espejo de City)
js/ui.js              §7 Evidence (evidencia real o marcador) · §8 UI (vistas, paneles, hojas)
js/video-wall.js      §8b Wall (muro de video)
js/identity-sources.js §9b SourceLab (búsqueda de identidad y conectores)
js/app.js             §9 FaceLab · §10 SceneLab · §11 Jules · §12 Boot y simulador en vivo
data/geo.js           Geodatos (Natural Earth y OpenStreetMap, ODbL)
data/media.js         Índice de evidencia real
media/                Clips y recortes
assets/               Logo, orbe de Jules, tipografía Erbaum
```

## Muro de video e identidad

- **Muro de video** (`js/video-wall.js`): todas las cámaras en rejilla (2×2 a 5×4), ordenadas por alerta. Filtros "Con alerta" y "Con video", ronda automática, filtros de visualización térmico y nocturno (son filtros de imagen, no sensores) y vista de una cámara con sus vecinas. En producción cada mosaico es el flujo en vivo (WebRTC o HLS).
- **Búsqueda de identidad** (`js/identity-sources.js`): el operador elige buscar un rostro en bases de datos institucionales o en fuentes abiertas. Cada fuente es un conector definido en `MockDB.sources` (`js/core.js`). Solo "Listas autorizadas en SENTINEL" está conectada. Las demás muestran la institución, lo que aportarían y cómo conectarlas: base de datos, API o MCP. Una fuente sin conectar nunca muestra datos.
- **Iconografía:** Material Symbols Sharp para la interfaz y `Glyph` (`js/map-tactical.js`) para la cámara CCTV y la unidad policial, igual en las tres vistas de mapa.

Las instituciones listadas (RNPN, DGME, PNC, FGR, DGCP, INTERPOL, VMT) son una propuesta. Cuáles se conectan y con qué alcance lo define el Ministerio. La búsqueda en redes sociales requiere un proveedor autorizado y base legal, porque las plataformas prohíben la extracción automática de rostros.

## Georreferencia

Todo lo que aparece en el mapa lleva `lat` y `lon` (WGS84), además de las coordenadas locales `x`/`z` que solo sirven para dibujar. El módulo `Geo` (`js/core.js`, §1c) concentra esa lógica.

- **Zonas:** son geocercas con perímetro real (`poly`): polígonos de OpenStreetMap para la plaza, el estadio y la estación, y corredores sobre el eje de la avenida para Roosevelt y Escalón. De ahí salen centroide, área y vértices.
- **Incidentes y alertas:** cada alerta nace con su coordenada (`locateAlert` en `js/app.js`): el punto del hecho dentro del campo de visión de la cámara, ajustado a la calzada en lecturas de placa e incidentes viales, o el centroide de la zona en aglomeraciones.
- **Mapa:** los incidentes son pines cuya punta marca la coordenada; al pasar el cursor por cualquier elemento se muestran sus coordenadas, y el HUD indica las del cursor.

## Caso de demostración (datos ficticios)

`MockDB.demoCase` (`js/core.js`) y `media/demo/` contienen un caso de coincidencia facial con datos de muestra: captura, retrato de registro y documento. Toda pantalla que lo muestra lleva el aviso "Ejemplo con datos ficticios (data dummy)". La fuente "Registro de identidad de muestra" solo responde a ese caso.

## Iconos y color

Iconos de Blueprint (Palantir, Apache-2.0) en `data/icons.js`, aplicados por el módulo `Icons` sobre el marcado `<span class="ms">nombre</span>`. La paleta es la de SPOTVISION con saturación y brillo reducidos (variables en `css/style.css`).

## Datos reales y datos simulados

| Elemento | Origen |
|---|---|
| Calles, cruces y nombres | Reales (OpenStreetMap y Google) |
| Ubicación de cámaras | Cruces reales del sector, con su latitud y longitud. La asignación de cada cámara a un cruce es de demostración; se reemplaza por el inventario del ministerio |
| Rutas de despacho, patrullaje y recorridos | Calculados sobre la red vial real (`Routes` en `js/core.js`) |
| Clips de tránsito (3) y recortes de trazabilidad | Reales, generados por SENTINEL. Su ubicación en el mapa es asignada |
| Alertas, conteos, placas, candidatos y unidades | Simulados |

**Regla de evidencia:** la consola solo muestra material real. Donde aún no hay material de demostración aparece el logo de SPOTVISION en blanco y negro (`Evidence.placeholder` en `js/ui.js`). No se dibujan imágenes inventadas.

## Reglas de arquitectura para el desarrollo

1. **La interfaz solo obtiene datos de `Api`** (`js/core.js`, §3). Cada método documenta el endpoint que el backend debe implementar. Al conectar el backend real se reemplaza el cuerpo de esos métodos; las vistas no cambian.
2. **`City` es la fuente de verdad del mapa.** `GMap` y `GeoMap` se registran con `City.addMirror(...)` y replican las mismas órdenes (`flyTo`, `pulse`, `showTrace`, `dispatchUnits`, `updateZone`, `setCameraStatus`). Para añadir otra vista de mapa basta implementar esos métodos.
3. **Toda consulta sensible pasa por `Api.audit`** (búsqueda de placa, análisis facial, trazabilidad, despachos). En producción el registro lo hace el backend en cada endpoint.
4. **Reconocimiento facial:** la interfaz muestra candidatos con puntaje, nunca identidades. Ver la identidad requiere rol Analista.

## Pendiente antes de pasar a desarrollo

- Contrato de APIs formal (OpenAPI para REST y AsyncAPI para tiempo real) a partir de `Api`.
- Confirmar con MAIC cómo expone unidades y despachos.
- Confirmar la zona del POC (Centro Histórico o Salvador del Mundo).
- Migración a React + TypeScript + Vite con los componentes del Design System, manteniendo estos mismos módulos.
