// Types shared between the JS wrapper and the native Android module.

export interface TesseractRecognizeResult {
  /** Recognized UTF-8 text (Cyrillic preserved verbatim). */
  text: string;
  /** Mean confidence 0..100 from Tesseract, or -1 if unavailable. */
  meanConfidence: number;
}

export interface ExpoTesseractOcrModule {
  /** Whether the native module is linked (true only in a dev/prod build, never
   *  in Expo Go). Used by the JS OcrProvider to decide availability. */
  readonly isSupported: boolean;

  /** Initialize the engine with a tessdata parent directory and a Tesseract
   *  language spec, e.g. "eng+rus". `tessdataParentDir` must contain a
   *  `tessdata/` folder holding `<lang>.traineddata`. Safe to call again to
   *  switch languages; a prior engine is released first. */
  init(tessdataParentDir: string, langs: string): Promise<void>;

  /** Recognize text in a JPEG/PNG whose bytes are given as base64. Throws if
   *  init() has not run. */
  recognizeBase64(imageBase64: string): Promise<TesseractRecognizeResult>;

  /** Release the native engine and free memory. */
  release(): Promise<void>;
}
