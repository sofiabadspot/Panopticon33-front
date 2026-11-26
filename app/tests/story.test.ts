import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChapters, routeStops, gapBefore } from '../src/api/story.ts';
import type { Sight, Prior } from '../src/api/story.ts';
import type { StoryChapter } from '../src/api/types.ts';

const T0 = 1_800_000_000_000;
const ev = { type: 'imagen' as const, caption: 'x' };
const sight = (cameraId: string, s: number, lat = -33.4, lon = -70.6): Sight =>
  ({ at: T0 + s * 1000, cameraId, place: cameraId, lat, lon, confidence: 0.9, evidence: ev });
const added = (s: number): StoryChapter => ({
  id: 'a-' + s, at: T0 + s * 1000, lat: -33.4, lon: -70.6, place: 'Nota', reads: 0, evidence: [], source: 'analista',
});

test('vacío', () => {
  assert.deepEqual(buildChapters([], [], [], {}), []);
});

test('una detección', () => {
  const c = buildChapters([sight('SM-05', 0)], [], [], {});
  assert.equal(c.length, 1);
  assert.equal(c[0].source, 'sistema');
  assert.equal(c[0].key, true);
  assert.equal(c[0].keyLabel, 'Primera detección');
});

test('agrupa lecturas', () => {
  const c = buildChapters([sight('SM-05', 0), sight('SM-05', 60), sight('SM-09', 300)], [], [], {});
  assert.equal(c.length, 2);
  assert.equal(c[0].reads, 2);
});

test('no agrupa a más de 2 min', () => {
  assert.equal(buildChapters([sight('SM-05', 0), sight('SM-05', 130)], [], [], {}).length, 2);
});

test('antecedente sin cámara', () => {
  const p: Prior = { at: T0 - 10 * 86_400_000, label: 'Denuncia', src: 'Fiscalía' };
  const c = buildChapters([sight('SM-05', 0)], [p], [], {});
  const a = c.find((x) => x.source === 'antecedente')!;
  assert.equal(a.lat, null);
  assert.equal(a.srcLabel, 'Fiscalía');
  assert.ok(!routeStops(c).includes(a));
});

test('antecedente fundido', () => {
  const p: Prior = { at: T0 + 60_000, label: 'Denuncia', src: 'Fiscalía', camera: { id: 'SM-05', lat: -33.4, lon: -70.6, place: 'x' } };
  const c = buildChapters([sight('SM-05', 0)], [p], [], {});
  assert.equal(c.length, 1);
  assert.equal(c[0].note, 'Denuncia');
});

test('orden', () => {
  const c = buildChapters([sight('SM-05', 0), sight('SM-09', 600)], [], [added(300)], {});
  assert.equal(c.length, 3);
  assert.equal(c[1].source, 'analista');
});

test('momentos clave', () => {
  const sights = [sight('SM-05', 0), sight('SM-09', 600), sight('SM-11', 1200)];
  let c = buildChapters(sights, [], [], {});
  assert.equal(c[0].keyLabel, 'Primera detección');
  assert.equal(c[2].keyLabel, 'Última vez visto');
  c = buildChapters(sights, [], [], { alertAt: { at: T0 + 590_000, alertId: 'A-1' } });
  assert.equal(c[1].keyLabel, 'Se generó A-1');
  c = buildChapters(sights, [], [], { others: [{ label: 'Juan', sights: [{ at: T0 + 660_000, cameraId: 'SM-09' }] }] });
  assert.equal(c[1].keyLabel, 'Encuentro con Juan');
  const id = c[0].id;
  c = buildChapters(sights, [], [], { keyOverrides: { [id]: false } });
  assert.ok(!c[0].key);
});

test('ventana', () => {
  const p: Prior = { at: T0 - 10 * 86_400_000, label: 'Denuncia', src: 'F' };
  const c = buildChapters([sight('SM-05', 0), sight('SM-09', 600), sight('SM-11', 5000)], [p], [added(9000)], {
    window: { from: T0 + 300_000, to: T0 + 1_000_000 },
  });
  assert.equal(c.filter((x) => x.source === 'sistema').length, 1);
  assert.equal(c.length, 3);
});

test('gapBefore', () => {
  const far = (s: number) => sight('C' + s, s, -33.4 + 0.027, -70.6);
  let c = buildChapters([sight('A', 0), far(60)], [], [], {});
  assert.equal(gapBefore(c, 1)!.impossible, true);
  c = buildChapters([sight('A', 0), far(600)], [], [], {});
  assert.equal(gapBefore(c, 1)!.impossible, false);
  const p: Prior = { at: T0 - 86_400_000, label: 'D', src: 'F' };
  c = buildChapters([sight('A', 0)], [p], [], {});
  assert.equal(gapBefore(c, 0), null);
});

test('routeStopAt: parada del capítulo, la anterior para un antecedente sin cámara, null sin paradas', async () => {
  const { routeStopAt } = await import('../src/api/story.ts');
  const loc = (id: string): StoryChapter => ({ id, at: 0, lat: -33.4, lon: -70.6, place: id, reads: 1, evidence: [], source: 'sistema' });
  const none = (id: string): StoryChapter => ({ id, at: 0, lat: null, lon: null, place: id, reads: 0, evidence: [], source: 'antecedente' });
  const chs = [none('a0'), loc('d1'), none('a1'), loc('d2'), loc('d3')];
  assert.equal(routeStopAt(chs, 0), 0); // antecedente sin nada antes: la primera parada
  assert.equal(routeStopAt(chs, 1), 0);
  assert.equal(routeStopAt(chs, 2), 0); // antecedente: se queda en la parada anterior
  assert.equal(routeStopAt(chs, 3), 1);
  assert.equal(routeStopAt(chs, 4), 2);
  assert.equal(routeStopAt([none('x')], 0), null);
  assert.equal(routeStopAt([], 0), null);
});
