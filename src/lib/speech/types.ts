// speech/types.ts — swappable speech-recognition interface
//
// Mirrors the ai/ provider abstraction: isolate the recognizer behind this
// interface so the implementation (Vosk now, whisper.rn later) can be swapped
// without touching UI code. See CLAUDE.md "AI provider must be swappable".
//
// Reading-time recognition is ALIGNMENT against a known page script, not open
// transcription — the full ocr_text is already in SQLite from Prep. Keep the
// two jobs separate:
//   - keyword alignment (hard): match live speech position to known page text.
//   - "next page" command (easy): detect one fixed phrase per language.

export type SpeechLang = "en" | "ru";

/** One recognized word from a FINALIZED chunk, with the engine's own
 *  confidence 0..1 that it heard that word correctly. Only ever available
 *  for a completed chunk (matching onResult, never onPartial) — engines
 *  don't compute per-word confidence for a still-in-progress hypothesis.
 *  Word order matches the plain-text onResult string for the same chunk. */
export interface RecognizedWord {
  word: string;
  confidence: number;
}

export interface SpeechRecognizer {
  /** Load/prepare the model for a language. Call once before start(). */
  load(lang: SpeechLang): Promise<void>;
  /** Begin streaming recognition. onPartial fires on interim results,
   *  onResult fires on finalized chunks. */
  start(opts: {
    lang: SpeechLang;
    onPartial: (text: string) => void;
    onResult: (text: string) => void;
    /** Same chunk as onResult, WITH per-word confidence — fires right after
     *  it (same text, richer shape) when the engine supports it. Optional:
     *  an engine/implementation that can't provide confidence just never
     *  calls it, and callers that don't care can leave it unset. */
    onResultWithConfidence?: (words: RecognizedWord[]) => void;
    /** Words the recognizer should restrict itself to (plus "[unk]" for
     *  anything else) — passing the known page text as a closed vocabulary
     *  cuts recognition errors sharply versus open-domain decoding,
     *  especially for the small Russian model. Implementations that don't
     *  support a constrained grammar may ignore this. */
    vocabulary?: string[];
  }): Promise<void>;
  /** Stop the current recognition session. */
  stop(): Promise<void>;
  /** Release the loaded model. */
  unload(): Promise<void>;
}

export const NEXT_PAGE_PHRASES: Record<SpeechLang, string> = {
  en: "next page",
  ru: "следующая страница",
};
