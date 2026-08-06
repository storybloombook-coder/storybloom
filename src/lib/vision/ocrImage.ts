// ocrImage.ts — shrink a page photo before it goes to OCR.
//
// Both prep paths (add-book.tsx at creation, book/[id].tsx when adding pages)
// were handing Tesseract the camera's original file. A current phone shoots
// 12MP or more, so that's a ~4000px-wide image and a 4-5MB JPEG — and the
// base64 of it, roughly a third larger again, has to cross into the native
// module as one string before recognition even starts. Tesseract's cost then
// scales with the pixel count it was given. That is why prepping a book took
// as long as it did.
//
// Recognition accuracy depends on how many pixels tall the TEXT is, not on
// how many the page is. Children's book print at 2000px on the long edge is
// far above what Tesseract needs (its own guidance is ~300dpi at the glyph,
// which this clears comfortably), while cutting a 4000px image to a quarter
// of its pixels. Past that point the extra resolution buys nothing and can
// actively hurt: more sensor noise and paper texture for the binarizer to
// mistake for strokes.
//
// The FULL-size original is still what gets stored and displayed — this
// resize exists only for the recognizer.

import { File as ExpoFile } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/** Longest edge, in pixels, that Tesseract is given. */
export const OCR_MAX_EDGE = 2000;

/** JPEG quality for the downscaled copy. Text survives 0.85 without visible
 *  ringing on the glyph edges, which is what OCR would actually suffer from. */
const OCR_QUALITY = 0.85;

/**
 * The size to resize to, or null when the image should be sent as-is.
 *
 * Null covers three cases that all mean "don't touch it": already small
 * enough, dimensions we don't trust (0, NaN, missing), and anything that
 * would come out as an UPSCALE. That last one matters — resize in
 * expo-image-manipulator scales to exactly what it's given, so handing it a
 * fixed 2000 would blow a small thumbnail up to 2000px and make OCR both
 * slower and worse than leaving it alone.
 *
 * Aspect ratio is preserved by scaling both edges by the same factor rather
 * than setting one and letting the library infer the other, so a rounding
 * difference can't quietly stretch the page.
 */
export function ocrResizeTarget(
  width: number,
  height: number,
): { width: number; height: number } | null {
  const longest = Math.max(width, height);
  if (!Number.isFinite(longest) || longest <= 0) return null;
  if (longest <= OCR_MAX_EDGE) return null;
  const scale = OCR_MAX_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Base64 of `uri`, downscaled so its longest edge is at most OCR_MAX_EDGE.
 * `width`/`height` are the image's own dimensions, which both callers already
 * know from the picker or the photo editor.
 *
 * Falls back to the original bytes whenever it can't do better — an image
 * that's already small enough, unknown dimensions, or a resize that fails.
 * Slow OCR is worse than fast OCR; no OCR is worse than either.
 */
export async function base64ForOcr(uri: string, width: number, height: number): Promise<string> {
  const target = ocrResizeTarget(width, height);
  if (!target) return new ExpoFile(uri).base64();
  try {
    const resized = await manipulateAsync(
      uri,
      [{ resize: target }],
      // base64 straight out of the manipulator, so the shrunken copy never
      // has to be written and read back.
      { compress: OCR_QUALITY, format: SaveFormat.JPEG, base64: true },
    );
    if (resized.base64) return resized.base64;
  } catch {
    // Fall through — recognizing a big image beats not recognizing one.
  }
  return new ExpoFile(uri).base64();
}
