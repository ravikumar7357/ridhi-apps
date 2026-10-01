/* ================= DELIVERY DAYS FROM THE USA WAREHOUSE =================
 *
 * Ravi, 2026-09-26: "sirf me usa zip code dalu or baha kitne din me delivery ho jayegi wo check kar saku."
 * The zip is placed on the map (a public zip lookup when it answers; the first three digits' state when it does not),
 * the distance to the warehouse zip gives the carrier ZONE, and the zone gives the days ground, priority and express
 * services usually take. AN ESTIMATE FROM DISTANCE ZONES, NOT A CARRIER QUOTE — the screen says so. */
const ZIP3_STATE = [[5, 5, 'NY'], [6, 9, 'PR'], [10, 27, 'MA'], [28, 29, 'RI'], [30, 38, 'NH'], [39, 49, 'ME'], [50, 59, 'VT'], [60, 69, 'CT'], [70, 89, 'NJ'],
  [100, 149, 'NY'], [150, 196, 'PA'], [197, 199, 'DE'], [200, 205, 'DC'], [206, 219, 'MD'], [220, 246, 'VA'], [247, 268, 'WV'], [270, 289, 'NC'], [290, 299, 'SC'],
  [300, 319, 'GA'], [320, 349, 'FL'], [350, 369, 'AL'], [370, 385, 'TN'], [386, 397, 'MS'], [398, 399, 'GA'], [400, 427, 'KY'], [430, 459, 'OH'], [460, 479, 'IN'], [480, 499, 'MI'],
  [500, 528, 'IA'], [530, 549, 'WI'], [550, 567, 'MN'], [570, 577, 'SD'], [580, 588, 'ND'], [590, 599, 'MT'], [600, 629, 'IL'], [630, 658, 'MO'], [660, 679, 'KS'], [680, 693, 'NE'],
  [700, 714, 'LA'], [716, 729, 'AR'], [730, 749, 'OK'], [750, 799, 'TX'], [800, 816, 'CO'], [820, 831, 'WY'], [832, 838, 'ID'], [840, 847, 'UT'], [850, 865, 'AZ'], [870, 884, 'NM'],
  [889, 898, 'NV'], [900, 961, 'CA'], [967, 968, 'HI'], [970, 979, 'OR'], [980, 994, 'WA'], [995, 999, 'AK']];
const STATE_LL = { AL: [32.8, -86.8], AK: [64.2, -149.5], AZ: [34.2, -111.9], AR: [34.9, -92.4], CA: [36.8, -119.4], CO: [39.0, -105.5], CT: [41.6, -72.7], DE: [39.0, -75.5],
  DC: [38.9, -77.0], FL: [28.6, -82.4], GA: [32.7, -83.4], HI: [20.8, -156.3], ID: [44.4, -114.6], IL: [40.0, -89.2], IN: [39.9, -86.3], IA: [42.1, -93.5], KS: [38.5, -98.4],
  KY: [37.5, -85.3], LA: [31.1, -92.0], ME: [45.4, -69.2], MD: [39.0, -76.8], MA: [42.3, -71.8], MI: [44.3, -85.4], MN: [46.3, -94.3], MS: [32.7, -89.7], MO: [38.4, -92.5],
  MT: [47.0, -109.6], NE: [41.5, -99.8], NV: [39.3, -116.6], NH: [43.7, -71.6], NJ: [40.2, -74.7], NM: [34.4, -106.1], NY: [42.9, -75.5], NC: [35.6, -79.4], ND: [47.5, -100.5],
  OH: [40.3, -82.8], OK: [35.6, -97.5], OR: [43.9, -120.6], PA: [40.9, -77.8], RI: [41.7, -71.5], SC: [33.9, -80.9], SD: [44.4, -100.2], TN: [35.9, -86.4], TX: [31.5, -99.3],
  UT: [39.3, -111.7], VT: [44.1, -72.7], VA: [37.5, -78.9], WA: [47.4, -120.5], WV: [38.6, -80.6], WI: [44.6, -89.9], WY: [43.0, -107.5], PR: [18.2, -66.5] };
const zipState = zip => { const n = parseInt(String(zip).slice(0, 3), 10); const r = ZIP3_STATE.find(x => n >= x[0] && n <= x[1]); return r ? r[2] : ''; };
const ZIP_CACHE = {};
/** Where a zip is: { lat, lng, place, state, src: 'api' | 'state' } — or null for a zip no table knows. */
async function zipLL(zip) {
  const z = String(zip || '').replace(/[^0-9]/g, '').slice(0, 5);
  if (z.length !== 5) return null;
  if (ZIP_CACHE[z]) return ZIP_CACHE[z];
  let out = null;
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => { try { ctl && ctl.abort(); } catch (e) { /* nothing to abort */ } }, 5000);
    const r = await fetch('https://api.zippopotam.us/us/' + z, ctl ? { signal: ctl.signal } : {});
    clearTimeout(t);
    if (r && r.ok) {
      const d = await r.json(); const p = d && d.places && d.places[0];
      if (p) out = { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), place: p['place name'] || '', state: p['state abbreviation'] || '', src: 'api' };
    }
  } catch (e) { out = null; }
  if (!out) { const st = zipState(z); if (st && STATE_LL[st]) out = { lat: STATE_LL[st][0], lng: STATE_LL[st][1], place: '', state: st, src: 'state' }; }
  if (out) ZIP_CACHE[z] = out;
  return out;
}
const milesBetween = (a, b) => { const R = 3958.8, r = x => x * Math.PI / 180; const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
/** Carrier zone from distance (the USPS / UPS ground bands); 9 for Alaska, Hawaii and Puerto Rico. */
function zoneOf(miles, state) {
  if (['AK', 'HI', 'PR'].indexOf(state) >= 0) return 9;
  return miles <= 50 ? 1 : miles <= 150 ? 2 : miles <= 300 ? 3 : miles <= 600 ? 4 : miles <= 1000 ? 5 : miles <= 1400 ? 6 : miles <= 1800 ? 7 : 8;
}
/** Days each service usually takes for a zone: [ground, priority (2–3 day), express]. */
const ZONE_DAYS = { 1: ['1–2', '1–2', '1'], 2: ['1–2', '1–2', '1'], 3: ['2', '1–2', '1'], 4: ['2–3', '2', '1'], 5: ['3', '2–3', '1–2'], 6: ['3–4', '2–3', '1–2'], 7: ['4', '2–3', '1–2'], 8: ['4–5', '3', '1–2'], 9: ['5–8', '3–5', '2–3'] };
async function daysEstimate(fromZip, toZip) {
  const [a, b] = await Promise.all([zipLL(fromZip), zipLL(toZip)]);
  if (!a) return { err: 'The warehouse zip ' + fromZip + ' is not one I can place.' };
  if (!b) return { err: 'The zip ' + toZip + ' is not one I can place — five digits, USA.' };
  const miles = Math.round(milesBetween(a, b));
  const zone = zoneOf(miles, b.state);
  return { from: a, to: b, miles, zone, days: ZONE_DAYS[zone], rough: a.src === 'state' || b.src === 'state' };
}
