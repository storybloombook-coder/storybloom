// devFlags.js — mutable dev-only toggles for the ship-readiness gate and
// VISUAL_QUALITY_SPEC's acceptance checks (same "plain exported mutable
// object" convention as easterEggs.js's `eggs`, not React state: these are
// flipped from a debug menu/console, never read as render input elsewhere).

// VISUAL_QUALITY_SPEC §7: toggling `toon` swaps MeshToonMaterial's
// gradientMap in/out (soft-gradient vs banded-illustration shading);
// toggling `fillLight` removes the AtmosphereDirector's bounce-light rig
// entry so shadow-side faces should visibly flatten toward near-black.
export const quality = { toon: true, fillLight: true };

// VISUAL_QUALITY_SPEC §4: the adaptive-dpr chosen value logs here once it
// settles (ship-readiness gate's FPS histogram reads this same flag family).
// Live feedback: "very laggy now" -- turned on temporarily so the adaptive-
// DPR settle log (features/kolobok/src/scene/AdaptiveQuality.jsx) shows up
// in logcat with real frame-time numbers instead of guessing. Flip back to
// false once the actual bottleneck is found.
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
