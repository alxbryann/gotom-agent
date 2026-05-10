import type { Lead } from './lead.js';

/**
 * Cliente determinista del módulo GTM-Insights de perfilamiento de prospectos.
 *
 * Contrato (POST {GTM_INSIGHTS_ANALYZE_URL}):
 *   {
 *     product_context: { name, description, target_industry, price_range, value_proposition },
 *     businesses: Array<{ name, category?, city?, address?, rating?, ratings_count?, ...contacto }>
 *   }
 * Respuesta (200): { metadata, market_summary, ranked_prospects[], non_viable[] }
 *
 * Este módulo lo invoca `find_business_partner` automáticamente al final de
 * cada llamada de descubrimiento. NO es una tool del agente — es un paso
 * determinista del pipeline para que el modelo no decida si correrlo o no.
 */

const DEFAULT_ANALYZE_URL =
  'https://gtm-insights-module-production.up.railway.app/analyze';

const DEFAULT_TIMEOUT_MS = 300_000;

export type PriceRange = 'low' | 'mid' | 'high';

export interface InsightsProductContext {
  name: string;
  description: string;
  target_industry: string;
  price_range: PriceRange;
  value_proposition: string;
}

export interface InsightsBusiness {
  name: string;
  category?: string | null;
  zone?: string | null;
  city?: string | null;
  country?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  website?: string | null;
  instagram?: string | null;
  facebook?: string | null;
  tiktok?: string | null;
  google_place_id?: string | null;
  google_maps_url?: string | null;
  rating?: number | null;
  ratings_count?: number | null;
}

export type ProspectProfilingResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

/**
 * Devuelve la URL al módulo de insights, o null si está deshabilitado.
 *
 * Reglas:
 * - Sin variable definida → URL pública por defecto (Railway).
 * - GTM_INSIGHTS_ANALYZE_URL=false|off|0 → null (no llamar).
 * - Cualquier otro string → se usa tal cual.
 */
export function resolveGtmInsightsAnalyzeUrl(): string | null {
  const raw = process.env.GTM_INSIGHTS_ANALYZE_URL?.trim();
  if (!raw) return DEFAULT_ANALYZE_URL;
  const lowered = raw.toLowerCase();
  if (lowered === 'false' || lowered === 'off' || lowered === '0') return null;
  return raw;
}

function normalizePriceRange(input: string | undefined | null): PriceRange {
  const v = input?.trim().toLowerCase();
  if (v === 'low' || v === 'mid' || v === 'high') return v;
  return 'mid';
}

function clampText(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/**
 * Construye el `product_context` que espera el módulo a partir del contexto
 * que el agente ya tiene de la conversación.
 *
 * Si el agente pasó `icp_description`, lo usamos como descripción + value
 * proposition (es lo más rico que tenemos). Si no, generamos defaults
 * razonables alrededor de la categoría/zona/ciudad.
 *
 * Permite override vía env:
 *   GTM_PRODUCT_NAME         — nombre comercial (default "GoTom")
 *   GTM_PRODUCT_PRICE_RANGE  — low|mid|high (default "mid")
 */
export function buildProductContextForInsights(opts: {
  category: string;
  zone?: string | null;
  city?: string | null;
  country?: string | null;
  icp_description?: string | null;
}): InsightsProductContext {
  const { category, zone, city, country, icp_description } = opts;

  const name = process.env.GTM_PRODUCT_NAME?.trim() || 'GoTom';
  const price_range = normalizePriceRange(process.env.GTM_PRODUCT_PRICE_RANGE);
  const target_industry = category;
  const geoBits = [zone, city, country].filter(Boolean).join(', ');

  const icp = icp_description?.trim();
  const description = icp
    ? clampText(icp, 1500)
    : `Plataforma GoTom de prospección AI-driven para negocios de ${category}${
        geoBits ? ` en ${geoBits}` : ''
      }.`;

  const value_proposition = icp
    ? clampText(
        `Ayudamos a vender a clientes de tipo ${category} aprovechando contexto del ICP: ${icp}`,
        1500,
      )
    : `Automatizamos la prospección local: descubrimos negocios cercanos, validamos viabilidad y generamos guiones de venta personalizados.`;

  return {
    name,
    description,
    target_industry,
    price_range,
    value_proposition,
  };
}

/**
 * Convierte los `Lead[]` que devuelve el partner al shape `businesses` del
 * módulo de insights. Mapeo directo, sin filtros — el módulo decide qué es
 * viable.
 */
export function leadsToInsightsBusinesses(
  leads: Lead[],
  fallbackCategory: string,
): InsightsBusiness[] {
  return leads.map((l) => ({
    name: l.name,
    category: l.category ?? fallbackCategory,
    zone: l.zone,
    city: l.city,
    country: l.country,
    address: l.address,
    latitude: l.latitude,
    longitude: l.longitude,
    phone: l.phone,
    whatsapp: l.whatsapp,
    email: l.email,
    website: l.website,
    instagram: l.instagram,
    facebook: l.facebook,
    tiktok: l.tiktok,
    google_place_id: l.google_place_id,
    google_maps_url: l.google_maps_url,
    rating: l.rating,
    ratings_count: l.ratings_count,
  }));
}

/**
 * Llama al módulo de perfilamiento. Devuelve `{ ok: true, data }` con el
 * payload tal cual lo emite el servicio (incluye `metadata`, `market_summary`,
 * `ranked_prospects`, `non_viable`), o `{ ok: false, error }` con un mensaje
 * legible para que el agente pueda reportarlo sin romper el flujo.
 *
 * El llamador (`find_business_partner`) decide cómo embeberlo en su respuesta
 * — nosotros no lanzamos excepciones para que un fallo del módulo de insights
 * no tumbe el descubrimiento de leads.
 */
export async function fetchProspectProfiling(opts: {
  analyzeUrl: string;
  productContext: InsightsProductContext;
  businesses: InsightsBusiness[];
  // El schema del módulo (insightsGTM/src/schemas.js) exige `category` e
  // `icp_description` a nivel raíz, además del `product_context` anidado.
  // Sin estos dos, Zod rechaza con 400 antes de llegar a analyze().
  category: string;
  icpDescription: string;
  zone?: string | null;
  city?: string | null;
  country?: string | null;
  authToken?: string | null;
  timeoutMs?: number;
}): Promise<ProspectProfilingResult> {
  const {
    analyzeUrl,
    productContext,
    businesses,
    category,
    icpDescription,
    zone,
    city,
    country,
    authToken,
  } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (businesses.length === 0) {
    return {
      ok: false,
      error: 'No hay businesses para enviar al módulo de insights.',
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (authToken) headers.Authorization = `Bearer ${authToken}`;

  let raw: unknown;
  try {
    const res = await fetch(analyzeUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        category,
        icp_description: icpDescription,
        zone: zone ?? null,
        city: city ?? null,
        country: country ?? null,
        product_context: productContext,
        businesses,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `gtm-insights-module devolvió ${res.status}. Detalle: ${text.slice(0, 400)}`,
      };
    }
    raw = await res.json();
  } catch (err) {
    return {
      ok: false,
      error: `No se pudo contactar al gtm-insights-module: ${(err as Error).message}`,
    };
  }

  return { ok: true, data: raw };
}
