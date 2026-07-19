import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber/native';
import { PALETTES, currentPhase } from '../config/atmosphere';
import { atmosphereLive, orbit, story, useSceneStore } from '../state/sceneStore';
import { refreshWeather, weatherNow, currentWeatherState } from '../services/weather';
import { solarPosition, phaseBlendForElevation } from '../services/sun';

// Per-state scene targets (WEATHER_SPEC §2). Missing keys inherit `clear`.
const GRAY = [0xaa / 255, 0xb4 / 255, 0xbd / 255];
const STATE_TARGETS = {
  clear: { clouds: 2, cloudOp: 0.7, cloudColor: [1, 1, 1], dirMul: 1, ambAdd: 0, desat: 0, fogNear: 16, fogFar: 30 },
  partly: { clouds: 5, cloudOp: 0.85, cloudColor: [1, 1, 1], dirMul: 1, ambAdd: 0, desat: 0, fogNear: 16, fogFar: 30 },
  overcast: { clouds: 8, cloudOp: 0.9, cloudColor: [0.78, 0.8, 0.82], dirMul: 0.8, ambAdd: 0.05, desat: 0.2, fogNear: 16, fogFar: 30 },
  fog: { clouds: 2, cloudOp: 0.4, cloudColor: [0.85, 0.87, 0.89], dirMul: 0.7, ambAdd: 0, desat: 0.3, fogNear: 8, fogFar: 20 },
  rain: { clouds: 7, cloudOp: 0.9, cloudColor: [0.54, 0.58, 0.63], dirMul: 0.7, ambAdd: 0, desat: 0.3, fogNear: 16, fogFar: 30 },
  snow: { clouds: 6, cloudOp: 0.85, cloudColor: [0.91, 0.93, 0.94], dirMul: 0.9, ambAdd: 0.1, desat: 0.15, fogNear: 16, fogFar: 30 },
  storm: { clouds: 8, cloudOp: 0.95, cloudColor: [0.35, 0.38, 0.43], dirMul: 0.55, ambAdd: 0, desat: 0.45, fogNear: 16, fogFar: 30 },
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
}]));

/** Owns the scene's fog + lights and every per-frame atmosphere blend
 *  (WEATHER_SPEC): solar phase x weather state -> atmosphereLive, which
 *  Sky/WeatherSystems/IzbaWindow read. Also schedules weather refreshes,
 *  the storm flash beat, and the sleep-mode power state. */
export function AtmosphereDirector() {
  const setWeatherState = useSceneStore((s) => s.setWeatherState);
  const fogRef = useRef();
  const ambientRef = useRef();
  const dirRef = useRef();

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
    L.fogNear = lerp(L.fogNear, w((tt) => tt.fogNear), t);
    L.fogFar = lerp(L.fogFar, w((tt) => tt.fogFar), t);
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
    if (ambientRef.current) ambientRef.current.intensity = L.ambient + flash * 0.8;
    if (dirRef.current) {
      dirRef.current.intensity = L.dirInt + flash * 1.5;
      dirRef.current.color.setRGB(L.dirLight[0], L.dirLight[1], L.dirLight[2]);
    }
  });

  return (
    <>
      <fog ref={fogRef} attach="fog" args={['#bfe3f2', 16, 30]} />
      <ambientLight ref={ambientRef} intensity={0.7} />
      <directionalLight ref={dirRef} position={[6, 10, 4]} intensity={1.1} />
    </>
  );
}
