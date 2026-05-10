import { tool } from 'ai';
import { z } from 'zod';
import { emptyLead, LeadSchema, type Lead } from '../lib/lead.js';

/**
 * Llama al territory-analyzer (POST /analyze-territory).
 * Descubre negocios nuevos en Google Maps + enriquece con Street View + LLM.
 *
 * Contrato:
 *   POST PARTNER_SCRAPER_URL
 *   { category, zone, city, country?, radius?, maxResults?, existing_businesses? }
 *   → { query, stats, existing_businesses: Ms2Business[] }
 */

const Ms2BusinessSchema = z
  .object({
    name: z.string(),
    category: z.string().nullable().optional(),
    zone: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    phone: z.string().nullable().optional(),
    whatsapp: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    instagram: z.string().nullable().optional(),
    facebook: z.string().nullable().optional(),
    tiktok: z.string().nullable().optional(),
    google_place_id: z.string().nullable().optional(),
    google_maps_url: z.string().nullable().optional(),
    rating: z.number().nullable().optional(),
    ratings_count: z.number().nullable().optional(),
    source: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    notes: z.string().nullable().optional(),
  })
  .passthrough();

const TerritoryResponseSchema = z.object({
  query: z
    .object({
      category: z.string().optional(),
      zone: z.string().optional(),
      city: z.string().optional(),
      country: z.string().optional(),
      center: z
        .object({
          latitude: z.number().nullable().optional(),
          longitude: z.number().nullable().optional(),
          radiusMeters: z.number().nullable().optional(),
        })
        .optional(),
    })
    .optional(),
  stats: z
    .object({
      existingReceived: z.number().optional(),
      placesFound: z.number().optional(),
      dedupedAgainstExisting: z.number().optional(),
      newlyDiscovered: z.number().optional(),
      facadeDescribed: z.number().optional(),
      facadeSkipped: z.number().optional(),
    })
    .optional(),
  existing_businesses: z.array(Ms2BusinessSchema),
});

function ms2StatusToLeadStatus(s: string | null | undefined): Lead['status'] {
  if (!s) return 'enriched';
  if (s === 'skipped') return 'skipped';
  if (s === 'error') return 'error';
  return 'enriched';
}

export const findBusinessPartner = tool({
  description: `Descubre y enriquece negocios usando el territory-analyzer.
Busca en Google Maps los negocios del \`category\` en la \`zone\` y \`city\` indicadas,
aplica deduplicación contra los \`existing_businesses\` que ya tengas,
y enriquece cada resultado con Street View + análisis LLM de fachada.

Úsalo como último paso del pipeline o cuando quieras descubrir negocios nuevos
en una zona concreta. Devuelve \`Lead[]\` listos para exportar.`,
  inputSchema: z.object({
    category: z
      .string()
      .describe('Categoría del negocio en español. Ej: "barbería", "panadería", "restaurante".'),
    zone: z
      .string()
      .describe('Barrio o zona dentro de la ciudad. Ej: "Kennedy", "Laureles", "El Poblado".'),
    city: z
      .string()
      .describe('Ciudad. Ej: "Bogotá", "Medellín", "Cali".'),
    country: z
      .string()
      .optional()
      .describe('País. Por defecto "Colombia".'),
    radius: z
      .number()
      .optional()
      .describe('Radio en metros para la búsqueda (máx 50000). Por defecto 1500.'),
    maxResults: z
      .number()
      .optional()
      .describe('Máximo de negocios nuevos a analizar (1–60). Por defecto 20.'),
    existing_businesses: z
      .array(LeadSchema)
      .optional()
      .describe(
        'Leads ya conocidos para deduplicar y enriquecer. Opcional — si no pasas nada descubre desde cero.',
      ),
    icp_description: z
      .string()
      .optional()
      .describe(
        'Contexto del ICP extraído de la conversación con el usuario: producto, propuesta de valor, perfil del cliente ideal, ticket, etc. Ayuda al territory-analyzer a filtrar y priorizar mejor.',
      ),
  }),
  execute: async ({ category, zone, city, country, radius, maxResults, existing_businesses, icp_description }) => {
    const url = process.env.PARTNER_SCRAPER_URL?.trim();
    if (!url) {
      return {
        error:
          'PARTNER_SCRAPER_URL no configurada. Agrega la URL del territory-analyzer en el .env y reinicia el agente.',
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const token = process.env.PARTNER_SCRAPER_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const body = JSON.stringify({
      category,
      zone,
      city,
      ...(country && { country }),
      ...(radius && { radius }),
      ...(maxResults && { maxResults }),
      existing_businesses: existing_businesses ?? [],
      ...(icp_description && { icp_description }),
    });

    let raw: unknown;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          error: `Territory-analyzer devolvió ${res.status}. Detalle: ${text.slice(0, 300)}`,
        };
      }
      raw = await res.json();
    } catch (err) {
      return {
        error: `No se pudo contactar al territory-analyzer: ${(err as Error).message}`,
      };
    }

    const parsed = TerritoryResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `Respuesta del territory-analyzer con shape inesperado: ${parsed.error.message}`,
        raw,
      };
    }

    const baseByKey = new Map<string, Lead>();
    for (const c of existing_businesses ?? []) {
      if (c.google_place_id) baseByKey.set(c.google_place_id, c);
      baseByKey.set(c.name.toLowerCase(), c);
    }

    const results: Lead[] = parsed.data.existing_businesses.map((r) => {
      const base =
        (r.google_place_id && baseByKey.get(r.google_place_id)) ||
        baseByKey.get(r.name.toLowerCase());
      return emptyLead({
        name: r.name,
        category: r.category ?? base?.category ?? category,
        zone: r.zone ?? base?.zone ?? zone,
        city: r.city ?? base?.city ?? city,
        country: r.country ?? base?.country ?? country ?? null,
        address: r.address ?? base?.address ?? null,
        latitude: r.latitude ?? base?.latitude ?? null,
        longitude: r.longitude ?? base?.longitude ?? null,
        phone: r.phone ?? base?.phone ?? null,
        whatsapp: r.whatsapp ?? base?.whatsapp ?? null,
        email: r.email ?? base?.email ?? null,
        website: r.website ?? base?.website ?? null,
        instagram: r.instagram ?? base?.instagram ?? null,
        facebook: r.facebook ?? base?.facebook ?? null,
        tiktok: r.tiktok ?? base?.tiktok ?? null,
        google_place_id: r.google_place_id ?? base?.google_place_id ?? null,
        google_maps_url: r.google_maps_url ?? base?.google_maps_url ?? null,
        rating: r.rating ?? base?.rating ?? null,
        ratings_count: r.ratings_count ?? base?.ratings_count ?? null,
        source: 'partner',
        status: ms2StatusToLeadStatus(r.status),
        notes: r.notes ?? null,
      });
    });

    const { stats, query } = parsed.data;

    return {
      source: 'territory-analyzer',
      category,
      zone,
      city,
      center: query?.center ?? null,
      stats: stats ?? null,
      total: results.length,
      enriched_count: results.filter((r) => r.status === 'enriched').length,
      skipped_count: results.filter((r) => r.status === 'skipped').length,
      results,
    };
  },
});
