import asyncio
import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import Optional
import httpx

from auth import init_db, register_user, login_user, get_user_from_token, save_trip, list_trips, get_or_create_demo_user
from navigation import geocode, calculate_route, nearby_places, route_stops, route_summary, estimate_ev_cost
from ollama_client import chat_with_ollama

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield

app = FastAPI(title="Ollama AI Navigation Chatbot", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:8000", "http://localhost:8000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"]
)

class AuthInput(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)

class RouteInput(BaseModel):
    source: str
    destination: str
    stops: list[str] = []
    alternatives: bool = True
    travel_mode: str = "driving"
    route_preference: str = "fastest"

class NearbyInput(BaseModel):
    lat: float
    lon: float
    category: str = "restaurant"
    radius_m: int = Field(default=1500, ge=100, le=5000)

class RouteStopsInput(BaseModel):
    geometry: dict
    radius_m: int = Field(default=500, ge=100, le=1000)

class ChatInput(BaseModel):
    message: str
    context: Optional[dict] = None

class TripInput(BaseModel):
    title: str
    source: str
    destination: str
    stops: list[str] = []

async def current_user(authorization: Optional[str] = Header(default=None)):
    if authorization and authorization.lower().startswith("bearer "):
        user = get_user_from_token(authorization.split(" ", 1)[1])
        if user:
            return user
    return get_or_create_demo_user()

@app.get("/api/health")
async def health():
    if os.getenv("GEMINI_API_KEY"):
        return {"status": "ok", "ai": "configured", "provider": "gemini", "model": os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")}

    model = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
    try:
        async with httpx.AsyncClient(timeout=2.5) as client:
            response = await client.get(os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434") + "/api/tags")
            response.raise_for_status()
        ollama_status = "connected"
    except Exception:
        ollama_status = "unavailable"
    return {"status": "ok", "ai": ollama_status, "provider": "ollama", "model": model}

@app.post("/api/auth/register")
async def register(data: AuthInput):
    try:
        return register_user(data.email, data.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

@app.post("/api/auth/login")
async def login(data: AuthInput):
    try:
        return login_user(data.email, data.password)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))

@app.get("/api/me")
async def me(user=Depends(current_user)):
    return {"email": user["email"]}

@app.post("/api/route")
async def route(data: RouteInput, user=Depends(current_user)):
    if data.travel_mode != "driving":
        raise HTTPException(status_code=400, detail="This MVP supports driving routes. Walking/cycling needs a compatible routing backend.")
    if len(data.stops) > 8:
        raise HTTPException(status_code=400, detail="Please use 8 or fewer intermediate stops.")
    if data.route_preference not in {"fastest", "shortest", "eco"}:
        raise HTTPException(status_code=400, detail="Route preference must be fastest, shortest, or eco.")
    try:
        locations = [data.source, data.destination, *data.stops]
        geocoded = []
        for index, location in enumerate(locations):
            if index:
                await asyncio.sleep(1.1)
            geocoded.append(await geocode(location))
        source, destination = geocoded[:2]
        stop_coords = geocoded[2:]
        result = await calculate_route(source, destination, stop_coords, data.alternatives)
        result["routes"].sort(key=lambda route: route["distance_m"] if data.route_preference in {"shortest", "eco"} else route["duration_s"])
        result["route_preference"] = data.route_preference
        result["source"] = source
        result["destination"] = destination
        result["stops"] = stop_coords
        result["summary"] = route_summary(result)
        result["traffic"] = {
            "status": "not_available",
            "message": "Live traffic is not connected. Duration is a routing estimate, not a live-traffic ETA."
        }
        return result
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="A map/routing service is temporarily unavailable. Please retry.")

@app.post("/api/nearby")
async def nearby(data: NearbyInput, user=Depends(current_user)):
    try:
        return {"places": await nearby_places(data.lat, data.lon, data.category, data.radius_m)}
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Nearby-place service is temporarily unavailable.")

@app.post("/api/route-stops")
async def get_route_stops(data: RouteStopsInput, user=Depends(current_user)):
    try:
        return {"stops": await route_stops(data.geometry, data.radius_m)}
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Route-stop service is temporarily unavailable.")

@app.post("/api/ev-estimate")
async def ev_estimate(
    distance_km: float = Query(..., ge=0, le=5000),
    efficiency_kwh_100km: float = Query(18.0),
    price_per_kwh: float = Query(8.0),
    user=Depends(current_user),
):
    if efficiency_kwh_100km <= 0 or price_per_kwh < 0:
        raise HTTPException(status_code=400, detail="Efficiency must be positive and electricity price cannot be negative.")
    return estimate_ev_cost(distance_km, efficiency_kwh_100km, price_per_kwh)

@app.post("/api/chat")
async def chat(data: ChatInput, user=Depends(current_user)):
    if len(data.message) > 3000:
        raise HTTPException(status_code=400, detail="Message is too long (maximum 3000 characters).")
    try:
        answer = await chat_with_ollama(data.message, data.context or {})
        model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite") if os.getenv("GEMINI_API_KEY") else os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
        return {"reply": answer, "model": model}
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Ollama is not responding. Start Ollama and check your model.")
    except Exception:
        raise HTTPException(status_code=500, detail="The chatbot could not complete this request.")

@app.post("/api/trips")
async def create_trip(data: TripInput, user=Depends(current_user)):
    return save_trip(user["id"], data.title, data.source, data.destination, data.stops)

@app.get("/api/trips")
async def get_trips(user=Depends(current_user)):
    return {"trips": list_trips(user["id"])}

@app.get("/")
async def index():
    return FileResponse(os.path.join(os.path.dirname(__file__), "..", "frontend", "index.html"))

app.mount("/static", StaticFiles(directory=os.path.join(os.path.dirname(__file__), "..", "frontend")), name="static")
