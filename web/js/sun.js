// Sun position (SunCalc algorithm) for Naantali, and Finnish local time -> UTC.
const RAD = Math.PI / 180;
const DAY_MS = 86400000, J1970 = 2440588, J2000 = 2451545;
export const SITE = { lat: 60.4667, lon: 22.0236 };

const toDays = (d) => d.valueOf() / DAY_MS - 0.5 + J1970 - J2000;
const E = RAD * 23.4397;

function lastSundayUTC(year, month /* 0-based */) {
  const d = new Date(Date.UTC(year, month + 1, 0, 1)); // last day of month 01:00 UTC
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

/** Finland: EET (UTC+2), EEST (UTC+3) between the last Sundays of March and October. */
export function finlandOffsetHours(year, month0, day, hour) {
  const t = Date.UTC(year, month0, day, hour);
  const start = lastSundayUTC(year, 2).valueOf(), end = lastSundayUTC(year, 9).valueOf();
  return t >= start + 2 * 3600e3 && t < end + 3 * 3600e3 ? 3 : 2;
}

export function localToUTC(year, month0, day, hours) {
  const off = finlandOffsetHours(year, month0, day, Math.floor(hours));
  return new Date(Date.UTC(year, month0, day, 0, 0, 0) + (hours - off) * 3600e3);
}

/** Returns { azimuth (rad, clockwise from north), altitude (rad) } */
export function sunPosition(date, lat = SITE.lat, lon = SITE.lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(date);
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(L) * Math.sin(E));
  const ra = Math.atan2(Math.sin(L) * Math.cos(E), Math.cos(L));
  const H = RAD * (280.16 + 360.9856235 * d) - lw - ra;
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  return { azimuth: az + Math.PI, altitude: alt };
}

/** Scene axes: +X east, +Y up, -Z north. */
export function sunDirection(pos, out) {
  const ca = Math.cos(pos.altitude);
  out.set(Math.sin(pos.azimuth) * ca, Math.sin(pos.altitude), -Math.cos(pos.azimuth) * ca);
  return out;
}
