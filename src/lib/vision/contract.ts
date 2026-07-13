// vision/contract.ts — provider-neutral vision types + helpers.
//
// These used to live in ai/gemini.ts, but they describe the shape every vision
// provider speaks (OCR text + scene + cues), not anything Gemini-specific. They
// were extracted here when the Gemini cloud path was removed, so the on-device
// pipeline (Tesseract OCR + local matcher) owns its own contract.

import type { CueIntensity, PageType } from '../types';

/** The library ids a page's cues/ambient may reference. */
export interface SoundAllowlists {
  ambientIds: string[];
  effectIds: string[];
  voiceIds: string[];
}

/** What the app passes in to analyze one page. */
export interface PreparePageInput {
  /** Base64 of the page image (from a photo or a rendered PDF page). */
  imageBase64: string;
  imageMimeType?: string; // default "image/jpeg"
  /** Optional clean text from a PDF page — used verbatim instead of OCR. */
  embeddedText?: string | null;
  allowlists: SoundAllowlists;
}

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
  /** OCR engine mean confidence 0..1 when known; undefined for PDF embedded-text
   *  pages. Diagnostics only. */
  ocrConfidence?: number;
}

/** Safety net: drop any cue/ambient referencing an id outside the allow-lists,
 *  so nothing plays a sound that isn't in the bundled library. */
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
