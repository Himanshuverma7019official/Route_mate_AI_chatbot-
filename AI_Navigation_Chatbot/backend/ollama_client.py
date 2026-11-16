import os

import httpx
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:3b")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

SYSTEM_PROMPT = """You are RouteMate, an AI assistant inside a navigation web app.
Be concise, helpful, and safety-conscious. Answer route and navigation questions using the supplied journey context. Explain that route distances and durations must come from the routing service, not your own guesses.
Do not claim to know live traffic, road closures, business hours, or charging-station availability unless verified data is provided.
You cannot directly change the map. Tell the user to use the route controls for route changes.
You can help interpret the current journey context supplied by the application."""

async def chat_with_ollama(message, context):
    context_text = str(context)[:5000]
    if GEMINI_API_KEY:
        payload = {
            "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [{"role": "user", "parts": [{"text":
                f"Current journey context (may be empty): {context_text}\nUser message: {message}"
            }]}],
            "generationConfig": {"temperature": 0.3},
        }
        async with httpx.AsyncClient(timeout=90) as client:
            response = await client.post(
                GEMINI_URL.format(model=GEMINI_MODEL),
                headers={"x-goog-api-key": GEMINI_API_KEY},
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
        return data["candidates"][0]["content"]["parts"][0]["text"]

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
