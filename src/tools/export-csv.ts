import { tool } from 'ai';
import { z } from 'zod';
import { LEAD_COLUMNS } from '../lib/lead.js';

/**
 * Columnas canónicas que aporta `profile_prospects` (gtm-insights-module).
 * Se anexan al final del Lead cuando el agente exporta tras perfilar, así el
 * Excel queda con: identidad/contacto/social del lead + ICP score, priority,
 * métricas comerciales y talk track listos para que el equipo de ventas use
 * el archivo sin volver al chat.
 */
const PROFILING_COLUMNS = [
  'rank',
  'priority',
  'icp_score',
  'viable',
  'estimated_ltv_usd',
  'estimated_cac_usd',
  'ltv_cac_ratio',
  'recommended_channel',
  'conversation_tone',
  'best_contact_time',
  'opening_line',
  'talk_track',
  'why_viable',
  'pain_points',
  'growth_signals',
  'trust_signal',
  'common_ground',
  'personalized_value_prop',
  'objection_prep',
] as const;

type AnyRecord = Record<string, unknown>;

function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Si las filas tienen al menos `name` + `source` + `status` (los tres
 * obligatorios del Lead), usamos el orden canónico de columnas para que
 * todos los CSVs del agente se vean iguales sin importar la fuente.
 */
function looksLikeLeadRows(rows: Array<Record<string, unknown>>): boolean {
  if (rows.length === 0) return false;
  const sample = rows[0];
  return (
    typeof sample.name === 'string' &&
    typeof sample.source === 'string' &&
    typeof sample.status === 'string'
  );
}

function normalizeName(v: unknown): string {
  return typeof v === 'string' ? v.trim().toLowerCase() : '';
}

/** Listas (talk_track, pain_points, growth_signals) → string legible en Excel. */
function joinList(v: unknown): string {
  if (Array.isArray(v)) {
    return v
      .map((x) =>
        typeof x === 'string'
          ? x
          : x && typeof x === 'object'
            ? JSON.stringify(x)
            : String(x ?? ''),
      )
      .filter(Boolean)
      .join(' | ');
  }
  if (v == null) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/**
 * Aplana un `ranked_prospects[i]` (o `non_viable[i]`) al set de columnas
 * planas que entran al CSV. Es defensivo: cualquier sub-objeto puede faltar.
 */
function flattenProspect(p: AnyRecord): AnyRecord {
  const viability = (p.viability as AnyRecord) ?? {};
  const mm = (p.marketing_metrics as AnyRecord) ?? {};
  const bi = (p.business_intelligence as AnyRecord) ?? {};
  const ca = (p.commercial_approach as AnyRecord) ?? {};
  const cf = (ca.commercial_foundation as AnyRecord) ?? {};

  return {
    rank: p.rank ?? null,
    priority: viability.priority ?? null,
    icp_score: viability.icp_score ?? null,
    viable: viability.viable ?? null,
    estimated_ltv_usd: mm.estimated_ltv_usd ?? null,
    estimated_cac_usd: mm.estimated_cac_usd ?? null,
    ltv_cac_ratio: mm.ltv_cac_ratio ?? null,
    recommended_channel: ca.recommended_channel ?? null,
    conversation_tone: ca.conversation_tone ?? null,
    best_contact_time: ca.best_contact_time ?? null,
    opening_line: ca.opening_line ?? null,
    talk_track: joinList(ca.talk_track),
    why_viable: bi.why_viable ?? null,
    pain_points: joinList(bi.pain_points),
    growth_signals: joinList(bi.growth_signals),
    trust_signal: cf.trust_signal ?? null,
    common_ground: cf.common_ground ?? null,
    personalized_value_prop: cf.personalized_value_prop ?? null,
    objection_prep: cf.objection_prep ?? null,
  };
}

/**
 * Construye un índice `nombre normalizado → prospect` a partir del payload
 * de `profile_prospects`. Acepta tres formas porque el agente a veces pasa:
 *   - el objeto completo que devolvió la tool (`{ source, profiling: {...} }`)
 *   - solo el `profiling` interno (`{ ranked_prospects, non_viable, ... }`)
 *   - directamente un array de prospects.
 */
function buildProspectIndex(profiling: unknown): Map<string, AnyRecord> {
  const idx = new Map<string, AnyRecord>();
  if (!profiling) return idx;

  const buckets: AnyRecord[][] = [];

  const collect = (obj: AnyRecord | null | undefined) => {
    if (!obj) return;
    if (Array.isArray(obj.ranked_prospects)) buckets.push(obj.ranked_prospects as AnyRecord[]);
    if (Array.isArray(obj.non_viable)) buckets.push(obj.non_viable as AnyRecord[]);
  };

  if (Array.isArray(profiling)) {
    buckets.push(profiling as AnyRecord[]);
  } else if (typeof profiling === 'object') {
    const obj = profiling as AnyRecord;
    collect(obj);
    collect(obj.profiling as AnyRecord | undefined);
  }

  for (const arr of buckets) {
    for (const item of arr) {
      const key = normalizeName(item.business_name) || normalizeName(item.name);
      if (key) idx.set(key, item);
    }
  }
  return idx;
}

export const exportToCsv = tool({
  description: `Convierte una lista de resultados (ej: negocios de OSM o Places) en un archivo CSV descargable.
El frontend renderiza un botón de descarga cuando esta tool devuelve \`data_url\`.
Excel y Google Sheets abren CSV directamente.
Úsalo cuando el usuario pida "exportar", "descargar", "excel", "csv", "archivo" con los resultados.

IMPORTANTE — si ya corriste \`profile_prospects\` para esos leads, pasá también
el argumento \`profiling\` con el último \`profiling\` que devolvió esa tool. El
CSV mergea por nombre y agrega columnas con icp_score, priority, talk_track,
pain points, opening line, etc. Sin eso el archivo sale "pelado", solo Lead.`,
  inputSchema: z.object({
    filename: z
      .string()
      .describe('Nombre sugerido del archivo, sin extensión. Ej: "barberias-kennedy".'),
    rows: z
      .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
      .describe('Filas a exportar. Cada objeto es una fila; las claves son las columnas.'),
    profiling: z
      .any()
      .optional()
      .describe(
        'Output de `profile_prospects`. Puede ser el objeto completo `{ source, profiling: {...} }`, solo el `profiling` interno, o un array de `ranked_prospects`. Si lo pasás y las filas son Leads, el CSV mergea por nombre y agrega icp_score, priority, talk_track, pain_points, opening_line, etc. Pasalo SIEMPRE que hayas perfilado a esos leads.',
      ),
  }),
  execute: async ({ filename, rows, profiling }) => {
    if (!rows || rows.length === 0) {
      return { error: 'No hay filas para exportar.' };
    }

    const isLeadRows = looksLikeLeadRows(rows);
    const prospectIndex = profiling
      ? buildProspectIndex(profiling)
      : new Map<string, AnyRecord>();
    const hasProfiling = isLeadRows && prospectIndex.size > 0;

    let headers: string[];
    let finalRows: AnyRecord[] = rows as unknown as AnyRecord[];

    if (hasProfiling) {
      headers = [...LEAD_COLUMNS, ...PROFILING_COLUMNS] as string[];
      finalRows = (rows as unknown as AnyRecord[]).map((r) => {
        const key = normalizeName(r.name);
        const match = key ? prospectIndex.get(key) : undefined;
        const flat = match ? flattenProspect(match) : {};
        return { ...r, ...flat };
      });
    } else if (isLeadRows) {
      headers = LEAD_COLUMNS as unknown as string[];
    } else {
      // Si las filas son shapes mixtos (no Lead), unimos todas las claves
      // para no perder columnas.
      const headerSet = new Set<string>();
      for (const r of rows) for (const k of Object.keys(r)) headerSet.add(k);
      headers = Array.from(headerSet);
    }

    const lines = [
      headers.map(escapeCsvCell).join(','),
      ...finalRows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(',')),
    ];
    // BOM para que Excel detecte UTF-8 con tildes correctamente.
    const csv = '\uFEFF' + lines.join('\r\n');

    const safeName = filename.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'export';
    const base64 = Buffer.from(csv, 'utf8').toString('base64');

    // Cuántas filas terminaron con datos de profiling — útil para que el
    // modelo le diga al usuario "12 de 15 leads vienen con scoring".
    const profiledRows = hasProfiling
      ? finalRows.filter((r) => r.icp_score != null || r.priority != null).length
      : 0;

    return {
      filename: `${safeName}.csv`,
      mime: 'text/csv;charset=utf-8',
      data_url: `data:text/csv;charset=utf-8;base64,${base64}`,
      rows_count: rows.length,
      columns: headers,
      profiled_rows: profiledRows,
    };
  },
});
