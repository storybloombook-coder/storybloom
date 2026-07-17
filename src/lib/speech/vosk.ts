// speech/vosk.ts — SpeechRecognizer implementation backed by react-native-vosk
//
// Primary speech engine (see CLAUDE.md / CHANGES-TODO.md CHANGE 1): fully
// on-device, free, offline, first-class EN + RU. Requires a custom dev build
// (native module) — does not run in Expo Go.
//
// react-native-vosk@2.1.7 exports module-level functions (not a class) —
// verified against node_modules/react-native-vosk/lib/typescript/src/index.d.ts.

import {
  loadModel,
  unload as voskUnload,
  start as voskStart,
  stop as voskStop,
  onPartialResult,
  onResult,
  onResultRaw,
} from "react-native-vosk";
import type { EventSubscription } from "react-native";
import type { RecognizedWord, SpeechLang, SpeechRecognizer } from "./types";

// Vosk's raw hypothesis JSON for a finalized chunk — the shape onResultRaw
// delivers (see patches/react-native-vosk+2.1.7.patch). "result" is present
// only when the chunk actually recognized words; a silent/empty chunk omits
// it entirely.
interface VoskRawHypothesis {
  text?: string;
  result?: Array<{ word: string; conf: number; start?: number; end?: number }>;
}

function parseRawHypothesis(json: string): RecognizedWord[] | null {
  try {
    const parsed = JSON.parse(json) as VoskRawHypothesis;
    if (!Array.isArray(parsed.result)) return null;
    return parsed.result.map((w) => ({ word: w.word, confidence: w.conf }));
  } catch {
    return null; // malformed/unexpected payload — caller just won't get confidence this chunk
  }
}

// Bundled/downloaded-at-build-time model folder names per language. Actual
// model files are NOT committed to git (see CHANGES-TODO.md guardrails).
const MODEL_PATHS: Record<SpeechLang, string> = {
  en: "vosk-model-small-en-us",
  ru: "vosk-model-small-ru",
};

export function createVoskRecognizer(): SpeechRecognizer {
  let partialSub: EventSubscription | undefined;
  let resultSub: EventSubscription | undefined;
  let resultRawSub: EventSubscription | undefined;

  return {
    async load(lang: SpeechLang) {
      await loadModel(MODEL_PATHS[lang]);
    },

    async start({ onPartial, onResult: onResultCb, onResultWithConfidence, vocabulary }) {
      partialSub = onPartialResult((text: string) => onPartial(text));
      resultSub = onResult((text: string) => onResultCb(text));
      // onResultRaw is a Storybloom patch (see patches/react-native-vosk+2.1.7.patch)
      // firing right alongside onResult with the SAME chunk's per-word
      // confidence, which the library's built-in onResult discards.
      if (onResultWithConfidence) {
        resultRawSub = onResultRaw((json: string) => {
          const words = parseRawHypothesis(json);
          if (words && words.length > 0) onResultWithConfidence(words);
        });
      }
      // Grammar-constrain the decoder to this book's own words. Unrestricted,
      // the small model is free to guess ANY Russian word for a given sound —
      // closing the search space down to words that can actually appear on
      // the page removes most of that guessing room. "[unk]" keeps a genuine
      // off-script word (a child interrupting, a stumble) from being forced
      // into the closest in-vocabulary word instead of just being discarded.
      const grammar = vocabulary && vocabulary.length > 0 ? [...vocabulary, "[unk]"] : undefined;
      await voskStart(grammar ? { grammar } : undefined);
    },

    async stop() {
      voskStop();
      partialSub?.remove();
      resultSub?.remove();
      resultRawSub?.remove();
    },

    async unload() {
      voskUnload();
    },
  };
}
