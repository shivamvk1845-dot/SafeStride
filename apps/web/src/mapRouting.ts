export type Coordinates = [latitude: number, longitude: number];

export interface ReplaceableLayerGroup<TLayer> {
  clearLayers(): unknown;
  addLayer(layer: TLayer): unknown;
}

let nextGeocodingRequestAt = 0;

function waitForGeocodingTurn(signal: AbortSignal): Promise<void> {
  const requestAt = Math.max(Date.now(), nextGeocodingRequestAt);
  nextGeocodingRequestAt = requestAt + 1100;
  const delay = requestAt - Date.now();
  if (delay <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delay);
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException("Address lookup was cancelled.", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function geocodeAddress(address: string, signal: AbortSignal): Promise<Coordinates> {
  await waitForGeocodingTurn(signal);
  if (signal.aborted) throw new DOMException("Address lookup was cancelled.", "AbortError");

  const query = new URLSearchParams({ format: "jsonv2", limit: "1", q: address.trim() });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Address lookup is temporarily unavailable. Please try again.");

  const result: unknown = await response.json();
  if (!Array.isArray(result) || result.length === 0 || typeof result[0] !== "object" || result[0] === null) {
    throw new Error(`Could not find the address “${address}”. Check it and try again.`);
  }

  const place = result[0] as Record<string, unknown>;
  const latitude = Number(place.lat);
  const longitude = Number(place.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error(`Could not find the address “${address}”. Check it and try again.`);
  }
  return [latitude, longitude];
}

export async function getRouteCoordinates(
  origin: Coordinates,
  destination: Coordinates,
  mode: "cab" | "walk" | "bus",
  signal: AbortSignal,
): Promise<Coordinates[]> {
  const profile = mode === "walk" ? "foot" : "car";
  const host = profile === "foot"
    ? "https://routing.openstreetmap.de/routed-foot"
    : "https://routing.openstreetmap.de/routed-car";
  const waypoints = `${origin[1]},${origin[0]};${destination[1]},${destination[0]}`;
  const response = await fetch(`${host}/route/v1/driving/${waypoints}?overview=full&geometries=geojson&steps=false`, { signal });
  if (!response.ok) throw new Error("Route calculation is temporarily unavailable. Please try again.");

  const result: unknown = await response.json();
  if (typeof result !== "object" || result === null) throw new Error("No route was returned for these addresses.");
  const routes = (result as Record<string, unknown>).routes;
  if (!Array.isArray(routes) || routes.length === 0 || typeof routes[0] !== "object" || routes[0] === null) {
    throw new Error("No route was found between these addresses.");
  }

  const geometry = (routes[0] as Record<string, unknown>).geometry;
  const coordinates = typeof geometry === "object" && geometry !== null
    ? (geometry as Record<string, unknown>).coordinates
    : undefined;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    throw new Error("No route geometry was returned for these addresses.");
  }

  return coordinates.map((point: unknown) => {
    if (!Array.isArray(point) || point.length < 2) throw new Error("The route service returned invalid coordinates.");
    const [longitude, latitude] = point.map(Number);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error("The route service returned invalid coordinates.");
    }
    return [latitude, longitude];
  });
}

export function replaceMapLayers<TLayer>(group: ReplaceableLayerGroup<TLayer>, layers: readonly TLayer[]): void {
  group.clearLayers();
  for (const layer of layers) group.addLayer(layer);
}
