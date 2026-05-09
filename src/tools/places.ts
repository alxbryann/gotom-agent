import { tool } from 'ai';
import { z } from 'zod';

export const findLocalBusinesses = tool({
  description:
    'Descubre negocios locales por categoría y geografía usando Google Places. Útil para encontrar prospectos sin presencia digital fuerte (océano azul). Devuelve nombre, dirección, teléfono, rating, y website (o null si no tiene).',
  inputSchema: z.object({
    query: z
      .string()
      .describe('Categoría o tipo de negocio. Ej: "restaurantes", "talleres mecánicos", "clínicas dentales".'),
    location: z
      .string()
      .describe('Ciudad o área geográfica. Ej: "Bogotá, Colombia", "Medellín centro".'),
    radius_meters: z.number().default(5000).describe('Radio de búsqueda en metros (default 5km).'),
    limit: z.number().default(20).describe('Máximo de resultados (default 20, máx 60).'),
  }),
  execute: async ({ query, location, radius_meters, limit }) => {
    const apiKey = process.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      return {
        error: 'GOOGLE_PLACES_API_KEY no configurada. Avisa al usuario que esta tool aún no está activa.',
        query,
        location,
      };
    }

    const url = 'https://places.googleapis.com/v1/places:searchText';
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri,places.rating,places.userRatingCount,places.businessStatus',
      },
      body: JSON.stringify({
        textQuery: `${query} en ${location}`,
        maxResultCount: Math.min(limit, 20),
        locationBias: { circle: { radius: radius_meters } },
      }),
    });

    if (!res.ok) {
      return { error: `Places API ${res.status}: ${await res.text()}` };
    }

    const data = (await res.json()) as { places?: Array<Record<string, unknown>> };
    const results = (data.places ?? []).map((p) => ({
      name: (p.displayName as { text?: string } | undefined)?.text ?? null,
      address: p.formattedAddress ?? null,
      phone: p.nationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      rating: p.rating ?? null,
      ratings_count: p.userRatingCount ?? null,
      status: p.businessStatus ?? null,
      has_website: Boolean(p.websiteUri),
    }));

    return {
      query,
      location,
      total: results.length,
      blue_ocean_count: results.filter((r) => !r.has_website).length,
      results,
    };
  },
});
