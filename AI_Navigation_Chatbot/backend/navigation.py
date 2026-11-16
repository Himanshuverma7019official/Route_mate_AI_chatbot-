import asyncio
import math
import httpx

NOMINATIM = "https://nominatim.openstreetmap.org/search"
OSRM = "https://router.project-osrm.org/route/v1/driving"
OSRM_FALLBACK = "https://routing.openstreetmap.de/routed-car/route/v1/driving"
OVERPASS = "https://overpass-api.de/api/interpreter"
OVERPASS_FALLBACK = "https://overpass.private.coffee/api/interpreter"
OVERPASS_FALLBACK_2 = "https://overpass.kumi.systems/api/interpreter"
HEADERS = {"User-Agent": "OllamaAINavigationPortfolio/1.0 (personal learning project)"}

async def geocode(query: str):
    query = query.strip()
    if not query:
        raise ValueError("Enter a location.")
    async with httpx.AsyncClient(timeout=15, headers=HEADERS) as client:
        response = await client.get(NOMINATIM, params={"q": query, "format": "jsonv2", "limit": 1})
        response.raise_for_status()
        data = response.json()
    if not data:
        raise ValueError(f"Could not find location: {query}")
    item = data[0]
    return {"name": item.get("display_name", query), "lat": float(item["lat"]), "lon": float(item["lon"])}

async def calculate_route(source, destination, stops, alternatives=True):
    locations = [source] + list(stops) + [destination]
    coordinates = ";".join(f'{p["lon"]},{p["lat"]}' for p in locations)
    params = {
        "overview": "full", "geometries": "geojson", "steps": "true",
        "alternatives": "true" if alternatives and not stops else "false",
        "annotations": "false"
    }
    data = None
    async with httpx.AsyncClient(timeout=25, headers=HEADERS) as client:
        for endpoint in (OSRM, OSRM_FALLBACK):
            try:
                response = await client.get(f"{endpoint}/{coordinates}", params=params)
                response.raise_for_status()
                data = response.json()
                break
            except (httpx.HTTPError, ValueError):
                continue
    if data is None:
        raise httpx.HTTPError("All free routing servers are unavailable.")
    if data.get("code") != "Ok" or not data.get("routes"):
        raise ValueError("No driving route found between these locations.")
    routes = []
    for route in data["routes"]:
        legs = []
        for leg in route.get("legs", []):
            steps = []
            for step in leg.get("steps", []):
                steps.append({
                    "instruction": step.get("maneuver", {}).get("type", "Continue").replace("_", " ").title(),
                    "modifier": step.get("maneuver", {}).get("modifier", ""),
                    "road": step.get("name") or "Unnamed road",
                    "distance_m": round(step.get("distance", 0)),
                    "duration_s": round(step.get("duration", 0))
                })
            legs.append({"distance_m": round(leg.get("distance", 0)), "duration_s": round(leg.get("duration", 0)), "steps": steps})
        routes.append({
            "distance_m": round(route["distance"]),
            "duration_s": round(route["duration"]),
            "geometry": route["geometry"],
            "legs": legs
        })
    return {"routes": routes, "provider": "OSRM public demo", "alternatives_available": len(routes) > 1}

def route_summary(result):
    route = result["routes"][0]
    return {
        "distance_km": round(route["distance_m"] / 1000, 1),
        "duration_min": round(route["duration_s"] / 60),
        "stop_count": len(result.get("stops", [])),
        "route_count": len(result["routes"])
    }

async def nearby_places(lat, lon, category="restaurant", radius_m=1500):
    tags = {
        "restaurant": 'nwr["amenity"~"restaurant|cafe|fast_food|food_court|ice_cream|bakery"]',
        "petrol": 'nwr["amenity"="fuel"]',
        "hospital": 'nwr["amenity"="hospital"]',
        "pharmacy": 'nwr["amenity"="pharmacy"]',
        "atm": 'nwr["amenity"="atm"]',
        "charging": 'nwr["amenity"="charging_station"]',
        "parking": 'nwr["amenity"="parking"]',
        "hotel": 'nwr["tourism"="hotel"]'
    }
    if category not in tags:
        category = "restaurant"
    if category == "restaurant":
        amenity_filter = '["amenity"~"cafe|restaurant|fast_food|food_court|ice_cream|bakery"]'
        shop_filter = '["shop"~"bakery|ice_cream"]'
        query = f'[out:json][timeout:15];(node{amenity_filter}(around:{radius_m},{lat},{lon});way{amenity_filter}(around:{radius_m},{lat},{lon});node{shop_filter}(around:{radius_m},{lat},{lon});way{shop_filter}(around:{radius_m},{lat},{lon}););out center tags;'
    else:
        query = f'[out:json][timeout:15];({tags[category]}(around:{radius_m},{lat},{lon}););out center tags;'
    data = None
    async with httpx.AsyncClient(timeout=20, headers=HEADERS) as client:
        for endpoint in (OVERPASS, OVERPASS_FALLBACK, OVERPASS_FALLBACK_2):
            for method in ("post", "get"):
                try:
                    if method == "post":
                        response = await client.post(endpoint, data={"data": query})
                    else:
                        response = await client.get(endpoint, params={"data": query})
                    response.raise_for_status()
                    data = response.json()
                    break
                except (httpx.HTTPError, ValueError):
                    continue
            if data is not None:
                break
    if data is None:
        return await _nominatim_nearby_places(lat, lon, category, radius_m)
    places = []
    for el in data.get("elements", []):
        tags_data = el.get("tags", {})
        place_type = tags_data.get("amenity") or tags_data.get("shop", category)
        display_category = {
            "cafe": "Café",
            "fast_food": "Fast food",
            "restaurant": "Restaurant",
            "food_court": "Food court",
            "ice_cream": "Ice cream",
            "bakery": "Bakery",
        }.get(place_type, category.title())
        name = tags_data.get("name", display_category)
        places.append({
            "id": el.get("id"),
            "name": name,
            "lat": el.get("lat", el.get("center", {}).get("lat")),
            "lon": el.get("lon", el.get("center", {}).get("lon")),
            "category": display_category,
            "address": tags_data.get("addr:street", "")
        })
    return places[:30]

async def _nominatim_nearby_places(lat, lon, category, radius_m):
    """Fallback food lookup when public Overpass mirrors are unavailable."""
    if category != "restaurant":
        raise httpx.HTTPError("All Overpass nearby-place servers are unavailable.")
    terms = ("cafe", "restaurant", "fast food", "bakery", "ice cream")
    lat_delta = radius_m / 111_000
    lon_delta = radius_m / max(111_000 * math.cos(math.radians(lat)), 1)
    viewbox = f"{lon - lon_delta},{lat + lat_delta},{lon + lon_delta},{lat - lat_delta}"
    places, seen = [], set()
    async with httpx.AsyncClient(timeout=15, headers=HEADERS) as client:
        for index, term in enumerate(terms):
            if index:
                await asyncio.sleep(1.05)
            try:
                response = await client.get(NOMINATIM, params={
                    "q": term,
                    "format": "jsonv2",
                    "limit": 10,
                    "bounded": 1,
                    "viewbox": viewbox,
                })
                response.raise_for_status()
                results = response.json()
            except (httpx.HTTPError, ValueError):
                continue
            for item in results:
                place_id = item.get("place_id")
                if place_id in seen:
                    continue
                seen.add(place_id)
                places.append({
                    "id": place_id,
                    "name": item.get("name") or item.get("display_name", term.title()).split(",")[0],
                    "lat": float(item["lat"]),
                    "lon": float(item["lon"]),
                    "category": term.title(),
                    "address": item.get("display_name", ""),
                })
    if not places:
        raise httpx.HTTPError("Nearby food services are temporarily unavailable.")
    return places[:30]

async def route_stops(geometry, radius_m=500, limit=40):
    """Find mapped public-transport stops in a corridor around a route.

    OSM represents stops as both nodes (``highway=bus_stop`` and
    ``public_transport=stop_position``) and platform ways.  Querying only
    nodes misses a substantial part of the available stop data.
    """
    coordinates = geometry.get("coordinates", []) if isinstance(geometry, dict) else []
    if not coordinates:
        return []
    stride = max(1, len(coordinates) // 18)
    sampled = coordinates[::stride]
    if coordinates[-1] != sampled[-1]:
        sampled.append(coordinates[-1])
    clauses = []
    for lon, lat in sampled:
        area = f'(around:{radius_m},{lat},{lon})'
        clauses.append(f'nwr["highway"="bus_stop"]{area};')
        clauses.append(f'nwr["public_transport"="platform"]{area};')
        clauses.append(f'nwr["public_transport"="stop_position"]{area};')
        clauses.append(f'nwr["amenity"="bus_station"]{area};')
    query = f'[out:json][timeout:20];({"".join(clauses)});out center {limit};'
    data = None
    async with httpx.AsyncClient(timeout=10, headers=HEADERS) as client:
        for endpoint in (OVERPASS, OVERPASS_FALLBACK):
            try:
                response = await client.post(endpoint, data={"data": query})
                response.raise_for_status()
                data = response.json()
                break
            except httpx.HTTPError:
                continue
    if data is None:
        return []
    seen, stops = set(), []
    for el in data.get("elements", []):
        center = el.get("center", {})
        lat = el.get("lat", center.get("lat"))
        lon = el.get("lon", center.get("lon"))
        if lat is None or lon is None or el.get("id") in seen:
            continue
        seen.add(el.get("id"))
        tags_data = el.get("tags", {})
        stops.append({
            "id": el.get("id"),
            "name": tags_data.get("name") or tags_data.get("local_ref") or "Bus stop",
            "lat": lat,
            "lon": lon,
            "category": "bus stop",
        })
    return stops[:limit]

def estimate_ev_cost(distance_km, efficiency_kwh_100km=18, price_per_kwh=8):
    energy = distance_km * efficiency_kwh_100km / 100
    return {
        "distance_km": round(distance_km, 1),
        "estimated_energy_kwh": round(energy, 2),
        "estimated_cost": round(energy * price_per_kwh, 2),
        "currency": "INR",
        "assumptions": f"{efficiency_kwh_100km} kWh/100 km and ₹{price_per_kwh}/kWh; excludes charging losses and route/vehicle variation."
    }
