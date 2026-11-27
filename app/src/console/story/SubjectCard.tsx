/* Ficha del sujeto en el lateral de la investigación: el analista tiene a mano todo lo que se sabe de a quién
   sigue, sin salir del recorrido. Se arma con las mismas piezas que las fichas de la consola:
   · Persona, como la ficha de reconocimiento facial (FacialSheet): la galería de imágenes (fc-gallery), la
     caja «Metadatos» (box + details) y las listas en box flush. Arriba, la reconstrucción 3D del expediente.
     Del analista nunca sale el riesgo de la persona.
   · Vehículo, como la ficha de vehículo (VehicleSheet): los avisos (callout), la caja «Vehículo», las lecturas
     (como datos: las cifras no entran en el lateral), «Viaja junto a» y «Dónde se lo ve». Arriba, las capturas en la misma galería. */
import { Fragment, useState } from 'react';
import { vehicleProfile } from '../../api';
import { UNKNOWN_FACES, FACIAL_LISTS, useFacial } from '../../api/facial';
import { ago, dateTime, hhmm, pct } from '../../api/format';
import type { Story } from '../../api/types';
import { FaceCloud } from '../../ui/FaceCloud';
import { Evidence, Icon, useNow } from '../../ui/kit';
import { Shot } from '../sheets/FacialDossier';

const seedOf = (s: string) => [...s].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7);

export function SubjectCard({ story }: { story: Story }) {
  const s = story.subject;
  return s.k === 'placa' ? <VehicleCard plate={s.plate} /> : <PersonCard story={story} />;
}

/** Galería de imágenes: la misma de la ficha de reconocimiento facial. */
function Gallery({ items }: { items: { key: string; tag: string; title: string; node?: React.ReactNode }[] }) {
  if (!items.length) return null;
  return (
    <div className="fc-gallery">
      {items.map((x) => (
        <span key={x.key} className={`fc-tile ${x.tag === 'Lista' ? 'lista' : ''}`} title={`${x.tag} · ${x.title}`}>
          <span className="fc-ph">{x.node ?? <Shot />}</span>
          <span className="fc-cap"><b>{x.tag}</b>{x.title}</span>
        </span>
      ))}
    </div>
  );
}

function PersonCard({ story }: { story: Story }) {
  const faces = useFacial();
  const now = useNow(10000);
  const s = story.subject;
  const m = s.k === 'persona' ? faces.find((x) => x.id === s.matchId) : undefined;
  const u = s.k === 'sin_identificar' ? UNKNOWN_FACES.find((x) => x.id === s.faceId) : undefined;
  const [spin, setSpin] = useState(true);
  const dets = m?.detections ?? u?.sights ?? [];
  const last = dets[dets.length - 1];
  const cams = new Set(dets.map((d) => d.cameraId)).size;
  const imgs = [
    ...[...dets].reverse().map((d, i) => ({ key: 'd' + i, tag: 'Captura', title: `${hhmm(d.at)} · ${pct(d.score)}`, node: d.capture ? <img src={d.capture} alt={`Captura en ${d.place}`} /> : undefined })),
    ...(m?.listPhotos ?? []).map((p, i) => ({ key: 'l' + i, tag: 'Lista', title: `${p.caption} · ${p.year}`, node: p.src ? <img src={p.src} alt={p.caption} /> : undefined })),
  ];

  return (
    <>
      <div className="box">
        <div className="bh"><h3>Reconstrucción 3D</h3><span className="sub">{m?.profile3d.detections ?? dets.length} detecciones · no prueba la identidad</span></div>
        <div className="bb">
          <div className="subj-3d"><FaceCloud seed={seedOf(m?.listRef ?? u?.id ?? story.title)} label={`Reconstrucción 3D de ${story.title}`} interactive auto={spin} sway landmarks scan tags={false} /></div>
          <button className="btn ghost xs" aria-pressed={!spin} onClick={() => setSpin(!spin)}><Icon name={spin ? 'pause' : 'play_arrow'} />{spin ? 'Pausar giro' : 'Reanudar giro'}</button>
        </div>
      </div>

      <Gallery items={imgs} />

      <ul className="fc-facts">
        <li><Icon name="route" /><span>{dets.length} {dets.length === 1 ? 'detección' : 'detecciones'} en {cams} {cams === 1 ? 'cámara' : 'cámaras'}</span></li>
        {last && <li><Icon name="location_on" /><span>Última: {last.place} · {ago(last.at, now)}</span></li>}
      </ul>

      <div className="box">
        <div className="bh"><h3>Metadatos</h3></div>
        <div className="bb">
          {m ? (
            <dl className="details">
              <dt>Persona</dt><dd>{m.name}</dd>
              <dt>Documento</dt><dd className="mono">{m.docId}</dd>
              <dt>Motivo</dt><dd>{m.reason}</dd>
              {m.orderUntil && <><dt>Orden</dt><dd>Vigente hasta el {m.orderUntil}</dd></>}
              <dt>Lista</dt><dd>{FACIAL_LISTS[m.list].name} · <span className="mono">{m.listRef}</span></dd>
              {m.traits.filter((x) => x.list).map((x, i) => <Fragment key={i}><dt>{x.label}</dt><dd>{x.list}</dd></Fragment>)}
            </dl>
          ) : (
            <dl className="details">
              <dt>Persona</dt><dd>Sin identificar</dd>
              <dt>Descripción</dt><dd>{u?.label ?? '—'}</dd>
              {u && <><dt>Visto junto a</dt><dd>{faces.find((x) => x.id === u.seenWith)?.name ?? u.seenWith}</dd></>}
            </dl>
          )}
        </div>
      </div>

      {m && m.links.length > 0 && (
        <div className="box flush">
          <div className="bh"><h3>Vínculos</h3><span className="sub">{m.links.length}</span></div>
          <ul className="list bb">
            {m.links.map((l) => (
              <li key={l.id} className="item" style={{ gridTemplateColumns: '28px 1fr' }}>
                <span className="ic"><Icon name={l.kind === 'vehiculo' ? 'directions_car' : l.kind === 'persona' ? 'person' : l.kind === 'lugar' ? 'location_on' : 'description'} /></span>
                <div><div className="t">{l.label}</div><div className="s">{l.sub}</div></div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function VehicleCard({ plate }: { plate: string }) {
  const now = useNow(10000);
  const p = vehicleProfile(plate);
  const first = p.reads[0], last = p.reads[p.reads.length - 1];
  const imgs = [...p.reads].reverse().slice(0, 6).map((r) => ({ key: r.id, tag: r.cameraId, title: `${hhmm(r.at)} · ${pct(r.confidence)}`, node: r.evidence.type !== 'pendiente' ? <Evidence ev={r.evidence} small /> : undefined }));

  return (
    <>
      {p.listed && <div className="callout danger"><Icon name="warning" /><span className="grow"><b>{p.listed.reason}</b> desde el {p.listed.since} · caso <span className="mono">{p.listed.case}</span></span></div>}
      {p.mismatch && <div className="callout warn"><Icon name="swap_horiz" /><span className="grow">La cámara ve otro vehículo que el de la lista. Puede ser una placa clonada: revisa las fotos de las lecturas antes de concluir.</span></div>}

      <Gallery items={imgs} />

      <div className="box">
        <div className="bh"><h3>Vehículo</h3></div>
        <div className="bb"><dl className="details">
          {p.listed && <><dt>Según la lista</dt><dd>{p.listed.vehicle.type} · {p.listed.vehicle.make} · {p.listed.vehicle.color}</dd></>}
          <dt>Visto por cámara</dt><dd>{p.seen ? `${p.seen.type} · ${p.seen.color}` : 'Sin lecturas'}</dd>
          <dt>Titular registrado</dt><dd><span className="chip nodata">Registro vehicular sin conectar</span></dd>
        </dl></div>
      </div>

      {/* En el lateral angosto las cifras (kpis) no entran: van como datos, igual que la caja «Vehículo». */}
      <div className="box">
        <div className="bh"><h3>Lecturas</h3><span className="sub">7 días</span></div>
        <div className="bb"><dl className="details">
          <dt>Lecturas</dt><dd>{p.reads.length} en {p.cameras.length} {p.cameras.length === 1 ? 'cámara' : 'cámaras'}</dd>
          <dt>Última lectura</dt><dd>{last ? <>{ago(last.at, now)} · {last.street}</> : '—'}</dd>
          <dt>Primera lectura</dt><dd>{first ? dateTime(first.at) : '—'}</dd>
          <dt>Franja habitual</dt><dd>{p.usualHours ? `${p.usualHours[0]}–${p.usualHours[1]} h · 8 de cada 10 lecturas` : 'Pocas lecturas para un patrón'}</dd>
        </dl></div>
      </div>

      <div className="box flush">
        <div className="bh"><h3>Viaja junto a</h3><span className="sub">a menos de 90 s, en 2 cámaras o más</span></div>
        <ul className="list bb">
          {!p.companions.length && <li className="empty">Ningún vehículo se repite a su lado.</li>}
          {p.companions.map((x) => (
            <li key={x.plate} className="item" style={{ gridTemplateColumns: '1fr' }}>
              <div><div className="t"><span className="plate">{x.plate}</span>{x.listed && <span className="chip critica" style={{ height: 18, fontSize: 'var(--fs-2xs)' }}>En lista</span>}</div><div className="s">{x.times} {x.times === 1 ? 'vez' : 'veces'} en {x.cameras} cámaras</div></div>
            </li>
          ))}
        </ul>
      </div>

      <div className="box flush">
        <div className="bh"><h3>Dónde se lo ve</h3><span className="sub">{p.cameras.length}</span></div>
        <ul className="list bb">
          {!p.cameras.length && <li className="empty">Sin lecturas en 7 días.</li>}
          {p.cameras.slice(0, 5).map((x) => (
            <li key={x.id} className="item" style={{ gridTemplateColumns: '1fr auto' }}>
              <div><div className="t mono">{x.id}</div><div className="s">{x.street}</div></div><div className="r"><span className="mono">{x.n}</span></div>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
