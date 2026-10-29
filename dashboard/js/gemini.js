// Gemini client for the free Google AI Studio tier (Interactions API, structured JSON output).
import { clampScore } from './scoring.js';

export const DEFAULT_MODEL = 'gemini-3.8-flash';
export const MODEL_CHOICES = [
  { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash (recommended)' },
  { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite (fastest, best for big batches)' },
  { id: 'gemini-4-argon', label: 'Gemini 4 Argon (most capable, may not be free)' }
];

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions';

export class GeminiError extends Error {
  constructor(message, { status = 0, retryAfterMs = 0, quota = false } = {}) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.quota = quota;
  }
}

/** Build the JSON schema for the per-paper evaluation from the project's topics/rubric/note fields. */
export function buildEvalSchema(config) {
  const topicCodes = config.topics.map((t) => t.code);
  const props = {
    summary: { type: 'string', description: 'One plain-language sentence summarising what the paper does.' }
  };
  const required = ['summary'];

  if (topicCodes.length) {
    props.bestTopic = { type: 'string', enum: [...topicCodes, 'None'], description: 'Code of the single best-matching topic, or None.' };
    props.topicRelevance = {
      type: 'object',
      description: 'Relevance of the paper to each topic, integer 0-3 (0 = not relevant, 3 = directly on topic).',
      properties: Object.fromEntries(topicCodes.map((c) => [c, { type: 'integer', description: 'Integer 0-3' }])),
      required: topicCodes
    };
    required.push('bestTopic', 'topicRelevance');
  }

  props.criteria = {
    type: 'object',
    description: 'Rubric scores, each an integer 0-3.',
    properties: Object.fromEntries(
      config.criteria.map((c) => [c.id, { type: 'integer', description: `${c.label}: ${c.description}` }])
    ),
    required: config.criteria.map((c) => c.id)
  };
  required.push('criteria');

  props.notes = {
    type: 'object',
    description: 'Deep notes. Use "not stated in abstract" when the abstract does not say.',
    properties: Object.fromEntries(config.noteFields.map((f) => [f.id, { type: 'string', description: `${f.label}: ${f.instruction}` }])),
    required: config.noteFields.map((f) => f.id)
  };
  required.push('notes');

  return { type: 'object', properties: props, required };
}

export function buildSystemPrompt(config) {
  const topicLines = config.topics
    .map((t) => `- Topic ${t.code} — ${t.name}: ${t.focus || ''}${t.keywords?.length ? ` (keywords: ${t.keywords.join(', ')})` : ''}`)
    .join('\n');
  const rubricLines = config.criteria.map((c) => `- ${c.label} (0-3): ${c.description}`).join('\n');
  return `You are a rigorous academic research assistant helping a student screen papers for a literature review.

THESIS TITLE: ${config.thesisTitle || '(not provided)'}
STUDY CONTEXT: ${config.context || '(not provided)'}

THE STUDENT'S TOPICS:
${topicLines || '(no topics defined — judge relevance to the thesis title/context only)'}

RUBRIC (integer 0-3 each):
${rubricLines}

RULES:
1. Grade ONLY from the title/abstract/metadata provided. Never invent numbers, parameters, methods or results.
2. If a detail is not in the provided text, write exactly "not stated in abstract".
3. Be strict: use 3 only when the paper is directly and substantially useful for this thesis.
4. Quote numbers exactly as written in the abstract.`;
}

export function buildPaperPrompt(paper) {
  return `Evaluate this paper.

TITLE: ${paper.title || 'Untitled'}
AUTHORS: ${paper.authors || 'Unknown'}
YEAR: ${paper.year || 'Unknown'}
VENUE: ${paper.venue || 'Unknown'}
DOCUMENT TYPE: ${paper.docType || 'Unknown'}
CITATIONS: ${paper.citations ?? 'N/A'}
DOI: ${paper.doi || 'N/A'}

ABSTRACT:
${paper.abstract || '(No abstract was captured. Grade conservatively from the title only.)'}`;
}

function textFromInteraction(data) {
  if (!data) return '';
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();
  if (Array.isArray(data.steps)) {
    const parts = [];
    for (const step of data.steps) {
      if (step.type === 'model_output' && Array.isArray(step.content)) {
        for (const c of step.content) if (c.type === 'text' && c.text) parts.push(c.text);
      }
    }
    if (parts.length) return parts.join('\n').trim();
  }
  if (Array.isArray(data.outputs)) {
    for (let i = data.outputs.length - 1; i >= 0; i--) if (data.outputs[i]?.text) return data.outputs[i].text.trim();
  }
  if (Array.isArray(data.candidates)) {
    return (data.candidates[0]?.content?.parts || []).map((p) => p.text || '').join('').trim();
  }
  return '';
}

export function parseJsonLoose(text) {
  const cleaned = String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
    throw e;
  }
}

function parseRetryDelay(errText) {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(errText) || /retry in (\d+(?:\.\d+)?)s/i.exec(errText);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
}

/** One structured-output call. Throws GeminiError. `fetchImpl` is injectable for tests. */
export async function callGemini({ apiKey, model, system, input, schema, signal, fetchImpl = fetch }) {
  if (!apiKey) throw new GeminiError('Missing Gemini API key. Add it in Settings.', { status: 401 });
  const body = {
    model: model || DEFAULT_MODEL,
    system_instruction: system,
    input,
    store: false,
    response_format: { type: 'text', mime_type: 'application/json', schema },
    generation_config: { temperature: 0.1 }
  };
  let res;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, 'Api-Revision': '2026-05-20' },
      body: JSON.stringify(body),
      signal
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new GeminiError(`Network error: ${e.message}`, { status: 0 });
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    const quota = res.status === 429;
    throw new GeminiError(`Gemini API ${res.status}: ${errText.slice(0, 300)}`, {
      status: res.status,
      retryAfterMs: parseRetryDelay(errText),
      quota
    });
  }
  const data = await res.json();
  const text = textFromInteraction(data);
  if (!text) throw new GeminiError('Gemini returned an empty response.', { status: 502 });
  try {
    return parseJsonLoose(text);
  } catch {
    throw new GeminiError('Gemini returned malformed JSON.', { status: 502 });
  }
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new DOMException('Aborted', 'AbortError'))), { once: true });
  });

/** callGemini with retries for transient errors (429/5xx/malformed JSON). */
export async function callGeminiWithRetry(opts, { maxAttempts = 4, onRetry } = {}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    try {
      return await callGemini(opts);
    } catch (e) {
      if (e.name === 'AbortError') throw e;
      const retryable = e instanceof GeminiError && (e.status === 429 || e.status >= 500 || e.status === 0);
      if (!retryable || attempt >= maxAttempts) throw e;
      const wait = Math.max(e.retryAfterMs || 0, 2000 * 2 ** (attempt - 1));
      onRetry?.({ attempt, wait, error: e });
      await sleep(wait, opts.signal);
    }
  }
}

/** Normalise + clamp the model's evaluation so the rest of the app can trust it. */
export function normalizeEval(raw, config) {
  const topicRelevance = {};
  for (const t of config.topics) topicRelevance[t.code] = clampScore(raw?.topicRelevance?.[t.code]);
  const criteria = {};
  for (const c of config.criteria) criteria[c.id] = clampScore(raw?.criteria?.[c.id]);
  const notes = {};
  for (const f of config.noteFields) notes[f.id] = String(raw?.notes?.[f.id] ?? 'not stated in abstract').trim();
  return {
    summary: String(raw?.summary ?? '').trim(),
    bestTopic: raw?.bestTopic && raw.bestTopic !== 'None' ? raw.bestTopic : null,
    topicRelevance,
    criteria,
    notes,
    evaluatedAt: Date.now()
  };
}

export async function evaluatePaper(paper, config, { apiKey, model, signal, fetchImpl, onRetry }) {
  const raw = await callGeminiWithRetry(
    {
      apiKey,
      model,
      system: buildSystemPrompt(config),
      input: buildPaperPrompt(paper),
      schema: buildEvalSchema(config),
      signal,
      fetchImpl
    },
    { onRetry }
  );
  return normalizeEval(raw, config);
}

/** Ask Gemini to propose topics + keywords from a thesis title/description. */
export async function suggestTopics({ title, context, count = 5, apiKey, model, signal, fetchImpl }) {
  const schema = {
    type: 'object',
    properties: {
      topics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short topic name for a literature-review section.' },
            focus: { type: 'string', description: 'One sentence describing what papers on this topic cover.' },
            keywords: { type: 'array', items: { type: 'string' }, description: '6-10 search keywords/phrases as used in paper titles and abstracts.' },
            chapter: { type: 'string', description: 'Suggested literature-review section heading.' }
          },
          required: ['name', 'focus', 'keywords', 'chapter']
        }
      }
    },
    required: ['topics']
  };
  const out = await callGeminiWithRetry({
    apiKey,
    model,
    system:
      'You help students plan the Related Literature Review (RRL) of a thesis. Propose distinct, non-overlapping topics that together cover the literature they must read.',
    input: `THESIS TITLE: ${title}\nDESCRIPTION: ${context || '(none)'}\n\nPropose ${count} literature-review topics with search keywords suitable for Scopus TITLE-ABS-KEY searches.`,
    schema,
    signal,
    fetchImpl
  });
  return Array.isArray(out.topics) ? out.topics : [];
}
