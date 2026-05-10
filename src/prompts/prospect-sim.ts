/**
 * Rol: el prospecto (cliente) en una práctica de ventas — no el vendedor.
 * Contexto: battlecards + pitch que el equipo ya preparó contra este negocio.
 */

export type ProspectSimCard = {
  id?: string;
  title: string;
  body: string;
  category?: string;
};

export type ProspectSimulationContext = {
  sessionId?: string;
  clientSnapshot: Record<string, unknown>;
  cards: ProspectSimCard[];
  pitchCardIds?: string[];
  pitchMarkdown: string;
  pitchStructured?: Record<string, unknown>;
};

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function safeJsonSnippet(value: unknown, maxChars: number): string {
  try {
    return truncate(JSON.stringify(value, null, 0), maxChars);
  } catch {
    return '[snapshot no serializable]';
  }
}

function objectionSeeds(snapshot: Record<string, unknown>): string {
  const ca = snapshot.commercial_approach as Record<string, unknown> | undefined;
  const foundation =
    typeof ca?.commercial_foundation === 'object' &&
    ca?.commercial_foundation !== null &&
    !Array.isArray(ca.commercial_foundation)
      ? (ca.commercial_foundation as Record<string, unknown>)
      : undefined;
  const objection =
    typeof foundation?.objection_prep === 'string' ? foundation.objection_prep.trim() : '';
  const bi =
    typeof snapshot.business_intelligence === 'object' &&
    snapshot.business_intelligence !== null &&
    !Array.isArray(snapshot.business_intelligence)
      ? (snapshot.business_intelligence as Record<string, unknown>)
      : undefined;
  const pains = Array.isArray(bi?.pain_points)
    ? (bi.pain_points as unknown[]).filter((x) => typeof x === 'string').join(' · ')
    : '';
  const risks = Array.isArray(bi?.risk_flags)
    ? (bi.risk_flags as unknown[]).filter((x) => typeof x === 'string').join(' · ')
    : '';
  const lines: string[] = [];
  if (objection) lines.push(`objection_prep (del informe): ${objection}`);
  if (pains) lines.push(`pain_points: ${pains}`);
  if (risks) lines.push(`risk_flags: ${risks}`);
  return lines.length > 0
    ? lines.join('\n')
    : '(sin objection_prep explícito — inventá fricción realista para el rubro).';
}

export function buildProspectSimulationSystem(ctx: ProspectSimulationContext): string {
  const name =
    typeof ctx.clientSnapshot.name === 'string' && ctx.clientSnapshot.name.trim()
      ? ctx.clientSnapshot.name.trim()
      : 'el prospecto';
  const category =
    typeof ctx.clientSnapshot.category === 'string' && ctx.clientSnapshot.category.trim()
      ? ctx.clientSnapshot.category.trim()
      : 'negocio local';

  const ordered =
    ctx.pitchCardIds && ctx.pitchCardIds.length > 0
      ? [...ctx.pitchCardIds]
          .map((id) => ctx.cards.find((c) => c.id === id))
          .filter((c): c is ProspectSimCard => Boolean(c))
      : ctx.cards;

  const rest = ctx.cards.filter((c) => !ordered.some((o) => o.title === c.title && o.body === c.body));

  const cardLines: string[] = [];
  for (const c of ordered) {
    cardLines.push(
      `- [${c.category ?? 'card'}] ${c.title}: ${truncate(c.body.replace(/\s+/g, ' ').trim(), 800)}`,
    );
  }
  for (const c of rest) {
    cardLines.push(
      `- [extra] [${c.category ?? 'card'}] ${c.title}: ${truncate(c.body.replace(/\s+/g, ' ').trim(), 500)}`,
    );
  }

  const pitchMeta =
    ctx.pitchStructured && typeof ctx.pitchStructured === 'object'
      ? safeJsonSnippet(
          {
            client_name: (ctx.pitchStructured as { client_name?: unknown }).client_name,
            duration_minutes: (ctx.pitchStructured as { duration_minutes?: unknown })
              .duration_minutes,
            tone: (ctx.pitchStructured as { tone?: unknown }).tone,
            channel: (ctx.pitchStructured as { channel?: unknown }).channel,
          },
          1200,
        )
      : '(no estructurado)';

  return `Sos ${name}, representante/decisor de un negocio de categoría "${category}".

Tu misión es actuar como **prospecto en una práctica de ventas**: el usuario humano vende algo (GoTom / servicio/software que describan en chat). Respondés **como cliente**, no como coach ni vendedor.

## Reglas de personaje

- Respondé siempre **en español** salvo que el vendedor hable sólo inglés consistentemente — en ese caso podés igualar idioma si es natural.
- Conocés el trabajo interno que hizo tu interlocutor: battlecards resumidas más abajo, y **el pitch literal** como si lo hubieras escuchado.
- Sé **difícil pero realista**: tiempo, dinero, "ya trabajamos con alguien", confianza, prioridades, equipo saturado.
- Pedí evidencia cuando el vendedor afirme resultados grandes; marcá fisuras sin ridiculizar ni fantasías legales absurdas.
- **No concedas todo** sin fricción — podés aflojar si el seller responde bien las objeciones.
- Mantén **consistencia** turno tras turno; no cambies repentinamente tu negocio ni tamaño.
- Una o dos preguntas o pinches por turno (no párrafos interminables). Cerrá con algo que invite respuesta del vendedor.

## Semillas de objeción

${objectionSeeds(ctx.clientSnapshot)}

## Snapshot del negocio (contexto; no lo cites literal de memoria)

${safeJsonSnippet(ctx.clientSnapshot, 12000)}

## Battlecards del vendedor (modelá coherencia; como cliente no las nominás como "cards")

${truncate(cardLines.join('\n'), 14000)}

## Meta del pitch

${pitchMeta}

## Pitch que te presentaron (podés objetar como comprador ocupado)

${truncate(ctx.pitchMarkdown.trim(), 28000)}
`;
}
