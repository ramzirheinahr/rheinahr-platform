import "server-only";

const geocodeCache = new Map<string, { lat: number; lon: number } | null>();
const distanceCache = new Map<string, number | null>();

const inFlightGeocode = new Map<string, Promise<{ lat: number; lon: number } | null>>();
let lastGeocodeTime = 0;
let geocodeQueue = Promise.resolve();

/**
 * Geocodes an address string to coordinates using OpenStreetMap Nominatim API.
 * Rate limited to ~1 request per second, results are cached in-memory.
 */
async function geocode(address: string): Promise<{ lat: number; lon: number } | null> {
  const normalized = address.trim().toLowerCase();
  if (!normalized) return null;
  if (geocodeCache.has(normalized)) return geocodeCache.get(normalized)!;
  if (inFlightGeocode.has(normalized)) return inFlightGeocode.get(normalized)!;

  const promise = new Promise<{ lat: number; lon: number } | null>((resolve) => {
    geocodeQueue = geocodeQueue.then(async () => {
      // Re-check cache in case another request filled it while we waited
      if (geocodeCache.has(normalized)) {
        resolve(geocodeCache.get(normalized)!);
        return;
      }
      
      let retryCount = 0;
      let success = false;
      while (retryCount < 3 && !success) {
        try {
          const now = Date.now();
          const elapsed = now - lastGeocodeTime;
          if (elapsed < 1100) {
            await new Promise(r => setTimeout(r, 1100 - elapsed));
          }
          lastGeocodeTime = Date.now();

          const params = new URLSearchParams({ q: address, format: "json", limit: "1" });
          const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
            headers: { "User-Agent": "RheinAhr-App/1.0 (contact@rheinahr.de)" },
          });
          
          if (res.status === 429 || res.status === 403) {
            // Rate limited, backoff and retry
            retryCount++;
            await new Promise(r => setTimeout(r, 1000 * retryCount));
            continue;
          }
          if (!res.ok) throw new Error(`Nominatim HTTP error: ${res.status}`);
          
          const data = await res.json();
          if (data && data.length > 0) {
            const result = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
            geocodeCache.set(normalized, result);
            resolve(result);
            success = true;
            return;
          }
          geocodeCache.set(normalized, null);
          resolve(null);
          success = true;
        } catch (error) {
          if (retryCount >= 2) {
            console.error("Geocoding failed for", address, error);
            resolve(null);
            success = true;
          } else {
            retryCount++;
            await new Promise(r => setTimeout(r, 1000 * retryCount));
          }
        }
      }
    });
  });

  inFlightGeocode.set(normalized, promise);
  const result = await promise;
  inFlightGeocode.delete(normalized);
  return result;
}

const inFlightDistance = new Map<string, Promise<number | null>>();

/**
 * Calculates driving distance in kilometers between two addresses using OSRM.
 */
export async function getDrivingDistanceKm(originAddress: string | null, destAddress: string | null): Promise<number | null> {
  if (!originAddress || !destAddress) return null;
  
  const cacheKey = `${originAddress.trim().toLowerCase()}|${destAddress.trim().toLowerCase()}`;
  if (distanceCache.has(cacheKey)) return distanceCache.get(cacheKey)!;
  if (inFlightDistance.has(cacheKey)) return inFlightDistance.get(cacheKey)!;

  const promise = (async () => {
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
  })();

  inFlightDistance.set(cacheKey, promise);
  const result = await promise;
  inFlightDistance.delete(cacheKey);
  return result;
}
