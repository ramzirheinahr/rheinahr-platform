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

export function extractGermanZip(address: string | null): string | null {
  if (!address) return null;
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

export function estimateGermanDistanceKm(originAddress: string | null, destAddress: string | null): number {
  const originZip = extractGermanZip(originAddress);
  const destZip = extractGermanZip(destAddress);

  if (!originZip || !destZip) return 25.0;
  if (originZip === destZip) return 5.0;

  const originPrefix2 = originZip.slice(0, 2);
  const destPrefix2 = destZip.slice(0, 2);
  if (originPrefix2 === destPrefix2) {
    const diff = Math.abs(parseInt(originZip, 10) - parseInt(destZip, 10));
    return Math.round(Math.min(35, Math.max(10, 15 + diff * 0.02)) * 10) / 10;
  }

  const originPrefix1 = originZip.slice(0, 1);
  const destPrefix1 = destZip.slice(0, 1);
  if (originPrefix1 === destPrefix1) {
    return 35.0;
  }

  const diffDigit = Math.abs(parseInt(originPrefix1, 10) - parseInt(destPrefix1, 10));
  return 55.0 + diffDigit * 35;
}

/**
 * Calculates driving distance in kilometers between two addresses using OSRM.
 */
export async function getDrivingDistanceKm(
  originAddress: string | null,
  destAddress: string | null,
  options?: { fast?: boolean }
): Promise<number | null> {
  if (!originAddress || !destAddress) return null;
  
  const cacheKey = `${originAddress.trim().toLowerCase()}|${destAddress.trim().toLowerCase()}`;
  if (distanceCache.has(cacheKey)) {
    const cached = distanceCache.get(cacheKey);
    return cached ?? estimateGermanDistanceKm(originAddress, destAddress);
  }

  if (options?.fast) {
    return estimateGermanDistanceKm(originAddress, destAddress);
  }

  if (inFlightDistance.has(cacheKey)) return inFlightDistance.get(cacheKey)!;

  const promise = (async () => {
    const origin = await geocode(originAddress);
    const dest = await geocode(destAddress);

    if (!origin || !dest) {
      distanceCache.set(cacheKey, null);
      return estimateGermanDistanceKm(originAddress, destAddress);
    }

    try {
      // OSRM expects coordinates in lon,lat order
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${dest.lon},${dest.lat}?overview=false`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("OSRM error");

      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        // Distance is in meters, convert to km
        const distanceKm = Math.round((data.routes[0].distance / 1000) * 100) / 100;
        distanceCache.set(cacheKey, distanceKm);
        return distanceKm;
      }
      
      distanceCache.set(cacheKey, null);
      return estimateGermanDistanceKm(originAddress, destAddress);
    } catch (error) {
      console.error("Distance calculation failed", error);
      return estimateGermanDistanceKm(originAddress, destAddress);
    }
  })();

  inFlightDistance.set(cacheKey, promise);
  const result = await promise;
  inFlightDistance.delete(cacheKey);
  return result;
}
