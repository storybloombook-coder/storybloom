import { requireOptionalNativeModule } from 'expo';

import type { ExpoTesseractOcrModule } from './ExpoTesseractOcr.types';

// requireOptionalNativeModule returns null when the native module isn't linked
// (e.g. running in Expo Go, or before `expo prebuild`), instead of throwing —
// so the JS OcrProvider can report isAvailable() === false and fall back.
export default requireOptionalNativeModule<ExpoTesseractOcrModule>('ExpoTesseractOcr');
