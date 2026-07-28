// i18n.ts — minimal EN/RU UI-text store for the main app shell. Starts
// scoped to just the home screen (CLAUDE.md's build-order milestones don't
// call for full app-wide localization yet); can grow the same way
// features/kolobok/src/config/strings.js already does for the 3D scene.
// Deliberately NOT persisted across app restarts (matches that same
// precedent) -- resets to the device's own language each launch.

import { create } from 'zustand';
import * as Localization from 'expo-localization';

export type Locale = 'en' | 'ru';

const STRINGS = {
  en: {
    title: 'Kolobook',
    subtitle: 'Read a book to life.',
    addBook: 'Add a Book',
    createStory: 'Create a Story',
    myLibrary: 'My Library',
    switchLanguage: 'Switch to Russian',
  },
  ru: {
    title: 'Kolobook',
    subtitle: 'Читайте — и книга оживёт.',
    addBook: 'Новая книга',
    createStory: 'Своя история',
    myLibrary: 'Библиотека',
    switchLanguage: 'Switch to English',
  },
} as const satisfies Record<Locale, Record<string, string>>;

type StringKey = keyof (typeof STRINGS)['en'];

function detectLocale(): Locale {
  const code = Localization.getLocales?.()[0]?.languageCode;
  return code === 'ru' ? 'ru' : 'en';
}

export const useLocaleStore = create<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
}>((set) => ({
  locale: detectLocale(),
  setLocale: (locale) => set({ locale }),
}));

/** Dot-free lookup (this dict has no nesting yet) -- falls back to English,
 *  then the raw key, so a missing translation degrades instead of crashing. */
export function t(key: StringKey, locale: Locale): string {
  return STRINGS[locale]?.[key] ?? STRINGS.en[key] ?? key;
}
