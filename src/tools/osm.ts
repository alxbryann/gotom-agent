import { tool } from 'ai';
import { z } from 'zod';

/**
 * Mapeo de categorías en español a tags de OpenStreetMap.
 * Incluye variantes con y sin tilde para mayor tolerancia.
 */
const CATEGORY_TAGS: Record<string, Array<{ key: string; value: string }>> = {
  barberia:       [{ key: 'shop', value: 'hairdresser' }, { key: 'shop', value: 'barber' }],
  barbería:       [{ key: 'shop', value: 'hairdresser' }, { key: 'shop', value: 'barber' }],
  barbero:        [{ key: 'shop', value: 'hairdresser' }, { key: 'shop', value: 'barber' }],
  peluqueria:     [{ key: 'shop', value: 'hairdresser' }],
  peluquería:     [{ key: 'shop', value: 'hairdresser' }],
  salon_belleza:  [{ key: 'shop', value: 'beauty' }],
  restaurante:    [{ key: 'amenity', value: 'restaurant' }],
  cafeteria:      [{ key: 'amenity', value: 'cafe' }],
  cafetería:      [{ key: 'amenity', value: 'cafe' }],
  farmacia:       [{ key: 'amenity', value: 'pharmacy' }],
  supermercado:   [{ key: 'shop', value: 'supermarket' }],
  clinica:        [{ key: 'amenity', value: 'clinic' }, { key: 'amenity', value: 'doctors' }],
  clínica:        [{ key: 'amenity', value: 'clinic' }, { key: 'amenity', value: 'doctors' }],
  dentista:       [{ key: 'amenity', value: 'dentist' }],
  gym:            [{ key: 'leisure', value: 'fitness_centre' }],
  gimnasio:       [{ key: 'leisure', value: 'fitness_centre' }],
  mecanico:       [{ key: 'shop', value: 'car_repair' }],
  mecánico:       [{ key: 'shop', value: 'car_repair' }],
  taller:         [{ key: 'shop', value: 'car_repair' }],
  hotel:          [{ key: 'tourism', value: 'hotel' }],
};

function normalizeCat(cat: string): string {
  return cat
    .toLowerCase()
    .replace(/[áä]/g, 'a')
    .replace(/[éë]/g, 'e')
    .replace(/[íï]/g, 'i')
    .replace(/[óö]/g, 'o')
    .replace(/[úü]/g, 'u')
    .trim();
}

interface NominatimResult {
  display_name: string;
  boundingbox: [string, string, string, string];
}

interface OverpassElement {
  tags?: Record<string, string>;
}

export const findLocalBusinessesOsm = tool({
  description: `Encuentra negocios locales usando OpenStreetMap (Overpass API).
No necesita API key. Devuelve nombre, dirección, teléfono y web cuando están disponibles.
Úsalo como PRIMER FALLBACK cuando Google Places no está configurado.
Cubre barberías, restaurantes, clínicas, mecánicos, y más.
Nota: los datos dependen de lo que la comunidad OSM haya mapeado en la zona — en ciudades grandes de LATAM suele haber buen cubrimiento para negocios físicos.`,
  inputSchema: z.object({
    category: z
      .string()
      .describe('Tipo de negocio en español. Ej: "barbería", "restaurante", "clínica", "mecánico".'),
    location: z
      .string()
      .describe('Ciudad, barrio o zona. Ej: "Kennedy, Bogotá", "Bogotá, Colombia", "Medellín".'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(60)
      .default(30)
      .describe('Máximo de resultados (default 30).'),
  }),

  execute: async ({ category, location, limit }) => {
    // ── 1. Geocodificar la ubicación con Nominatim (con 1 reintento) ───────
    const geocodeUrl =
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(location)}&format=json&limit=1`;

    const fetchNominatim = async (): Promise<NominatimResult[]> => {
      const geoRes = await fetch(geocodeUrl, {
        headers: {
          'User-Agent': 'GoTom-Agent/1.0 (hola@gotom.co)',
          'Accept-Language': 'es',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!geoRes.ok) throw new Error(`Nominatim ${geoRes.status}`);
      return (await geoRes.json()) as NominatimResult[];
    };

    let geoData: NominatimResult[];
    try {
      geoData = await fetchNominatim();
    } catch {
      // 1 reintento tras 1.5s — Nominatim rate-limita a 1 req/s
      await new Promise((r) => setTimeout(r, 1500));
      try {
        geoData = await fetchNominatim();
      } catch (err) {
        return {
          error: `Nominatim no respondió tras 2 intentos: ${(err as Error).message}. Probablemente sea rate-limit transitorio.`,
        };
      }
    }

    if (!geoData || geoData.length === 0) {
      return { error: `No se encontró "${location}" en OpenStreetMap. Prueba con más detalle, ej: "Kennedy, Bogotá, Colombia".` };
    }

    const { display_name, boundingbox } = geoData[0];
    // boundingbox: [minlat, maxlat, minlon, maxlon]
    const [minlat, maxlat, minlon, maxlon] = boundingbox;

    // ── 2. Mapear categoría → tags OSM ─────────────────────────────────────
    const key = normalizeCat(category);
    const tags = CATEGORY_TAGS[key] ?? [
      { key: 'shop', value: key },
      { key: 'amenity', value: key },
    ];

    const tagFilters = tags
      .map(
        ({ key: k, value: v }) =>
          `nwr["${k}"="${v}"](${minlat},${minlon},${maxlat},${maxlon});`,
      )
      .join('\n  ');

    const query = `[out:json][timeout:30];\n(\n  ${tagFilters}\n);\nout center tags ${limit + 10};`;

    // ── 3. Consultar Overpass API con varios mirrors ───────────────────────
    const OVERPASS_ENDPOINTS = [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
    ];

    let elements: OverpassElement[] | null = null;
    const errors: string[] = [];
    let rateLimited = false;

    for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
      const endpoint = OVERPASS_ENDPOINTS[i];
      try {
        const ovRes = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'GoTom-Agent/1.0 (hola@gotom.co)',
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(35_000),
        });

        if (ovRes.status === 429 || ovRes.status === 504) {
          rateLimited = true;
          errors.push(`${new URL(endpoint).hostname}: ${ovRes.status}`);
          // Backoff progresivo antes del siguiente mirror — Overpass rate-limita
          // por IP y necesita unos segundos para liberar slot.
          await new Promise((r) => setTimeout(r, 3000 + i * 2000));
          continue;
        }

        if (!ovRes.ok) {
          errors.push(`${new URL(endpoint).hostname}: ${ovRes.status}`);
          continue;
        }

        const json = (await ovRes.json()) as { elements?: OverpassElement[] };
        elements = json.elements ?? [];
        break;
      } catch (err) {
        errors.push(`${new URL(endpoint).hostname}: ${(err as Error).message}`);
        continue;
      }
    }

    if (elements === null) {
      const hint = rateLimited
        ? 'Los servidores públicos de Overpass están rate-limitando tu IP en este momento. Espera ~30s e intenta de nuevo, o usa Google Places.'
        : 'Probablemente sea un fallo transitorio.';
      return { error: `Overpass API no respondió. ${hint} Detalles: ${errors.join('; ')}` };
    }

    // ── 4. Formatear resultados ────────────────────────────────────────────
    const named = elements.filter((e) => e.tags?.name);

    const results = named.slice(0, limit).map((e) => {
      const t = e.tags!;
      const addressParts = [t['addr:street'], t['addr:housenumber'], t['addr:suburb'], t['addr:city']]
        .filter(Boolean)
        .join(', ');
      const phone = t.phone ?? t['contact:phone'] ?? null;
      const website = t.website ?? t['contact:website'] ?? null;

      return {
        name: t.name,
        address: addressParts || null,
        phone,
        website,
        instagram: t['contact:instagram'] ?? null,
        has_website: Boolean(website),
      };
    });

    if (results.length === 0) {
      return {
        source: 'OpenStreetMap',
        location_found: display_name,
        category,
        total: 0,
        note: `OpenStreetMap no tiene "${category}" registradas en "${location}". Esto no significa que no existan — simplemente la comunidad OSM no las ha mapeado aún en esa zona. Opción: configurar Google Places API para datos más completos.`,
        results: [],
      };
    }

    return {
      source: 'OpenStreetMap',
      location_found: display_name,
      category,
      total: results.length,
      blue_ocean_count: results.filter((r) => !r.has_website).length,
      results,
    };
  },
});
