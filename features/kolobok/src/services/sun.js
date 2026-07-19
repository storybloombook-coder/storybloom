// sun.js — NOAA-style solar position approximation (WEATHER_SPEC §1).
// Pure math, no deps. Recomputed once per minute by AtmosphereDirector,
// never per frame.

const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Solar elevation + azimuth (degrees) for lat/lon at a JS Date. Standard
 *  low-precision NOAA algorithm: good to ~0.5 deg, plenty for sky staging. */
export function solarPosition(lat, lon, date = new Date()) {
  const ms = date.getTime();
  // Julian day from Unix epoch, then centuries from J2000.
  const jd = ms / 86400000 + 2440587.5;
  const t = (jd - 2451545) / 36525;

  const meanLon = (280.46646 + t * 36000.76983) % 360;
  const meanAnom = 357.52911 + t * 35999.05029;
  const eccent = 0.016708634 - t * 0.000042037;
  const eqCenter = Math.sin(rad(meanAnom)) * (1.914602 - t * 0.004817)
    + Math.sin(rad(2 * meanAnom)) * 0.019993
    + Math.sin(rad(3 * meanAnom)) * 0.000289;
  const trueLon = meanLon + eqCenter;
  const apparentLon = trueLon - 0.00569 - 0.00478 * Math.sin(rad(125.04 - 1934.136 * t));
  const obliq = 23.439291 - t * 0.0130042;
  const declination = deg(Math.asin(Math.sin(rad(obliq)) * Math.sin(rad(apparentLon))));

  // Equation of time (minutes), for true solar time.
  const y = Math.tan(rad(obliq / 2)) ** 2;
  const eqTime = 4 * deg(
    y * Math.sin(2 * rad(meanLon))
    - 2 * eccent * Math.sin(rad(meanAnom))
    + 4 * eccent * y * Math.sin(rad(meanAnom)) * Math.cos(2 * rad(meanLon))
    - 0.5 * y * y * Math.sin(4 * rad(meanLon))
    - 1.25 * eccent * eccent * Math.sin(2 * rad(meanAnom)),
  );

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const trueSolarMin = (utcMinutes + eqTime + 4 * lon + 1440) % 1440;
  const hourAngle = trueSolarMin / 4 - 180;

  const elevation = deg(Math.asin(
    Math.sin(rad(lat)) * Math.sin(rad(declination))
    + Math.cos(rad(lat)) * Math.cos(rad(declination)) * Math.cos(rad(hourAngle)),
  ));
  let azimuth = deg(Math.acos(
    Math.min(1, Math.max(-1,
      (Math.sin(rad(declination)) - Math.sin(rad(elevation)) * Math.sin(rad(lat)))
      / (Math.cos(rad(elevation)) * Math.cos(rad(lat))))),
  ));
  if (hourAngle > 0) azimuth = 360 - azimuth;

  return { elevation, azimuth };
}

/** Elevation (deg) -> the two ART_SPEC §8 palette rows to blend and the mix
 *  factor (WEATHER_SPEC §1 bands). `beforeNoon` picks morning vs evening
 *  for the golden hour and sunrise vs sunset for twilight. */
export function phaseBlendForElevation(elevation, beforeNoon) {
  if (elevation < -8) return { a: 'night', b: 'night', t: 0 };
  if (elevation < 0) {
    return { a: 'night', b: beforeNoon ? 'sunrise' : 'sunset', t: (elevation + 8) / 8 };
  }
  if (elevation < 10) {
    return { a: beforeNoon ? 'sunrise' : 'sunset', b: beforeNoon ? 'morning' : 'evening', t: elevation / 10 };
  }
  return { a: 'day', b: 'day', t: 0 };
}
