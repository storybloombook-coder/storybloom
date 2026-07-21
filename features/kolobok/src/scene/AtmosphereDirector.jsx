import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { PALETTES, currentPhase } from '../config/atmosphere';
import { atmosphereLive, orbit, story, useSceneStore } from '../state/sceneStore';
import { refreshWeather, weatherNow, currentWeatherState } from '../services/weather';
import { solarPosition, phaseBlendForElevation } from '../services/sun';
import { eggManager } from './easterEggs';
import { quality } from '../config/devFlags';
import { tickWind } from './wind';

// VISUAL_QUALITY_SPEC §3 light rig constants. Ground tint matches Island.jsx
// BASE_GRASS -- kept as a local literal rather than a cross-file import
// since it's only a coarse "average ground" reference for the hemisphere's
// ground color, not the real per-zone tint.
const GROUND_TINT = [0x7a / 255, 0xa8 / 255, 0x5c / 255];
const WARM_EARTH = [0x5a / 255, 0x4a / 255, 0x38 / 255];
const HEMI_GROUND = WARM_EARTH.map((c, i) => c + (GROUND_TINT[i] - c) * 0.2);
const FILL_COLOR = [0x8f / 255, 0xa8 / 255, 0xd8 / 255];
const SUN_DISTANCE = 20;

// Per-state scene targets (WEATHER_SPEC §2). Missing keys inherit `clear`.
const GRAY = [0xaa / 255, 0xb4 / 255, 0xbd / 255];
// POLISH_SPEC §2: fog/rain/snow override toward their own tighter/farther
// envelope regardless of time of day; clear/partly/overcast/storm have no
// fogNear/fogFar of their own here (left undefined) and fall back to
// whatever the current PALETTES phase blend gives (see phaseFogNear/Far
// below) -- a storm at noon and a storm at night shouldn't share one fixed
// fog distance.
const STATE_TARGETS = {
  clear: { clouds: 2, cloudOp: 0.7, cloudColor: [1, 1, 1], dirMul: 1, ambAdd: 0, desat: 0 },
  partly: { clouds: 5, cloudOp: 0.85, cloudColor: [1, 1, 1], dirMul: 1, ambAdd: 0, desat: 0 },
  overcast: { clouds: 8, cloudOp: 0.9, cloudColor: [0.78, 0.8, 0.82], dirMul: 0.8, ambAdd: 0.05, desat: 0.2 },
  fog: { clouds: 2, cloudOp: 0.4, cloudColor: [0.85, 0.87, 0.89], dirMul: 0.7, ambAdd: 0, desat: 0.3, fogNear: 8, fogFar: 20 },
  rain: { clouds: 7, cloudOp: 0.9, cloudColor: [0.54, 0.58, 0.63], dirMul: 0.7, ambAdd: 0, desat: 0.3, fogNear: 13, fogFar: 25 },
  snow: { clouds: 6, cloudOp: 0.85, cloudColor: [0.91, 0.93, 0.94], dirMul: 0.9, ambAdd: 0.1, desat: 0.15, fogNear: 11, fogFar: 22 },
  storm: { clouds: 8, cloudOp: 0.95, cloudColor: [0.35, 0.38, 0.43], dirMul: 0.55, ambAdd: 0, desat: 0.45 },
};
const STATE_KEYS = Object.keys(STATE_TARGETS);

const WEATHER_REFRESH_MS = 30 * 60 * 1000;
const SUN_RECOMPUTE_MS = 60 * 1000;
const PALETTE_LERP_RATE = 0.5;  // ANIMATION_SPEC §6
const WEATHER_RAMP_RATE = 0.25; // 4s transitions (WEATHER_SPEC §2)
const SLEEP_AFTER_MS = 10000;   // ANIMATION_SPEC §6, story off only

const hex01 = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3Into = (out, a, b, t) => {
  out[0] = lerp(a[0], b[0], t);
  out[1] = lerp(a[1], b[1], t);
  out[2] = lerp(a[2], b[2], t);
};

// Pre-convert palette hex rows once.
const P = Object.fromEntries(Object.entries(PALETTES).map(([k, v]) => [k, {
  zenith: hex01(v.zenith),
  horizon: hex01(v.horizon),
  dirLight: hex01(v.dirLight),
  fog: hex01(v.fog),
  dirInt: v.dirInt,
  ambient: v.ambient,
  window: v.window ?? 0,
  fogNear: v.fogNear,
  fogFar: v.fogFar,
}]));

/** Owns the scene's fog + lights and every per-frame atmosphere blend
 *  (WEATHER_SPEC): solar phase x weather state -> atmosphereLive, which
 *  Sky/WeatherSystems/IzbaWindow read. Also schedules weather refreshes,
 *  the storm flash beat, and the sleep-mode power state. */
export function AtmosphereDirector() {
  const setWeatherState = useSceneStore((s) => s.setWeatherState);
  const fogRef = useRef();
  const hemiRef = useRef();
  const dirRef = useRef();
  const fillRef = useRef();

  const state = useRef({
    ramps: Object.fromEntries(STATE_KEYS.map((k) => [k, k === 'clear' ? 1 : 0])),
    lastSunAt: 0,
    sun: null,           // {elevation, azimuth} or null
    lastWeatherAt: 0,
    weatherStateWas: 'clear',
    nextFlashIn: 12,
    flashT: -1,          // -1 idle; 0.. rising/decaying (seconds since flash start)
    // Scratch color arrays reused every frame (no allocations).
    zen: [0, 0, 0], hor: [0, 0, 0], dl: [0, 0, 0], fg: [0, 0, 0],
  });

  useEffect(() => {
    refreshWeather().then((s) => setWeatherState(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const dt = Number.isFinite(delta) ? Math.min(delta, 1 / 30) : 1 / 60;
    const s = state.current;
    const now = Date.now();

    // Easter egg timelines ride this shared frame hub.
    eggManager.tick(dt);

    // --- Sleep power state (only while the story is off) ---
    orbit.frameParity = !orbit.frameParity;
    orbit.powerState = story.mode === 'off' && now - story.lastInputAt > SLEEP_AFTER_MS
      ? 'sleep' : 'active';

    // --- Weather refresh scheduling (30 min; service itself debounces 5) ---
    if (now - s.lastWeatherAt > WEATHER_REFRESH_MS) {
      s.lastWeatherAt = now;
      refreshWeather().then((st) => setWeatherState(st));
    }
    const weatherState = currentWeatherState();
    if (weatherState !== s.weatherStateWas) {
      s.weatherStateWas = weatherState;
      setWeatherState(weatherState);
    }
    tickWind(weatherState, dt);

    // --- Solar position, once per minute when coords exist ---
    if (weatherNow.coords && now - s.lastSunAt > SUN_RECOMPUTE_MS) {
      s.lastSunAt = now;
      s.sun = solarPosition(weatherNow.coords.latitude, weatherNow.coords.longitude);
    }
    atmosphereLive.sunAzimuth = s.sun ? s.sun.azimuth : null;
    atmosphereLive.sunElevation = s.sun ? s.sun.elevation : null;

    // --- Target palette: solar blend, else the clock-table fallback ---
    let blend;
    if (s.sun) {
      blend = phaseBlendForElevation(s.sun.elevation, new Date().getHours() < 12);
    } else {
      const phase = currentPhase();
      blend = { a: phase, b: phase, t: 0 };
    }
    const A = P[blend.a];
    const B = P[blend.b];
    lerp3Into(s.zen, A.zenith, B.zenith, blend.t);
    lerp3Into(s.hor, A.horizon, B.horizon, blend.t);
    lerp3Into(s.dl, A.dirLight, B.dirLight, blend.t);
    lerp3Into(s.fg, A.fog, B.fog, blend.t);
    let dirInt = lerp(A.dirInt, B.dirInt, blend.t);
    let ambient = lerp(A.ambient, B.ambient, blend.t);
    const windowGlow = lerp(A.window, B.window, blend.t);
    // POLISH_SPEC §2 per-phase fog baseline, before any weather override.
    const phaseFogNear = lerp(A.fogNear, B.fogNear, blend.t);
    const phaseFogFar = lerp(A.fogFar, B.fogFar, blend.t);

    // --- Weather ramps (4s) and their weighted modifiers ---
    let rampSum = 0;
    STATE_KEYS.forEach((k) => {
      const target = k === weatherState ? 1 : 0;
      s.ramps[k] += (target - s.ramps[k]) * Math.min(1, WEATHER_RAMP_RATE * dt * 4);
      rampSum += s.ramps[k];
    });
    const w = (sel) => {
      let acc = 0;
      STATE_KEYS.forEach((k) => { acc += s.ramps[k] * sel(STATE_TARGETS[k]); });
      return acc / Math.max(rampSum, 0.001);
    };
    // fogNear/Far need a per-state FALLBACK (the phase baseline) for states
    // that don't specify their own -- a plain `w()` selector can't express
    // "use this state's value, or else the current phase's" per key.
    const wFog = (key, fallback) => {
      let acc = 0;
      STATE_KEYS.forEach((k) => { acc += s.ramps[k] * (STATE_TARGETS[k][key] ?? fallback); });
      return acc / Math.max(rampSum, 0.001);
    };
    const desat = w((t) => t.desat);
    const dirMul = w((t) => t.dirMul);
    dirInt = dirInt * dirMul;
    ambient += w((t) => t.ambAdd);
    // Desaturate sky/fog toward gray.
    lerp3Into(s.zen, s.zen, GRAY, desat);
    lerp3Into(s.hor, s.hor, GRAY, desat);
    lerp3Into(s.fg, s.fg, GRAY, desat * 0.7);

    // --- Storm flash beat (>=8s gaps, 80ms rise, 250ms decay) ---
    const stormRamp = s.ramps.storm;
    let flash = 0;
    if (stormRamp > 0.5) {
      if (s.flashT < 0) {
        s.nextFlashIn -= dt;
        if (s.nextFlashIn <= 0) { s.flashT = 0; s.nextFlashIn = 8 + Math.random() * 12; }
      } else {
        s.flashT += dt;
        if (s.flashT < 0.08) flash = s.flashT / 0.08;
        else if (s.flashT < 0.33) flash = 1 - (s.flashT - 0.08) / 0.25;
        else s.flashT = -1;
      }
    } else {
      s.flashT = -1;
    }

    // --- Publish (lerping the LIVE values toward targets at 0.5/s, so
    // phase-band changes and weather both ease rather than pop) ---
    const t = Math.min(1, PALETTE_LERP_RATE * dt * 2);
    const L = atmosphereLive;
    lerp3Into(L.zenith, L.zenith, s.zen, t);
    lerp3Into(L.horizon, L.horizon, s.hor, t);
    lerp3Into(L.dirLight, L.dirLight, s.dl, t);
    lerp3Into(L.fogColor, L.fogColor, s.fg, t);
    L.dirInt = lerp(L.dirInt, dirInt, t);
    L.ambient = lerp(L.ambient, ambient, t);
    L.windowGlow = lerp(L.windowGlow, windowGlow, t);
    L.fogNear = lerp(L.fogNear, wFog('fogNear', phaseFogNear), t);
    L.fogFar = lerp(L.fogFar, wFog('fogFar', phaseFogFar), t);
    L.cloudCount = w((tt) => tt.clouds);
    L.cloudOpacity = w((tt) => tt.cloudOp);
    lerp3Into(L.cloudColor, L.cloudColor, [w((tt) => tt.cloudColor[0]), w((tt) => tt.cloudColor[1]), w((tt) => tt.cloudColor[2])], t);
    L.rainT = s.ramps.rain + s.ramps.storm;
    L.snowT = s.ramps.snow;
    L.fogWispT = s.ramps.fog;
    L.flash = flash;

    // --- Apply to the owned fog/lights ---
    if (fogRef.current) {
      fogRef.current.color.setRGB(
        Math.min(1, L.fogColor[0] + flash * 0.6),
        Math.min(1, L.fogColor[1] + flash * 0.6),
        Math.min(1, L.fogColor[2] + flash * 0.6),
      );
      fogRef.current.near = L.fogNear;
      fogRef.current.far = L.fogFar;
    }
    // --- VISUAL_QUALITY_SPEC §3 light rig ---
    // day/night mix purely from the already-blended ambient value (0.30
    // night .. 0.70 day per PALETTES) rather than a second clock lookup.
    const nightT = Math.min(1, Math.max(0, (L.ambient - 0.30) / (0.70 - 0.30)));
    if (hemiRef.current) {
      hemiRef.current.color.setRGB(L.zenith[0], L.zenith[1], L.zenith[2]);
      hemiRef.current.groundColor.setRGB(HEMI_GROUND[0], HEMI_GROUND[1], HEMI_GROUND[2]);
      hemiRef.current.intensity = 0.25 + nightT * (0.55 - 0.25) + flash * 0.4;
    }
    if (dirRef.current) {
      dirRef.current.intensity = L.dirInt + flash * 1.5;
      // "Warmed 6%": a small fixed per-channel bias rather than a lerp
      // toward another named color -- cheap and keeps the existing
      // palette-driven hue intact.
      dirRef.current.color.setRGB(
        Math.min(1, L.dirLight[0] * 1.06),
        Math.min(1, L.dirLight[1] * 1.03),
        L.dirLight[2] * 0.97,
      );
      // Real solar azimuth/elevation when location is available; else keep
      // the original fixed greybox angle (WEATHER_SPEC's device-hour
      // fallback has no azimuth of its own).
      if (s.sun) {
        const az = (s.sun.azimuth * Math.PI) / 180;
        const el = (s.sun.elevation * Math.PI) / 180;
        dirRef.current.position.set(
          Math.sin(az) * Math.cos(el) * SUN_DISTANCE,
          Math.sin(el) * SUN_DISTANCE,
          Math.cos(az) * Math.cos(el) * SUN_DISTANCE,
        );
      } else {
        dirRef.current.position.set(6, 10, 4);
      }
    }
    if (fillRef.current) {
      const fillIntensity = quality.fillLight ? (0.05 + nightT * (0.12 - 0.05)) : 0;
      fillRef.current.intensity = fillIntensity;
      fillRef.current.color.setRGB(FILL_COLOR[0], FILL_COLOR[1], FILL_COLOR[2]);
      if (dirRef.current) {
        // Opposite horizontal direction from the sun, same rough height --
        // this is what keeps toon shadow-side faces from going flat-dark
        // (spec: "bounce light from the sky").
        fillRef.current.position.set(-dirRef.current.position.x, Math.abs(dirRef.current.position.y) * 0.6, -dirRef.current.position.z);
      }
    }
  });

  return (
    <>
      <fog ref={fogRef} attach="fog" args={['#bfe3f2', 16, 30]} />
      <hemisphereLight ref={hemiRef} args={['#8ec4e0', '#5a4a38', 0.55]} />
      <directionalLight ref={dirRef} position={[6, 10, 4]} intensity={1.1} />
      <directionalLight ref={fillRef} position={[-6, 6, -4]} intensity={0.12} color="#8fa8d8" />
    </>
  );
}
