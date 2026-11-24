import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// La consola se sirve desde el servidor del Ministerio sin internet: nada se carga de CDN.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, strictPort: true },
  // MapLibre carga su worker por URL relativa al módulo: el pre-empaquetado de Vite la rompe.
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
});
