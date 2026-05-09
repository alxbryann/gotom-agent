import { tool } from 'ai';
import { z } from 'zod';

function escapeCsvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const exportToCsv = tool({
  description: `Convierte una lista de resultados (ej: negocios de OSM o Places) en un archivo CSV descargable.
El frontend renderiza un botón de descarga cuando esta tool devuelve \`data_url\`.
Excel y Google Sheets abren CSV directamente.
Úsalo cuando el usuario pida "exportar", "descargar", "excel", "csv", "archivo" con los resultados.`,
  inputSchema: z.object({
    filename: z
      .string()
      .describe('Nombre sugerido del archivo, sin extensión. Ej: "barberias-kennedy".'),
    rows: z
      .array(z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])))
      .describe('Filas a exportar. Cada objeto es una fila; las claves son las columnas.'),
  }),
  execute: async ({ filename, rows }) => {
    if (!rows || rows.length === 0) {
      return { error: 'No hay filas para exportar.' };
    }

    // Unión de todas las claves para no perder columnas si filas tienen shape distinto.
    const headerSet = new Set<string>();
    for (const r of rows) for (const k of Object.keys(r)) headerSet.add(k);
    const headers = Array.from(headerSet);

    const lines = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((r) => headers.map((h) => escapeCsvCell(r[h])).join(',')),
    ];
    // BOM para que Excel detecte UTF-8 con tildes correctamente.
    const csv = '﻿' + lines.join('\r\n');

    const safeName = filename.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'export';
    const base64 = Buffer.from(csv, 'utf8').toString('base64');

    return {
      filename: `${safeName}.csv`,
      mime: 'text/csv;charset=utf-8',
      data_url: `data:text/csv;charset=utf-8;base64,${base64}`,
      rows_count: rows.length,
      columns: headers,
    };
  },
});
