// location.js — one-shot coarse device location (WEATHER_SPEC §1). Denied or
// unavailable resolves to null; everything downstream falls back to the
// clock table (§5), never blocking the scene.

import * as Location from 'expo-location';

let cached = null;
let requested = false;

/** Coarse coords { latitude, longitude } or null. Asks for permission at
 *  most once per app run; caches whatever it gets. */
export async function getCoarseLocation() {
  if (cached || requested) return cached;
  requested = true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync()
      ?? await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest });
    if (pos) cached = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
  } catch (e) {
    cached = null;
  }
  return cached;
}
