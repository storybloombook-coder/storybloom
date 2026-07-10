// ai/gemini.ts — Storybloom prep: Gemini Flash vision call
//
// Standalone LOGIC: builds the prompt, parses the strict-JSON response, and
// handles 429 rate limits with backoff. The actual fetch is injected so this
// file needs no key and no network to exist — the app wires in the real call.
//
// Matches gemini-vision-prompt.md and types.ts.
//
// v1 constraints baked in:
//  - FREE tier Flash model only (never a paid Pro model).
//  - Sound ids MUST come from the provided allow-lists (never invented).
//  - character cues ONLY from quoted dialogue.
//  - STORY TEXT ONLY — ignore words drawn into the illustration.
//  - If a PDF page has clean embedded text, pass it as a wording HINT.

import type { PageType, CueType, CueIntensity } from "../types";

// ---- What the app passes in for one page --------------------------------

export interface SoundAllowlists {
  ambientIds: string[]; // e.g. ["amb_forest","amb_city","amb_night", ...]
  effectIds: string[];  // e.g. ["fx_engine","fx_laugh","fx_splash", ...]
  voiceIds: string[];   // e.g. ["voice_child","voice_pip","voice_posy"]
}

export interface PreparePageInput {
  /** Base64 of the page image (from a photo or a rendered PDF page). */
  imageBase64: string;
  imageMimeType?: string; // default "image/jpeg"
  /** Optional clean text from a PDF page — used as a wording hint. */
  embeddedText?: string | null;
  allowlists: SoundAllowlists;
}

// ---- What Gemini must return (parsed shape) -----------------------------

export interface RawKeywordCue {
  trigger_text: string;
  context_phrase?: string | null;
  sound_id: string | null;
  confidence?: number;
}

export interface RawCharacterCue {
  character_name?: string | null;
  line_text: string;
  trigger_text: string;
  voice_id: string | null;
  intensity?: CueIntensity | null;
  emotion?: string | null;
  confidence?: number;
}

export interface PreparePageResult {
  page_type: PageType;
  ocr_text: string;
  background_scene: string | null;
  ambient_sound_id: string | null;
  keyword_cues: RawKeywordCue[];
  character_cues: RawCharacterCue[];
  low_confidence?: boolean;
}

// ---- Prompt builder ------------------------------------------------------

export function buildPrompt(input: PreparePageInput): string {
  const { allowlists, embeddedText } = input;
  const hint =
    embeddedText && embeddedText.trim()
      ? `\nThe exact wording of this page's story text is provided below. Use it verbatim for "ocr_text" (it is more reliable than reading the image). STILL analyze the IMAGE for scene, keyword cues, and character cues.\n---\n${embeddedText.trim()}\n---\n`
      : "";

  return `You are labeling a single children's book page to drive sound effects.
Return ONLY valid JSON (no explanations, no markdown fences) matching this schema:

{
  "page_type": "cover|title|story|illustration_only|back_cover",
  "ocr_text": "the STORY text of this page, verbatim, in reading order (\\"\\" if none)",
  "background_scene": "short label like forest, ocean, bedroom, city (or null)",
  "ambient_sound_id": "one of the ambient ids below, or null",
  "keyword_cues": [
    { "trigger_text": "lowercase word/phrase exactly as in ocr_text",
      "context_phrase": "surrounding phrase", "sound_id": "one of the effect ids", "confidence": 0.0 }
  ],
  "character_cues": [
    { "character_name": "speaker if known", "line_text": "the quoted line",
      "trigger_text": "lowercase quote as in ocr_text", "voice_id": "one of the voice ids",
      "intensity": "normal|loud", "emotion": "short hint or null", "confidence": 0.0 }
  ]
}

Rules:
- Classify page_type first. For cover/title/back_cover, still fill ocr_text but return empty cue arrays. For illustration_only (art but no narrated text) set ocr_text "" and empty cue arrays.
- Read STORY TEXT ONLY. IGNORE words that are part of the illustration (signs, posters, adverts, toy labels, drawings). Reason about the WHOLE scene for the ambient (a park -> birds; a road -> passing cars; a bedroom at night -> quiet night), not individual objects.
- keyword_cues: 2-5 of the most vivid, sound-evocative moments. Do not tag every sentence. A repeated phrase ("cried and cried and cried") is ONE cue.
- character_cues: ONLY from text inside quotation marks (actual spoken dialogue). Narrator text like 'said Pip' is NOT a cue. Return multiple quotes IN ORDER. Set intensity "loud" for ALL CAPS / shouted lines.
- sound_id / voice_id MUST be chosen from the allow-lists below, or set null (never invent an id).
- If nothing fits a category, return an empty array.
- This page may be in English or Russian. If the text is Russian (Cyrillic), preserve it EXACTLY in ocr_text, trigger_text, context_phrase, and line_text — do NOT transliterate to Latin characters and do NOT translate to English. trigger_text is still lowercased and must match the exact Cyrillic substring in ocr_text.
${hint}
Allowed ambient ids: ${JSON.stringify(allowlists.ambientIds)}
Allowed effect ids: ${JSON.stringify(allowlists.effectIds)}
Allowed voice ids: ${JSON.stringify(allowlists.voiceIds)}`;
}

// ---- Response parsing (defensive) ---------------------------------------

const PAGE_TYPES: PageType[] = [
  "cover", "title", "story", "illustration_only", "back_cover",
];

/** Strip stray ```json fences and parse. Throws on unrecoverable JSON. */
export function parseGeminiJson(text: string): PreparePageResult {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  // Some models prepend/append prose; grab the outermost {...}.
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const jsonStr = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
  const raw = JSON.parse(jsonStr);
  return normalizeResult(raw);
}

/** Coerce a raw parsed object into a safe PreparePageResult, dropping cues
 *  whose sound/voice ids are not in the allow-lists is the CALLER's job
 *  (see filterToAllowlists) — here we just make the shape safe. */
export function normalizeResult(raw: any): PreparePageResult {
  const pageType: PageType = PAGE_TYPES.includes(raw?.page_type)
    ? raw.page_type
    : "story";
  const kw: RawKeywordCue[] = Array.isArray(raw?.keyword_cues)
    ? raw.keyword_cues
        .filter((c: any) => c && typeof c.trigger_text === "string")
        .map((c: any) => ({
          // toLowerCase() handles Cyrillic correctly (unlike e.g. Turkish "I"), no locale arg needed.
          trigger_text: String(c.trigger_text).toLowerCase(),
          context_phrase: c.context_phrase ?? null,
          sound_id: c.sound_id ?? null,
          confidence: typeof c.confidence === "number" ? c.confidence : undefined,
        }))
    : [];
  const ch: RawCharacterCue[] = Array.isArray(raw?.character_cues)
    ? raw.character_cues
        .filter((c: any) => c && typeof c.line_text === "string")
        .map((c: any) => ({
          character_name: c.character_name ?? null,
          line_text: String(c.line_text),
          trigger_text: String(c.trigger_text ?? c.line_text).toLowerCase(),
          voice_id: c.voice_id ?? null,
          intensity: c.intensity === "loud" ? "loud" : c.intensity === "normal" ? "normal" : null,
          emotion: c.emotion ?? null,
          confidence: typeof c.confidence === "number" ? c.confidence : undefined,
        }))
    : [];
  return {
    page_type: pageType,
    ocr_text: typeof raw?.ocr_text === "string" ? raw.ocr_text : "",
    background_scene: raw?.background_scene ?? null,
    ambient_sound_id: raw?.ambient_sound_id ?? null,
    keyword_cues: kw,
    character_cues: ch,
    low_confidence: raw?.low_confidence === true ? true : undefined,
  };
}

/** Enforce the allow-lists: drop any cue/ambient referencing an unknown id.
 *  This is the safety net in case the model invents an id despite the prompt. */
export function filterToAllowlists(
  result: PreparePageResult,
  lists: SoundAllowlists
): PreparePageResult {
  const inList = (id: string | null, arr: string[]) => !!id && arr.includes(id);
  return {
    ...result,
    ambient_sound_id: inList(result.ambient_sound_id, lists.ambientIds)
      ? result.ambient_sound_id
      : null,
    keyword_cues: result.keyword_cues.map((c) => ({
      ...c,
      sound_id: inList(c.sound_id, lists.effectIds) ? c.sound_id : null,
    })),
    character_cues: result.character_cues.map((c) => ({
      ...c,
      voice_id: inList(c.voice_id, lists.voiceIds) ? c.voice_id : null,
    })),
  };
}

// ---- Retry / backoff on 429 (free-tier rate limit) ----------------------

export class RateLimitError extends Error {
  constructor(msg = "Gemini rate limit (429)") {
    super(msg);
    this.name = "RateLimitError";
  }
}

export interface RetryOptions {
  maxRetries?: number; // default 4
  baseDelayMs?: number; // default 1000
  onRetry?: (attempt: number, delayMs: number) => void;
}

/** Run `fn`, retrying with exponential backoff when it throws RateLimitError.
 *  Wrap your fetch so it throws RateLimitError on HTTP 429. */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 4;
  const base = opts.baseDelayMs ?? 1000;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err instanceof RateLimitError;
      if (!is429 || attempt >= maxRetries) throw err;
      const delay = base * Math.pow(2, attempt) + Math.floor(Math.random() * 250);
      opts.onRetry?.(attempt + 1, delay);
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

// ---- Orchestrator: prompt -> (injected call) -> parse -> filter ---------
//
// The app injects `callModel`, which does the real fetch to the Gemini API
// with the free key, sends the prompt + image (+ optional embeddedText hint),
// and returns the model's raw text. It should throw RateLimitError on HTTP 429.
// Keeping the fetch injected means THIS file has no key, no network, no SDK —
// so it's fully testable/standalone and the key never lives here.

export type ModelCaller = (args: {
  prompt: string;
  imageBase64: string;
  imageMimeType: string;
}) => Promise<string>;

export async function preparePage(
  input: PreparePageInput,
  callModel: ModelCaller,
  retry?: RetryOptions
): Promise<PreparePageResult> {
  const prompt = buildPrompt(input);
  const rawText = await withBackoff(
    () =>
      callModel({
        prompt,
        imageBase64: input.imageBase64,
        imageMimeType: input.imageMimeType ?? "image/jpeg",
      }),
    retry
  );
  const parsed = parseGeminiJson(rawText);
  return filterToAllowlists(parsed, input.allowlists);
}
