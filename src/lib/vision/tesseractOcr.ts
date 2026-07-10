// vision/tesseractOcr.ts — on-device OCR (the BASE path), Android.
//
// Wraps the local `expo-tesseract-ocr` native module (Tesseract4Android). This
// is the free, open-source, fully-offline OCR that reads Cyrillic (`rus`) — the
// only path immune to Gemini's region/account limits (the Belarus problem). ML
// Kit was rejected because it cannot read Cyrillic.
//
// Requires a CUSTOM DEV BUILD — the native module is not present in Expo Go, so
// isAvailable() returns false there and the vision factory falls back. Once the
// dev build is installed, isAvailable() flips true and the on-device path is
// used automatically. See docs/tesseract-dev-build.md.
//
// Language: we always init the COMBINED "eng+rus" model, so a photo book's
// language need not be known before OCR — the analyzer picks EN vs RU vocab from
// the recognized text (see composeOnDevice in index.ts).
//
// Traineddata (~5-15 MB per language) is NOT committed (see CHANGES-TODO.md
// guardrails). It's downloaded once on first use into app storage, then cached
// offline forever. Override the source with EXPO_PUBLIC_TESSDATA_URL, or
// side-load the files into <documents>/tesseract/tessdata/ for a fully offline
// first run.

import { Directory, File as ExpoFile, Paths } from 'expo-file-system';

import * as Tesseract from '../../../modules/expo-tesseract-ocr';
import type { OcrProvider, OcrRecognizeInput, OcrResult, VisionLang } from './types';

const TESS_LANGS = 'eng+rus';
const LANG_FILES = ['eng.traineddata', 'rus.traineddata'];
const DEFAULT_BASE_URL = 'https://github.com/tesseract-ocr/tessdata_fast/raw/main';

/** Root passed to Tesseract's init() — it must be the PARENT of `tessdata/`. */
function ocrRoot(): Directory {
  return new Directory(Paths.document, 'tesseract');
}

/** Ensure `<documents>/tesseract/tessdata/<lang>.traineddata` exist, downloading
 *  any that are missing. Returns the parent dir Tesseract wants. */
async function ensureTessdata(): Promise<string> {
  const root = ocrRoot();
  const tessdata = new Directory(root, 'tessdata');
  if (!tessdata.exists) tessdata.create({ intermediates: true, idempotent: true });

  const baseUrl = (process.env.EXPO_PUBLIC_TESSDATA_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  for (const name of LANG_FILES) {
    const dest = new ExpoFile(tessdata, name);
    if (dest.exists) continue;
    try {
      await ExpoFile.downloadFileAsync(`${baseUrl}/${name}`, dest);
    } catch (err: any) {
      throw new Error(
        `Failed to download OCR language data "${name}" from ${baseUrl}. ` +
          `Connect to the internet for the one-time download, or side-load the ` +
          `file into ${tessdata.uri}. Cause: ${err?.message ?? err}`
      );
    }
  }
  return root.uri;
}

export const tesseractOcr: OcrProvider = {
  id: 'tesseract',
  onDevice: true,

  isAvailable(): boolean {
    return Tesseract.isSupported();
  },

  // `lang` is only a hint — we load the combined eng+rus model regardless, so
  // the caller doesn't need to know the book's language before OCR.
  async load(_lang: VisionLang): Promise<void> {
    const parentDir = await ensureTessdata();
    await Tesseract.init(parentDir, TESS_LANGS);
  },

  async recognize(input: OcrRecognizeInput): Promise<OcrResult> {
    const { text, meanConfidence } = await Tesseract.recognizeBase64(input.imageBase64);
    return {
      ocrText: text,
      // Tesseract reports 0-100; normalize to 0..1, or undefined when unknown.
      confidence: meanConfidence >= 0 ? meanConfidence / 100 : undefined,
    };
  },

  async unload(): Promise<void> {
    await Tesseract.release();
  },
};
