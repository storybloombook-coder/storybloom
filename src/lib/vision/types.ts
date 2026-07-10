// vision/types.ts — swappable VISION-provider interface
//
// Mirrors the ai/ model abstraction and the speech/ SpeechRecognizer: isolate
// the vision pipeline behind these interfaces so implementations can be swapped
// per user/region without touching UI. See CLAUDE.md "AI provider must be
// swappable" and the Belarus recommendation (docs/vision-providers.md).
//
// The kit originally did OCR + scene + cues in ONE Gemini call. That breaks
// where Gemini is unavailable (e.g. Belarus). So the pipeline is split into two
// composable capabilities:
//
//   OcrProvider   image  -> text          (on-device Tesseract is the BASE)
//   CueAnalyzer   text(+image) -> cues     (local matcher OR cloud enhancement)
//
// A VisionProvider composes one of each into the single preparePage() call the
// app already uses, so downstream code (add-book.tsx) is unchanged.

import type {
  PreparePageInput,
  PreparePageResult,
  SoundAllowlists,
} from '../ai/gemini';
import type { PageType } from '../types';

export type VisionLang = 'en' | 'ru';

/** How the pipeline is wired for a given book/user.
 *  - 'ondevice': Tesseract OCR + local trigger matcher. Fully offline, the
 *    Belarus-proof base. No network, no account, no billing.
 *  - 'hybrid':   Tesseract OCR (on-device) + cloud analyzer for richer
 *    scene/mood. Text stays on-device; only analysis is cloud.
 *  - 'cloud':    a cloud VLM does OCR + analysis in one shot (the original kit
 *    path). Used where on-device OCR isn't available yet (e.g. Expo Go). */
export type VisionMode = 'ondevice' | 'hybrid' | 'cloud';

// ---- OCR: image -> text --------------------------------------------------

export interface OcrResult {
  ocrText: string;
  /** VLMs can also classify the page; plain OCR engines cannot (undefined). */
  pageType?: PageType;
  /** Engine confidence 0..1 when available. */
  confidence?: number;
}

export interface OcrRecognizeInput {
  imageBase64: string;
  imageMimeType: string;
  lang: VisionLang;
}

/** Turns a page image into text. On-device (Tesseract) is the base; a cloud
 *  VLM can also serve as an OCR engine where reachable. */
export interface OcrProvider {
  readonly id: string;
  readonly onDevice: boolean;
  /** False until the engine can actually run here (e.g. Tesseract needs a
   *  custom dev build — it returns false in Expo Go). The factory uses this to
   *  fall back gracefully. */
  isAvailable(): boolean;
  /** Load/prepare the language model. Call once before recognize(). */
  load(lang: VisionLang): Promise<void>;
  recognize(input: OcrRecognizeInput): Promise<OcrResult>;
  unload?(): Promise<void>;
}

// ---- Analysis: text (+ optional image) -> scene + cues -------------------

export interface AnalyzeInput {
  ocrText: string;
  /** Optional page image — cloud analyzers use it for scene/mood; the local
   *  analyzer ignores it (text-only). */
  imageBase64?: string;
  imageMimeType?: string;
  /** From OCR when known; the analyzer may refine it. */
  pageType?: PageType;
  allowlists: SoundAllowlists;
  lang: VisionLang;
}

/** Turns page text into scene + cues. The local analyzer uses the bundled
 *  trigger vocabulary (offline). A cloud analyzer (Gemini/Qwen) gives richer
 *  scene/mood analysis when reachable. Both return the SAME shape. */
export interface CueAnalyzer {
  readonly id: string;
  readonly onDevice: boolean;
  analyze(input: AnalyzeInput): Promise<PreparePageResult>;
}

// ---- Composed provider (what the app calls) ------------------------------

export interface VisionProvider {
  readonly mode: VisionMode;
  readonly ocrId: string;
  readonly analyzerId: string;
  /** Same signature/return as the original ai/gemini preparePage, so callers
   *  don't change. `lang` is optional; if omitted it's detected from the text. */
  preparePage(
    input: PreparePageInput & { lang?: VisionLang }
  ): Promise<PreparePageResult>;
}

/** Cheap language guess: any Cyrillic letter -> Russian, else English. */
export function detectLang(text: string): VisionLang {
  return /[Ѐ-ӿ]/.test(text) ? 'ru' : 'en';
}
