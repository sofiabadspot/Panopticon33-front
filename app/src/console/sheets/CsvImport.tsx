/* Carga masiva desde CSV (o Excel guardado como CSV), como en Sync: se descarga la plantilla,
   se sube el archivo, se revisa una vista previa fila por fila y recién ahí se importa. */
import { useState, type ReactNode } from 'react';
import { Dialog, Icon } from '../../ui/kit';

export interface CsvColumn { key: string; label: string; example: string; required?: boolean }
export type RowResult<T> = { ok: T } | { error: string };

/** CSV con coma o punto y coma (el Excel en español guarda con punto y coma) y comillas. */
export function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const split = (l: string) => {
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (ch === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (ch === sep && !q) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur); return out.map((x) => x.trim());
  };
  const head = split(lines[0]).map((h) => h.toLowerCase());
  return lines.slice(1).map((l) => { const v = split(l); return Object.fromEntries(head.map((h, i) => [h, v[i] ?? ''])); });
}

const template = (cols: CsvColumn[]) => [cols.map((c) => c.key).join(';'), cols.map((c) => c.example).join(';')].join('\n');

export function CsvImport<T>({ title, what, columns, fileName, parse, preview, onImport, onClose }: {
  title: string; what: string; columns: CsvColumn[]; fileName: string;
  parse: (row: Record<string, string>, i: number) => RowResult<T>;
  /** Celdas de la vista previa de una fila válida. */
  preview: { head: string[]; row: (x: T) => ReactNode[] };
  onImport: (items: T[]) => void; onClose: () => void;
}) {
  const [file, setFile] = useState('');
  const [rows, setRows] = useState<RowResult<T>[] | null>(null);
  const ok = (rows ?? []).filter((r): r is { ok: T } => 'ok' in r).map((r) => r.ok);
  const bad = (rows ?? []).length - ok.length;

  const load = async (f: File | undefined) => {
    if (!f) return;
    setFile(f.name);
    const data = parseCsv(await f.text());
    const missing = columns.filter((c) => c.required && data.length && !(c.key in data[0]));
    setRows(missing.length ? [{ error: `Faltan columnas: ${missing.map((c) => c.key).join(', ')}` }] : data.map(parse));
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob(['﻿' + template(columns)], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = fileName; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <Dialog title={title} onClose={onClose} footer={<>
      <button className="btn ghost sm" onClick={onClose}>Cancelar</button>
      <button className="btn solid sm" disabled={!ok.length} onClick={() => onImport(ok)}>Importar {ok.length > 1 ? `${ok.length} ${what}` : ok.length === 1 ? `1 ${what.replace(/s$/, '')}` : what}</button>
    </>}>
      <ol className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-md)', display: 'grid', gap: 4 }}>
        <li>Descarga la plantilla y complétala en Excel. Una fila por {what.replace(/s$/, '')}.</li>
        <li>Guárdala como CSV y súbela aquí.</li>
        <li>Revisa la vista previa: solo se importan las filas sin errores.</li>
      </ol>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn secondary sm" onClick={download}><Icon name="download" />Descargar plantilla</button>
        <label className="btn ghost sm" style={{ cursor: 'pointer' }}>
          <Icon name="arrow_upward" />{file ? 'Cambiar archivo' : 'Subir archivo'}
          <input type="file" accept=".csv,text/csv" hidden onChange={(e) => { load(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {file && <span className="dim mono" style={{ fontSize: 'var(--fs-sm)' }}>{file}</span>}
      </div>
      <div className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
        Columnas: {columns.map((c, i) => <span key={c.key}>{i > 0 && ', '}<span className="mono">{c.key}</span>{c.required ? '' : ' (opcional)'}</span>)}
      </div>
      {rows && (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="chip ok">{ok.length} {ok.length === 1 ? 'fila lista' : 'filas listas'}</span>
            {bad > 0 && <span className="chip critica">{bad} {bad === 1 ? 'fila' : 'filas'} con errores</span>}
          </div>
          <div className="panel flush tbl-wrap" style={{ maxHeight: 260, overflow: 'auto' }}>
            <table className="tbl">
              <thead><tr><th className="r">Fila</th>{preview.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="r mono dim">{i + 2}</td>
                    {'ok' in r ? preview.row(r.ok).map((c, j) => <td key={j}>{c}</td>)
                      : <td colSpan={preview.head.length} style={{ color: 'var(--status-alert)' }}><Icon name="error" /> {r.error}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Dialog>
  );
}
