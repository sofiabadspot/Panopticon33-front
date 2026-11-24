# Panóptico 33 · consola beta

Interfaz de la beta del 15-dic: un único centro de mando sobre el mapa. Nada cambia de vista: abrir una zona, una alerta, un evento o una cámara la muestra en una ficha encima del mapa, y el mapa se mueve hacia ella.

## Cómo ejecutarla

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm run build      # genera dist/ para servir desde el servidor del Ministerio
```

`npm run dev` y `npm run build` ejecutan primero `scripts/sync-assets.mjs`. Ese script toma del prototipo (raíz del repo) la geometría real, el tema, los iconos y la evidencia.

## Cómo está armada

- **Mapa a pantalla completa.** Base de Google (Map Tiles API, roadmap oscuro o satélite) con la clave de `config.local.js`; sin clave o sin conexión, la base local de OpenStreetMap. Encima: calor, zonas, alertas, unidades, cámaras y recorridos.
- **Barra superior.** Buscador (zonas, placas, alertas, cámaras, calles, eventos y unidades) con búsquedas recientes; atajo `/` o ⌘K. Estado de Maic, hora y rol.
- **Barra de herramientas (izquierda).** Abre el panel de cada tarea según el rol.
- **Ficha (derecha).** El detalle de lo abierto, con volver y cerrar. La URL guarda `?p=panel&s=ficha` para el botón Atrás y para compartir.

| Rol | Abre con | Herramientas |
|---|---|---|
| Mando (`command`) | Estado | Estado, Alertas (lectura), Eventos |
| Operador 911 (`operator_911`) | Bandeja de alertas | Bandeja (confirma C / descarta D), Estado, Verificación facial (fase 3, deshabilitada) |
| Analista (`analyst`) | Investigar | Investigar: placas, historial de alertas y zonas; Alertas, Estado, Eventos |
| Administrador (`admin`) | Configuración | Configuración (zonas dibujadas en el mapa), Eventos (alta y edición), Estado |
| Auditor (`auditor`) | Bitácora | Bitácora, Estado |

## Estructura

```
src/api/        ÚNICO punto de datos. Cada función documenta su endpoint. Datos simulados + simulador en vivo.
src/map/        Mapa (MapLibre): base de Google o base local sin conexión, y capas operativas.
src/console/    La consola: estado (ctx), buscador, paneles y fichas.
src/shell/      Sesión y rol.
src/ui/kit.tsx  Icono, evidencia, severidad, sparkline, diálogo, toasts.
src/views/      Utilidades compartidas por paneles y fichas.
src/styles/     Medidas y componentes. Los colores salen del tema (css/theme.css del prototipo).
```

## Reglas que el código respeta

- La interfaz solo obtiene datos de `src/api`. Al conectar el backend se reemplaza el cuerpo de esas funciones.
- Toda consulta o decisión sensible pasa por `audit()`.
- "Sin dato" no es cero: una zona sin cobertura se ve rayada y con texto, nunca "0 personas".
- Solo se muestra evidencia real; donde aún no la hay, el marcador con el logo en B/N.
- El color es solo para estados, y siempre va con forma o texto (rombo crítica, triángulo media, círculo baja).

## Pendiente

- Evidencia real de aglomeración y de placas para la demo (hoy son marcadores).
- Decidir la base del mapa en producción: el documento pide funcionar sin internet; hoy se usa Google si hay conexión y la base local si no.
- Recorrido de placas por calles (hoy, línea recta entre cámaras; lo debe entregar el backend).
- Las respuestas a las preguntas abiertas del documento (umbrales, ubicación policial, base de robados, retención).
