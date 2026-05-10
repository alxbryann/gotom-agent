import { tool } from 'ai';
import { z } from 'zod';
import {
  buildProductContextForInsights,
  fetchProspectProfiling,
  leadsToInsightsBusinesses,
  resolveGtmInsightsAnalyzeUrl,
} from '../lib/gtm-insights-profiling.js';
import { LeadSchema } from '../lib/lead.js';

/**
 * SEGUNDO paso del pipeline de prospección.
 *
 * Toma los `Lead[]` que devolvió `find_business_partner` (microservicio
 * territory-analyzer) y los manda al microservicio gtm-insights-module
 * (POST /analyze) para perfilarlos: scoring ICP, métricas comerciales
 * (LTV/CAC/ROAS), pain points, talk tracks personalizados.
 *
 * Reglas (deterministas, no son opcionales):
 * - Llamar SIEMPRE inmediatamente después de un `find_business_partner` que
 *   haya devuelto `results.length > 0`.
 * - Pasar como `leads` exactamente los `results` que devolvió el partner.
 * - Pasar el mismo `icp_description`, `category`, `zone`, `city`, `country`
 *   que se usaron en el partner para mantener el contexto del producto.
 */
export const profileProspects = tool({
  description: `Perfila los leads enriquecidos contra el módulo GTM-Insights (POST /analyze).
Es el SEGUNDO paso del pipeline, justo después de \`find_business_partner\`.
Devuelve scoring ICP, market_summary y ranked_prospects con talk tracks
listos para cada negocio.`,
  inputSchema: z.object({
    leads: z
      .array(LeadSchema)
      .describe('Leads a perfilar. Pasá los `results` que devolvió `find_business_partner`.'),
    icp_description: z
      .string()
      .optional()
      .describe(
        'Resumen del ICP de la conversación con el usuario (producto, propuesta de valor, perfil del cliente, ticket). El módulo lo usa para calcular ICP score y armar el talk track. SIEMPRE pásalo si lo tenés.',
      ),
    category: z
      .string()
      .optional()
      .describe('Categoría de los negocios (ej. "barbería"). Si la omitís, se infiere del primer lead.'),
    zone: z.string().optional().describe('Zona usada en el partner. Solo para contexto.'),
    city: z.string().optional().describe('Ciudad usada en el partner. Solo para contexto.'),
    country: z.string().optional().describe('País. Default "Colombia".'),
  }),
  execute: async ({ leads, icp_description, category, zone, city, country }) => {
    const analyzeUrl = resolveGtmInsightsAnalyzeUrl();
    if (!analyzeUrl) {
      return {
        error:
          'GTM_INSIGHTS_ANALYZE_URL está deshabilitado (=false). Habilitá la URL en .env para perfilar prospectos.',
      };
    }
    if (!leads || leads.length === 0) {
      return {
        error:
          'No hay leads para perfilar. Volvé a correr `find_business_partner` con otra zona.',
      };
    }

    const fallbackCategory =
      category?.trim() ||
      leads.find((l) => l.category)?.category ||
      'general';

    const resolvedZone = zone ?? leads.find((l) => l.zone)?.zone ?? null;
    const resolvedCity = city ?? leads.find((l) => l.city)?.city ?? null;
    const resolvedCountry =
      country ?? leads.find((l) => l.country)?.country ?? null;

    const productContext = buildProductContextForInsights({
      category: fallbackCategory,
      zone: resolvedZone,
      city: resolvedCity,
      country: resolvedCountry,
      icp_description,
    });

    // El módulo exige `icp_description` no vacío. Si el agente no lo pasó,
    // sintetizamos uno mínimo a partir del contexto disponible para no
    // bloquear el pipeline con un 400.
    const geoBits = [resolvedZone, resolvedCity, resolvedCountry]
      .filter(Boolean)
      .join(', ');
    const resolvedIcpDescription =
      icp_description?.trim() ||
      `Negocios de ${fallbackCategory}${geoBits ? ` en ${geoBits}` : ''} apropiados para prospección comercial GoTom.`;

    const businesses = leadsToInsightsBusinesses(leads, fallbackCategory);
    const token = process.env.GTM_INSIGHTS_ANALYZE_TOKEN?.trim();

    const result = await fetchProspectProfiling({
      analyzeUrl,
      productContext,
      businesses,
      category: fallbackCategory,
      icpDescription: resolvedIcpDescription,
      zone: resolvedZone,
      city: resolvedCity,
      country: resolvedCountry,
      authToken: token,
    });

    if (!result.ok) {
      return {
        source: 'gtm-insights-module',
        error: result.error,
        total_sent: leads.length,
      };
    }

    return {
      source: 'gtm-insights-module',
      total_sent: leads.length,
      product_context: productContext,
      profiling: result.data,
    };
  },
});
