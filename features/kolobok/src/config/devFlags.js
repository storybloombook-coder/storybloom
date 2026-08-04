// devFlags.js — mutable dev-only toggles for the ship-readiness gate and
// VISUAL_QUALITY_SPEC's acceptance checks (same "plain exported mutable
// object" convention as easterEggs.js's `eggs`, not React state: these are
// flipped from a debug menu/console, never read as render input elsewhere).

// VISUAL_QUALITY_SPEC §7: toggling `toon` swaps MeshToonMaterial's
// gradientMap in/out (soft-gradient vs banded-illustration shading);
// toggling `fillLight` removes the AtmosphereDirector's bounce-light rig
// entry so shadow-side faces should visibly flatten toward near-black.
export const quality = { toon: true, fillLight: true };

// VISUAL_QUALITY_SPEC §4: AdaptiveQuality.jsx logs its rolling frame-time
// average and every dpr change behind this flag (the ship-readiness gate's
// FPS histogram reads the same flag family).
//
// ON deliberately, for the live "the scene feels laggy sometimes"
// investigation: it now logs one line per 5s window, so `adb logcat | grep
// kolobok` shows exactly which moments dip and which dpr the ladder settles
// on. Turn back off once that's characterised -- it's a console.log per
// window, not free.
export const perf = { hud: true };

// POLISH_SPEC §7: one kill-switch per Phase 8 feature, for the ship-
// readiness audit ("each §5 feature has a dev kill-switch").
export const polish = {
  shadows: true,
  cameraBreath: true,
  pondGlint: true,
  pollen: true,
  birds: true,
  godRays: false, // live feedback: turned off at golden hour
};
