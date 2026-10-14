import type {
  CampaignIdea,
  ClusterResult,
  LlmConfig,
  Persona,
  PersonaPayload,
  PreparedData,
  Provider,
} from '../types';

export const DEFAULT_MODELS: Record<Provider, string> = {
  claude: 'claude-sonnet-4-6',
  gemini: 'gemini-3.1-flash-lite',
};

/**
 * PRIVACY BOUNDARY.
 *
 * This is the only data that ever leaves the browser. It contains segment-level
 * aggregates — sizes, averages, category mixes — and no individual records.
 * Nothing here can be traced back to a single customer.
 *
 * Exported so the UI can display the exact payload before it is sent. A privacy
 * claim the user can inspect is worth more than one asserted in a README.
 */
export function buildPayload(data: PreparedData, result: ClusterResult): PersonaPayload {
  return {
    featureNames: data.featureNames,
    totalCustomers: data.rows.length,
    segments: result.profiles.map((p) => ({
      id: p.id,
      size: p.size,
      sharePct: Number((p.share * 100).toFixed(1)),
      averages: Object.fromEntries(
        Object.entries(p.means).map(([k, v]) => [k, Number(v.toFixed(2))]),
      ),
      mix: Object.fromEntries(
        Object.entries(p.categoricalBreakdown).map(([col, levels]) => [
          col,
          Object.fromEntries(
            Object.entries(levels).map(([lvl, pct]) => [lvl, Number(pct.toFixed(1))]),
          ),
        ]),
      ),
    })),
  };
}

function buildPrompt(payload: PersonaPayload): string {
  return `You are a marketing analyst reviewing the output of a K-Means customer segmentation. You are given segment-level aggregates and nothing else.

${JSON.stringify(payload, null, 2)}

CRITICAL CONSTRAINT: the data above contains only averages, counts, and category mixes. It contains no information about motivations, attitudes, brand preferences, purchase frequency, channels, or lifestyle. You must not present any such claim as a finding.

For each segment, return:

- "label": a short, concrete name (2-4 words) describing what the NUMBERS show. Avoid motivational words like "impulse", "conservative", "status-seeking", or "savers" — those describe psychology you cannot observe here.

- "narrative": 2-3 sentences describing this segment strictly in terms of its figures and how they compare to other segments.

- "observedFacts": 2-4 statements, each citing a specific number from the data. Every item must contain a figure. Example: "Spending score of 82.13 is the highest of any segment."

- "hypotheses": 1-3 plausible explanations for the observed behaviour, each written as an explicit guess requiring validation. These will be displayed to the user as unverified. Example: "May indicate higher discretionary budget, though nothing in this data measures that."

- "closestSegment": the id of the segment whose averages are most similar to this one, or null if none is close.

- "keyContrast": one sentence on what separates this segment from its closest neighbour. Where two segments have near-identical values on one dimension but differ sharply on another, say so directly — that contrast is usually the most useful finding in the data.

- "campaignIdeas": 2-3 items, each an object with "idea" and "basedOn". "basedOn" must reference a specific figure from this segment. If you cannot tie an idea to a number, leave it out.

RANKING RULE: do not describe a value as the highest or lowest when it differs from the next value by less than 5%. Treat such values as effectively tied and say so.

Respond with ONLY a JSON array, no markdown fences, no preamble:
[{"clusterId": 0, "label": "...", "narrative": "...", "observedFacts": ["..."], "hypotheses": ["..."], "closestSegment": 1, "keyContrast": "...", "campaignIdeas": [{"idea": "...", "basedOn": "..."}]}]`;
}

async function callClaude(prompt: string, config: LlmConfig): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      // Required for browser-origin calls; without it the request is blocked by CORS.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Claude API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = (json.content ?? [])
    .filter((b: { type: string }) => b.type === 'text')
    .map((b: { text: string }) => b.text)
    .join('\n');

  if (!text) throw new Error('Claude returned no text content.');
  return text;
}

async function callGemini(prompt: string, config: LlmConfig): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': config.apiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini API ${res.status}: ${detail.slice(0, 300)}`);
  }

  const json = await res.json();
  const text = (json.candidates?.[0]?.content?.parts ?? [])
    .map((p: { text?: string }) => p.text ?? '')
    .join('\n');

  if (!text) throw new Error('Gemini returned no text content.');
  return text;
}

/** Models often wrap JSON in fences despite instructions not to. */
function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  const slice = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;

  try {
    return JSON.parse(slice);
  } catch {
    throw new Error('Model response was not valid JSON. Try regenerating.');
  }
}

function toStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

function toCampaignIdeas(v: unknown): CampaignIdea[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      // Tolerate a bare string if the model ignores the object shape.
      if (typeof item === 'string') return { idea: item, basedOn: '' };
      if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        return { idea: String(o.idea ?? ''), basedOn: String(o.basedOn ?? '') };
      }
      return null;
    })
    .filter((x): x is CampaignIdea => x !== null && x.idea !== '');
}

function coercePersonas(parsed: unknown, expectedIds: number[]): Persona[] {
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of personas.');

  const byId = new Map<number, Persona>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = Number(o.clusterId);
    if (!Number.isInteger(id)) continue;

    const closest = Number(o.closestSegment);

    byId.set(id, {
      clusterId: id,
      label: String(o.label ?? `Segment ${id}`),
      narrative: String(o.narrative ?? ''),
      observedFacts: toStringArray(o.observedFacts),
      hypotheses: toStringArray(o.hypotheses),
      closestSegment: Number.isInteger(closest) && closest !== id ? closest : null,
      keyContrast: String(o.keyContrast ?? ''),
      campaignIdeas: toCampaignIdeas(o.campaignIdeas),
    });
  }

  // Never silently drop a segment the model skipped.
  return expectedIds.map(
    (id) =>
      byId.get(id) ?? {
        clusterId: id,
        label: `Segment ${id}`,
        narrative: 'The model did not return a persona for this segment.',
        observedFacts: [],
        hypotheses: [],
        closestSegment: null,
        keyContrast: '',
        campaignIdeas: [],
      },
  );
}

export async function generatePersonas(
  data: PreparedData,
  result: ClusterResult,
  config: LlmConfig,
): Promise<Persona[]> {
  if (!config.apiKey.trim()) throw new Error('No API key provided.');

  const payload = buildPayload(data, result);
  const prompt = buildPrompt(payload);

  const raw =
    config.provider === 'claude'
      ? await callClaude(prompt, config)
      : await callGemini(prompt, config);

  return coercePersonas(
    extractJson(raw),
    result.profiles.map((p) => p.id),
  );
}