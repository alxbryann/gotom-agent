import { z } from 'zod';

/**
 * Forma única de un lead a lo largo de todo el pipeline:
 * descubrimiento (OSM, scrape de Maps, etc.) → enriquecimiento
 * (microservicio del partner) → exportación a CSV.
 *
 * Cualquier tool que devuelva una lista de negocios DEBE normalizar
 * a este shape antes de retornarlo. Mantener un solo formato evita
 * que el modelo tenga que reconciliar columnas entre fuentes y deja
 * el CSV consistente sin importar de dónde vino la data.
 */
export const LeadSchema = z.object({
  // Identidad
  name: z.string(),
  category: z.string().nullable(),

  // Geografía
  zone: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string().nullable(),
  address: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),

  // Contacto
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  email: z.string().nullable(),

  // Web y redes
  website: z.string().nullable(),
  instagram: z.string().nullable(),
  facebook: z.string().nullable(),
  tiktok: z.string().nullable(),

  // Google
  google_place_id: z.string().nullable(),
  google_maps_url: z.string().nullable(),
  rating: z.number().nullable(),
  ratings_count: z.number().nullable(),

  // Trazabilidad
  source: z.enum(['osm', 'google_maps_scrape', 'partner', 'user_url', 'manual']),
  status: z.enum(['discovered', 'enriched', 'skipped', 'error']),
  notes: z.string().nullable(),
});

export type Lead = z.infer<typeof LeadSchema>;

/**
 * Orden canónico de columnas para el CSV. Si cambia, cambia en un
 * solo lugar. Las mismas claves son las que el modelo verá en JSON,
 * así que no hay desfase entre la vista del agente y el archivo.
 */
export const LEAD_COLUMNS: Array<keyof Lead> = [
  'name',
  'category',
  'zone',
  'city',
  'country',
  'address',
  'phone',
  'whatsapp',
  'email',
  'website',
  'instagram',
  'facebook',
  'tiktok',
  'google_maps_url',
  'google_place_id',
  'latitude',
  'longitude',
  'rating',
  'ratings_count',
  'source',
  'status',
  'notes',
];

/** Construye un lead vacío con defaults — útil para los normalizadores. */
export function emptyLead(
  overrides: Partial<Lead> & Pick<Lead, 'name' | 'source'>,
): Lead {
  return {
    category: null,
    zone: null,
    city: null,
    country: null,
    address: null,
    latitude: null,
    longitude: null,
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    instagram: null,
    facebook: null,
    tiktok: null,
    google_place_id: null,
    google_maps_url: null,
    rating: null,
    ratings_count: null,
    status: 'discovered',
    notes: null,
    ...overrides,
  };
}
