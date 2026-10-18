// Delivery-zone classification, shared by the client-facing classify
// endpoint (api/delivery-zone.js) and the server-side revalidation that
// runs before an order is accepted (api/send-email.js). Keeping both on
// this one module is what makes "the same calculation everywhere" true —
// there's no second copy of this logic to drift out of sync.
//
// Geocoding: Nominatim (OpenStreetMap), free, no API key.
// Driving distance: OSRM's public demo router, free, no API key. It has no
// uptime SLA, which is fine at our current order volume; if that ever
// becomes a problem, swap drivingDistanceMiles() for a paid provider
// (Google Distance Matrix, Mapbox) — everything else in this file is
// provider-agnostic.

const SUPABASE_URL = 'https://gubckjmffliwukroluxm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd1YmNram1mZmxpd3Vrcm9sdXhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1NDA4NDYsImV4cCI6MjA5MzExNjg0Nn0.qDuyWCltbNlIPsDdX8tUzZMF1VJgPXipH9wageTqTQw';

// 630 79th Street, Miami Beach, FL 33141 — geocoded once, hardcoded so
// every classification doesn't spend a geocoding call on our own kitchen.
const ORIGIN = { lat: 25.8638641, lon: -80.1252877 };

// Zone 1 — free delivery core: these cities are Zone 1 outright, no distance
// check needed. Miami Beach itself is only Zone 1 north of 38th Street (see
// MIAMI_BEACH_38TH_ST_LAT below) — South Beach/Mid-Beach are not free.
const ZONE1_CITY_KEYWORDS = ['surfside', 'bal harbour', 'bay harbor islands', 'sunny isles beach'];
const MIAMI_BEACH_38TH_ST_LAT = 25.811; // geocoded from "38th Street, Miami Beach, FL"

// Zone 4 (North Broward) and Zone 5 (distant) are named-area lists, checked
// before the generic distance rule — per the business rule, a Fort
// Lauderdale address is Zone 4 even though it's well past the 10-mile Zone 2
// cutoff, and a Boca Raton address is Zone 5 even though it's farther still.
const ZONE4_CITY_KEYWORDS = ['fort lauderdale', 'plantation', 'pompano beach', 'oakland park', 'lauderdale-by-the-sea', 'lauderdale by the sea'];
const ZONE5_CITY_KEYWORDS = ['boca raton', 'coral springs', 'deerfield beach', 'parkland'];

const ZONE2_MAX_MILES = 10;
// Beyond this driving distance, an address that isn't in any named zone is
// outside our supported delivery area entirely (needs manual approval)
// rather than being auto-assigned a fee.
const MAX_SUPPORTED_DISTANCE_MILES = 50;

// A driver tip offsets the delivery fee dollar-for-dollar, but the fee never
// drops below this floor — and zones already at or below the floor (Zone 1
// free, Zone 2 at $20) are left alone; tipping never pushes their fee up.
export const DELIVERY_TIP_DISCOUNT_FLOOR = 20;

export function applyDriverTipDiscount(baseFee, driverTip) {
  if (baseFee === null || baseFee === undefined) return baseFee;
  if (baseFee <= DELIVERY_TIP_DISCOUNT_FLOOR) return baseFee;
  const tip = Number.isFinite(driverTip) ? Math.max(0, driverTip) : 0;
  return Math.max(DELIVERY_TIP_DISCOUNT_FLOOR, baseFee - tip);
}

function matchesKeyword(haystackLower, keyword) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystackLower);
}

export async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&countrycodes=us&addressdetails=1&limit=1`;
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Chefaleh-Delivery/1.0 (orders@chefaleh.com)' } });
  } catch (e) {
    throw new Error('geocoding_unavailable');
  }
  if (!res.ok) throw new Error('geocoding_unavailable');
  const data = await res.json();
  if (!data.length) return null;
  const item = data[0];
  const addr = item.address || {};
  const lat = parseFloat(item.lat);
  const lon = parseFloat(item.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return {
    lat,
    lon,
    city: (addr.city || addr.town || addr.suburb || addr.neighbourhood || addr.village || '').toLowerCase(),
    displayName: item.display_name || '',
  };
}

export async function drivingDistanceMiles(lat, lon) {
  const url = `https://router.project-osrm.org/route/v1/driving/${ORIGIN.lon},${ORIGIN.lat};${lon},${lat}?overview=false`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    throw new Error('routing_unavailable');
  }
  if (!res.ok) throw new Error('routing_unavailable');
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error('routing_unavailable');
  return data.routes[0].distance / 1609.34;
}

// Returns one of:
//   { ok: true, zoneNum, distanceMiles, geo }
//   { ok: false, reason: 'not_found' | 'geocoding_unavailable' | 'routing_unavailable' | 'outside_area', distanceMiles?, geo? }
export async function classifyAddress(address) {
  let geo;
  try {
    geo = await geocodeAddress(address);
  } catch (e) {
    return { ok: false, reason: 'geocoding_unavailable' };
  }
  if (!geo) return { ok: false, reason: 'not_found' };

  const hay = `${geo.city} ${geo.displayName}`.toLowerCase();

  // 1. Zone 1 — free delivery core area.
  if (ZONE1_CITY_KEYWORDS.some(k => matchesKeyword(hay, k))) {
    return { ok: true, zoneNum: 1, distanceMiles: null, geo };
  }
  if (geo.city === 'miami beach' && geo.lat >= MIAMI_BEACH_38TH_ST_LAT) {
    return { ok: true, zoneNum: 1, distanceMiles: null, geo };
  }

  // 2. Zone 5 — distant delivery (named area, not distance-gated).
  if (ZONE5_CITY_KEYWORDS.some(k => matchesKeyword(hay, k))) {
    const distanceMiles = await drivingDistanceMiles(geo.lat, geo.lon).catch(() => null);
    return { ok: true, zoneNum: 5, distanceMiles, geo };
  }

  // 3. Zone 4 — North Broward (named area, not distance-gated).
  if (ZONE4_CITY_KEYWORDS.some(k => matchesKeyword(hay, k))) {
    const distanceMiles = await drivingDistanceMiles(geo.lat, geo.lon).catch(() => null);
    return { ok: true, zoneNum: 4, distanceMiles, geo };
  }

  // 4/5/6. Everything else is decided by real driving distance.
  let distanceMiles;
  try {
    distanceMiles = await drivingDistanceMiles(geo.lat, geo.lon);
  } catch (e) {
    return { ok: false, reason: 'routing_unavailable', geo };
  }

  if (distanceMiles > MAX_SUPPORTED_DISTANCE_MILES) {
    return { ok: false, reason: 'outside_area', distanceMiles, geo };
  }
  if (distanceMiles <= ZONE2_MAX_MILES) {
    return { ok: true, zoneNum: 2, distanceMiles, geo };
  }
  return { ok: true, zoneNum: 3, distanceMiles, geo };
}

export async function getZoneFees() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/delivery_zones?select=zone_num,label,fee&order=zone_num.asc`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!res.ok) throw new Error('Could not load delivery zone pricing');
  const rows = await res.json();
  const byZone = {};
  rows.forEach(r => { byZone[r.zone_num] = { label: r.label, fee: Number(r.fee) }; });
  return byZone;
}
