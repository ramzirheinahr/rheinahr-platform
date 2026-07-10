import "server-only";

const geocodeCache = new Map<string, { lat: number; lon: number } | null>();
const distanceCache = new Map<string, number | null>();

/**
 * Geocodes an address string to coordinates using OpenStreetMap Nominatim API.
 * Rate limited to ~1 request per second, results are cached in-memory.
 */
async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return null;
  if (geocodeCache.has(normalized)) return geocodeCache.get(normalized)!;

  try {
    const params = new URLSearchParams({ q: address, format: "json", limit: "1" });
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { "User-Agent": "RheinAhr-App/1.0" },
    });
    if (!res.ok) throw new Error("Nominatim error");
    
    const data = await res.json();
    if (data && data.length > 0) {
      const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      geocodeCache.set(normalized, result);
      return result;
    }
    geocodeCache.set(normalized, null);
    return null;
  } catch (error) {
    console.error("Geocoding failed for", address, error);
    return null;
  }
}

/**
 * Calculates driving distance in kilometers between two addresses using OSRM.
 */
export async function getDrivingDistanceKm(originAddress: string | null, destAddress: string | null): Promise<number | null> {
  if (!originAddress || !destAddress) return null;
  
  const cacheKey = `${originAddress.trim().toLowerCase()}|${destAddress.trim().toLowerCase()}`;
  if (distanceCache.has(cacheKey)) return distanceCache.get(cacheKey)!;

  const origin = await geocode(originAddress);
  const dest = await geocode(destAddress);

  if (!origin || !dest) {
    distanceCache.set(cacheKey, null);
    return null;
  }

  try {
    // OSRM expects coordinates in lon,lat order
    const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("OSRM error");

    const data = await res.json();
    if (data.routes && data.routes.length > 0) {
      // Distance is in meters, convert to km
      const distanceKm = data.routes[0].distance / 1000;
      distanceCache.set(cacheKey, distanceKm);
      return distanceKm;
    }
    
    distanceCache.set(cacheKey, null);
    return null;
  } catch (error) {
    console.error("Distance calculation failed", error);
    return null;
  }
}
