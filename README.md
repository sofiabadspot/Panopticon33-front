# Panopticon 33 · consola beta

Diseño e interfaz de la consola de operación de Panopticon 33 (SPOTVISION). Es la versión para la beta del 15 de diciembre.

## Cómo verla

Necesitás [Node.js](https://nodejs.org) 20 o superior.

```bash
npm install
npm run dev
```

Abrí <http://localhost:5173> en Chrome. En el ingreso sirve cualquier usuario y contraseña: es una demo. El rol (Mando, Operador 911, Analista…) se cambia desde el menú de la cuenta.

### Mapa de Google

Para ver el mapa de Google, copiá `config.example.js` como `config.local.js` y pegá la clave de Google Maps. Pedísela a Sofía. Ese archivo no se sube al repo. Sin clave, la consola funciona igual con el mapa local de calles.

## Qué hay en cada carpeta

| Carpeta | Qué es |
|---|---|
| `app/` | **La consola beta.** Todo el diseño y la interfaz viven acá. Detalle en [app/README.md](app/README.md). |
| `data/`, `media/`, `assets/`, `js/core.js`, `css/theme.css` | Datos de base: calles reales, cámaras, zonas, videos de evidencia, logos y colores. La consola los toma de acá al arrancar. |
| `index.html`, `js/`, `css/style.css` | Prototipo anterior de Julio. Queda como referencia; no es la consola actual. Sus notas están en [docs/prototipo-julio.md](docs/prototipo-julio.md). |
| `docs/` | Propuesta de UX y documentación. |

## Para publicarla

```bash
npm run build
```

Genera `app/dist/`, una carpeta estática lista para servir.
