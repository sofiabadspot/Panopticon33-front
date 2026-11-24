/** Nebulosa (marca de Jules). Copia de sentinel-front/src/components/ds/nebulosa/renderer.js. */
export type JulesState = 'idle' | 'listen' | 'think' | 'speak';
export function registerOrb(canvas: HTMLCanvasElement): { set(state: JulesState): void; dispose(): void };
