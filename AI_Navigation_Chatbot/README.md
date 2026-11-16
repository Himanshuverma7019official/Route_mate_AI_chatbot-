# RouteMate AI — Ollama Navigation Chatbot

A local-first portfolio project using Ollama, FastAPI, SQLite, Leaflet, OpenStreetMap data, OSRM routing, and Overpass nearby-place search.

## Features in this MVP

- Local Ollama chat (`qwen2.5:3b` by default)
- No sign-in required in the current demo; backend email/password endpoints remain available
- Route planning with up to 8 intermediate stops
- Alternative driving routes when returned by OSRM
- Turn-by-turn steps and map route geometry
- Nearby restaurants, petrol stations, hospitals, pharmacies, ATMs, EV chargers, parking, and hotels
- Browser speech input (browser-dependent) and speech synthesis
- Natural-language route requests in chat (for example, “take me from A to B”) automatically populate and calculate the route
- Mapped bus stops along the selected route corridor, plus automatic destination nearby-place and EV estimate refreshes
- Saved journeys in SQLite (shared demo collection while sign-in is disabled)
- EV energy and cost estimates

## Requirements

- Windows 10/11
- Python 3.10+
- Ollama installed and running
- A model already pulled, e.g. `ollama pull qwen2.5:3b`
- Internet access for the public map, geocoding, routing, and nearby-place endpoints

## Run on Windows PowerShell

From the project folder:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item ..\.env.example ..\.env
```

Open another terminal and verify Ollama:

```powershell
ollama list
ollama run llama2
```

Keep Ollama running, then from the `backend` folder start the server:

```powershell
uvicorn main:app --reload
```

Open `http://127.0.0.1:8000`. API docs: `http://127.0.0.1:8000/docs`.

If PowerShell blocks activation, run this for the current terminal only:
`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

To store Ollama models in `D:\OllamaModels`, configure Ollama before pulling the model:

```powershell
[Environment]::SetEnvironmentVariable("OLLAMA_MODELS", "D:\OllamaModels", "User")
```

Restart Ollama after changing this setting, then run `ollama pull qwen2.5:3b`. The app reads `OLLAMA_MODEL` from `.env`; use a different model there if needed.

## Service and data notes

| Capability | Provider | API key | Reality |
|---|---|---:|---|
| Local AI chat | Ollama local API | No cloud key | Runs on your PC; response speed depends on model and hardware |
| Map display | Leaflet + OSM raster tiles | No key for basic prototype | OSM tile service has usage policies; always show attribution |
| Geocoding | Public Nominatim endpoint | No key | Low-volume user-triggered requests only; not autocomplete or bulk geocoding |
| Driving route and alternatives | Public OSRM demo | No key | Best-effort demo, no SLA; do not rely on it for production |
| Nearby places | Overpass API | No key | Open map data; coverage and service availability vary |
| Voice input | Browser Web Speech API | Usually no app key | Recognition support and privacy behavior depend on browser/platform |
| Voice output | Browser speech synthesis | No key | Uses available local/browser voices |
| Accounts / saved trips | SQLite | No key | The current UI uses a shared demo user and shared journeys; backend session tokens are in-memory |
| EV estimate | Local formula | No key | Estimate only; assumes user-entered efficiency and electricity rate |
| Live traffic | Not connected | No key | Duration is a routing estimate, not a live-traffic ETA |

Please review the current policies before publishing or scaling:
- OSM tiles: https://operations.osmfoundation.org/policies/tiles/
- Nominatim: https://operations.osmfoundation.org/policies/nominatim/
- OSRM: https://project-osrm.org/docs/

Do not use the public OSM tile server for offline tile downloads or bulk prefetching. Public Nominatim is rate-limited (maximum 1 request/second) and does not support autocomplete. Public OSRM and Overpass are best-effort community services. For a deployed or commercial app, choose providers with suitable terms, quotas, reliability, and support or self-host the services.

## Security and production TODOs

This is a learning MVP, not production authentication. Current bearer tokens are in-memory and reset when the server restarts. Before deployment:
- The no-sign-in demo shares saved journeys across users; do not use it for private trip data.
- Replace in-memory tokens with secure signed sessions / OAuth2 or a maintained auth solution.
- Add rate limiting, email verification, password reset, CSRF protections if using cookies, HTTPS, and audit logging.
- Add server-side request limits, API quotas, caching, retries/backoff, and provider failover.
- Do not expose Ollama's port publicly.
- Keep secrets in environment variables and never commit `.env`.
- Add privacy notice and account deletion/export.
- Add automated tests and deployment monitoring.

## Current limitations

- Driving routes only in this build.
- OSRM route duration is not live traffic-aware.
- Alternatives may not be returned, and public demo availability can change.
- Nearby places are based on OpenStreetMap tags and may be incomplete.
- EV cost does not include charging losses, station-specific pricing, tolls, or vehicle/battery telemetry.
- Browser speech recognition is not supported in every browser.
- Chat route detection currently supports explicit “from … to …” or “between … and …” phrasing. More advanced intent extraction and provider-backed Google Maps integration remain future work.

## Suggested next stages

1. Add structured chatbot intents and explicit tools to trigger route/nearby/EV APIs.
2. Add a traffic provider and clearly label traffic timestamps.
3. Add provider abstraction and caching for geocoding/routing/POI data.
4. Add walking/cycling using a compatible routing engine.
5. Improve auth, tests, accessibility, and deployment.
