import os

import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")

SYSTEM_PROMPT = """You are RouteMate, an AI assistant inside a navigation web app.
Be concise, helpful, and safety-conscious. Answer route and navigation questions using the supplied journey context. Explain that route distances and durations must come from the routing service, not your own guesses.
Do not claim to know live traffic, road closures, business hours, or charging-station availability unless verified data is provided.
You cannot directly change the map. Tell the user to use the route controls for route changes.
You can help interpret the current journey context supplied by the application."""

async def chat_with_ollama(message, context):
    context_text = str(context)[:5000]
    payload = {
        "model": MODEL,
        "stream": False,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT + "\nCurrent journey context (may be empty): " + context_text},
            {"role": "user", "content": message}
        ],
        "options": {"temperature": 0.3}
    }
    async with httpx.AsyncClient(timeout=90) as client:
        response = await client.post(f"{BASE_URL}/api/chat", json=payload)
        response.raise_for_status()
        data = response.json()
    return data.get("message", {}).get("content", "I could not generate a response.")
