import { tool } from 'ai';
import { z } from 'zod';
import { emptyLead, LeadSchema, type Lead } from '../lib/lead.js';

/**
 * Microservicio del partner que reemplaza el rol de Google Places en el
 * pipeline. El partner se encarga internamente de combinar Places + LLM
 * + scraping liviano para devolver leads con redes sociales, teléfono,
 * web, etc. Esta tool es el último paso de descubrimiento/enriquecimiento.
 *
 * Contrato del partner:
 *   POST <PARTNER_SCRAPER_URL>
 *   { "nicho": "barbería", "zona": "Bogotá, Kennedy",
 *     "candidates": Lead[]  // opcional: leads ya encontrados a enriquecer
 *   }
 *   → { "results": <objeto[] que mapeamos a Lead[]> }
 */

const PartnerResultSchema = z
  .object({
    placeId: z.string().nullable().optional(),
    name: z.string(),
    address: z.string().nullable().optional(),
    types: z.array(z.string()).nullable().optional(),
    status: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    location: z
      .object({
        latitude: z.number().nullable().optional(),
        longitude: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
    detail: z.string().nullable().optional(),
    // Campos enriquecidos opcionales — si el partner los devuelve los pasamos
    phone: z.string().nullable().optional(),
    whatsapp: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    instagram: z.string().nullable().optional(),
    facebook: z.string().nullable().optional(),
    tiktok: z.string().nullable().optional(),
    rating: z.number().nullable().optional(),
    ratings_count: z.number().nullable().optional(),
    google_maps_url: z.string().nullable().optional(),
  })
  .passthrough();

const PartnerResponseSchema = z.object({
  center: z
    .object({
      latitude: z.number().nullable().optional(),
      longitude: z.number().nullable().optional(),
      radiusMeters: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
  results: z.array(PartnerResultSchema),
});

function partnerStatusToLeadStatus(
  s: string | null | undefined,
): Lead['status'] {
  if (!s) return 'enriched';
  if (s === 'skipped') return 'skipped';
  if (s === 'error') return 'error';
  return 'enriched';
}

export const findBusinessPartner = tool({
  description: `Enriquece una lista de leads ya descubierta. Es el ÚLTIMO paso del pipeline.

NO descubre por sí solo — necesita que tú le pases \`candidates\` (los leads que sacaste
con \`find_local_businesses_osm\` o con la receta de scraping de Google Maps).

El microservicio del partner los procesa y te devuelve los mismos negocios + info nueva
que encuentre: redes sociales (Instagram, Facebook, TikTok), teléfono, web, email.
Algunos pueden volver con \`status: "skipped"\` si el partner no logró enriquecerlos —
preserva los datos originales que ya tenías.

Devuelve \`Lead[]\` con el mismo shape de OSM y del CSV.`,
  inputSchema: z.object({
    nicho: z
      .string()
      .describe('Categoría del negocio en español. Ej: "barbería", "panadería", "restaurante".'),
    zona: z
      .string()
      .describe('Ciudad y zona separadas por coma. Ej: "Bogotá, Kennedy" o "Medellín, Laureles".'),
    candidates: z
      .array(LeadSchema)
      .min(1)
      .describe(
        'OBLIGATORIO. Lista de leads ya encontrados (OSM o scraping). El partner los enriquece — no los descubre desde cero.',
      ),
  }),
  execute: async ({ nicho, zona, candidates }) => {
    const url = process.env.PARTNER_SCRAPER_URL?.trim();
    if (!url) {
      return {
        error:
          'PARTNER_SCRAPER_URL no configurada. Pega la URL del microservicio del partner en el .env y reinicia el agente.',
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    const token = process.env.PARTNER_SCRAPER_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const body = JSON.stringify({ nicho, zona, candidates });

    let raw: unknown;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return {
          error: `Partner devolvió ${res.status}. Detalle: ${text.slice(0, 300)}`,
        };
      }
      raw = await res.json();
    } catch (err) {
      return {
        error: `No se pudo contactar al partner: ${(err as Error).message}`,
      };
    }

    const parsed = PartnerResponseSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        error: `Respuesta del partner con shape inesperado: ${parsed.error.message}`,
        raw,
      };
    }

    // Indexamos los candidates por placeId/name para preservar los datos que
    // ya teníamos (ej. zona detectada por OSM) cuando el partner devuelve un
    // entry como "skipped" sin enriquecer.
    const baseByKey = new Map<string, Lead>();
    for (const c of candidates) {
      if (c.google_place_id) baseByKey.set(c.google_place_id, c);
      baseByKey.set(c.name.toLowerCase(), c);
    }

    const results: Lead[] = parsed.data.results.map((r) => {
      const base =
        (r.placeId && baseByKey.get(r.placeId)) ||
        baseByKey.get(r.name.toLowerCase());
      return emptyLead({
        name: r.name,
        category: base?.category ?? nicho,
        zone: base?.zone ?? null,
        city: base?.city ?? null,
        country: base?.country ?? null,
        address: r.address ?? base?.address ?? null,
        latitude: r.location?.latitude ?? base?.latitude ?? null,
        longitude: r.location?.longitude ?? base?.longitude ?? null,
        phone: r.phone ?? base?.phone ?? null,
        whatsapp: r.whatsapp ?? base?.whatsapp ?? null,
        email: r.email ?? base?.email ?? null,
        website: r.website ?? base?.website ?? null,
        instagram: r.instagram ?? base?.instagram ?? null,
        facebook: r.facebook ?? base?.facebook ?? null,
        tiktok: r.tiktok ?? base?.tiktok ?? null,
        google_place_id: r.placeId ?? base?.google_place_id ?? null,
        google_maps_url: r.google_maps_url ?? base?.google_maps_url ?? null,
        rating: r.rating ?? base?.rating ?? null,
        ratings_count: r.ratings_count ?? base?.ratings_count ?? null,
        source: 'partner',
        status: partnerStatusToLeadStatus(r.status),
        notes: r.reason || r.detail || null,
      });
    });

    return {
      source: 'partner',
      nicho,
      zona,
      center: parsed.data.center ?? null,
      total: results.length,
      enriched_count: results.filter((r) => r.status === 'enriched').length,
      skipped_count: results.filter((r) => r.status === 'skipped').length,
      results,
    };
  },
});
