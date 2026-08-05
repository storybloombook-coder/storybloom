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
// Language: we load a SINGLE Tesseract model — the caller's `lang` (from the
// book's language, chosen by the parent at upload time — see add-book.tsx and
// Book.language in types.ts). A combined "eng+rus" model was tried first, but
// Cyrillic and Latin share many near-identical glyphs (а/a, е/e, о/o, р/p,
// с/c, у/y, х/x), so the combined model was introducing extra confusion on
// top of the stylized/italic fonts already common in children's books.
// Loading just the one language the book actually is eliminates that source
// of ambiguity, and only needs to download one file instead of two.
//
// Traineddata (~2-4 MB per language) is NOT committed (see CHANGES-TODO.md
// guardrails). It's downloaded once on first use into app storage, then cached
// offline forever. Override the source with EXPO_PUBLIC_TESSDATA_URL, or
// side-load the file into <documents>/tesseract/tessdata/ for a fully offline
// first run.

import { Directory, File as ExpoFile, Paths } from 'expo-file-system';

import * as Tesseract from '../../../modules/expo-tesseract-ocr';
import type { OcrProvider, OcrRecognizeInput, OcrResult, VisionLang } from './types';

/** VisionLang -> Tesseract language code -> traineddata filename. */
const TESS_LANG_CODE: Record<VisionLang, string> = { en: 'eng', ru: 'rus' };
// raw.githubusercontent.com, NOT github.com/.../raw/... — the latter answers
// 302 and redirects here. Live feedback: text recognition sat "continuously
// loading" and the tessdata directory was created but stayed empty, which is
// exactly what a download that doesn't follow the redirect looks like.
//
// _fast (not _best): _best is 15MB for English alone and more for Russian,
// which is a long silent wait on a phone before anything can happen at all.
// _fast is the integer-quantised model built for mobile — 4MB, and quicker
// to run as well as to fetch. The accuracy argument for _best assumed the
// download was free; it isn't, and a first run that never finishes is worth
// less than one that's slightly less accurate.
const DEFAULT_BASE_URL = 'https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main';
// Smallest real traineddata is a couple of MB; anything under this is a
// redirect stub or an error page, not a model.
const MIN_TRAINEDDATA_BYTES = 500_000;

/** Root passed to Tesseract's init() — it must be the PARENT of `tessdata/`. */
function ocrRoot(): Directory {
  return new Directory(Paths.document, 'tesseract');
}

/** Ensure `<documents>/tesseract/tessdata/<lang>.traineddata` exists for this
 *  ONE language, downloading it if missing. Returns the parent dir Tesseract
 *  wants. */
async function ensureTessdata(lang: VisionLang): Promise<string> {
  const root = ocrRoot();
  const tessdata = new Directory(root, 'tessdata');
  if (!tessdata.exists) tessdata.create({ intermediates: true, idempotent: true });

  const name = `${TESS_LANG_CODE[lang]}.traineddata`;
  const baseUrl = (process.env.EXPO_PUBLIC_TESSDATA_URL || DEFAULT_BASE_URL).replace(/\/$/, '');
  const dest = new ExpoFile(tessdata, name);
  if (!dest.exists) {
    try {
      await ExpoFile.downloadFileAsync(`${baseUrl}/${name}`, dest);
    } catch (err: any) {
      // A failed download can still leave a partial (or HTML-error-page)
      // file behind. Left in place it would satisfy the `exists` check on
      // every future run, so OCR would fail forever with no way back short
      // of clearing app data -- delete it and let the next attempt retry.
      try { if (dest.exists) dest.delete(); } catch { /* nothing to undo */ }
      throw new Error(
        `Failed to download OCR language data "${name}" from ${baseUrl}. ` +
          `Connect to the internet for the one-time download, or side-load the ` +
          `file into ${tessdata.uri}. Cause: ${err?.message ?? err}`
      );
    }
    // Sanity-check the result. A redirect stub or an error page is a few
    // hundred bytes; a real traineddata file is megabytes. Catching that
    // here turns "OCR silently never works" into a message that says why.
    if (dest.exists && dest.size < MIN_TRAINEDDATA_BYTES) {
      const got = dest.size;
      try { dest.delete(); } catch { /* nothing to undo */ }
      throw new Error(
        `OCR language data "${name}" downloaded as only ${got} bytes, which is ` +
          `too small to be a real model — the source probably returned a redirect ` +
          `or an error page rather than the file. Source: ${baseUrl}`
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

  // Loads exactly the ONE requested language. The caller (composeOnDevice)
  // must know the book's language up front (see Book.language) — we no
  // longer guess-and-combine, since that traded language ambiguity for
  // glyph ambiguity.
  async load(lang: VisionLang): Promise<void> {
    const parentDir = await ensureTessdata(lang);
    await Tesseract.init(parentDir, TESS_LANG_CODE[lang]);
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
