// menu.js — the crossroads stone's three destinations (SPEC.md
// "Navigation"). Labels resolve through strings.js's t() -- ui.menu.* are
// final (docs/STRINGS.md, resolved 2026-07-18). Routes map to Storybloom's
// actual three home-screen destinations (src/app/add-book.tsx,
// create-story.tsx, library.tsx).

export const MENU = [
  { id: 'one', labelKey: 'ui.menu.one', route: '/add-book', accent: '#d9a441' },
  { id: 'two', labelKey: 'ui.menu.two', route: '/create-story', accent: '#8fbf6a' },
  { id: 'three', labelKey: 'ui.menu.three', route: '/library', accent: '#d9722f' },
];
