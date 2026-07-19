// weather.js — Open-Meteo current weather (WEATHER_SPEC §1-§2). The ONLY
// permitted network endpoint in this package (CLAUDE.md). Continuous values
// live on the transient `weatherNow` object; the mapped state string goes
// to the zustand store as a discrete event only when it CHANGES.

import { getCoarseLocation } from './location';

// Transient (read per-frame, never re-renders). fetchedAt 0 = never.
export const weatherNow = {
  weatherCode: null,
  cloudCover: null,
  sunrise: null,   // ISO strings from the API
  sunset: null,
  fetchedAt: 0,
  coords: null,    // {latitude, longitude} once known -- sun.js needs it
  // Dev override (WEATHER_SPEC §5): set to a state string to force it.
  force: null,
};

const MIN_REQUEST_GAP_MS = 5 * 60 * 1000;   // debounce (§1 + §6 budget)
const STALE_AFTER_MS = 3 * 60 * 60 * 1000;  // §5: reuse last fetch < 3h old
let lastAttemptAt = 0;

/** WMO weather_code -> scene state (WEATHER_SPEC §2). Unknown -> 'partly'. */
export function stateForCode(code) {
  if (code === null || code === undefined) return 'clear';
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return 'partly';
}

/** Current mapped state, honoring the dev override and staleness. */
export function currentWeatherState() {
  if (weatherNow.force) return weatherNow.force;
  if (!weatherNow.fetchedAt || Date.now() - weatherNow.fetchedAt > STALE_AFTER_MS) return 'clear';
  return stateForCode(weatherNow.weatherCode);
}

/** Fetch if allowed by the debounce. Never throws; failures leave the
 *  previous data in place (fallback chain §5). Returns the mapped state. */
export async function refreshWeather() {
  const now = Date.now();
  if (now - lastAttemptAt < MIN_REQUEST_GAP_MS) return currentWeatherState();
  lastAttemptAt = now;

  const coords = await getCoarseLocation();
  if (!coords) return currentWeatherState();
  weatherNow.coords = coords;

  try {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${coords.latitude.toFixed(3)}&longitude=${coords.longitude.toFixed(3)}`
      + '&current=temperature_2m,weather_code,cloud_cover,is_day'
      + '&daily=sunrise,sunset&timezone=auto';
    const res = await fetch(url);
    if (!res.ok) return currentWeatherState();
    const data = await res.json();
    weatherNow.weatherCode = data?.current?.weather_code ?? null;
    weatherNow.cloudCover = data?.current?.cloud_cover ?? null;
    weatherNow.sunrise = data?.daily?.sunrise?.[0] ?? null;
    weatherNow.sunset = data?.daily?.sunset?.[0] ?? null;
    weatherNow.fetchedAt = Date.now();
  } catch (e) {
    // Network down: keep whatever we had (staleness handled at read time).
  }
  return currentWeatherState();
}
