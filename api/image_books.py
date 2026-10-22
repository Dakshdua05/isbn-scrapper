"""Extract book titles and authors from an uploaded photo with Gemini."""

import json
import os
import re
import time
from http.server import BaseHTTPRequestHandler

import requests


GEMINI_MODELS = ("gemini-3.8-flash", "gemini-3.5-flash-lite")
MAX_IMAGE_DATA_LENGTH = 5_500_000
PROMPT = """Inspect this image for books. Return only a JSON object with a 'books' array.
Each item must have exactly 'title' and 'author' strings. Include one item for each unique
book title you can read. Omit quantities, publishers, prices, years, URLs, and duplicate
copies. Use an empty author string only if the author is not visible or cannot be confidently
identified. Do not invent titles or authors."""


def clean_books(value):
    if not isinstance(value, list):
        return []
    books, seen = [], set()
    for item in value:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title", "")).strip()
        author = str(item.get("author", "")).strip()
        key = re.sub(r"[^a-z0-9]+", " ", f"{title} {author}".lower()).strip()
        if title and key not in seen:
            seen.add(key)
            books.append({"title": title, "author": author})
    return books


class handler(BaseHTTPRequestHandler):
    def send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("API_key")
        if not api_key:
            self.send_json(503, {"message": "Image analysis is not configured. Add GEMINI_API_KEY in Vercel."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            image_data = payload.get("image_data", "")
            mime_type = payload.get("mime_type", "image/jpeg")
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self.send_json(400, {"message": "Send a valid image request."})
            return
        if not isinstance(image_data, str) or not image_data or len(image_data) > MAX_IMAGE_DATA_LENGTH:
            self.send_json(400, {"message": "Use an image smaller than 4 MB."})
            return

        request_body = {
            "contents": [{"parts": [
                {"text": PROMPT},
                {"inline_data": {"mime_type": mime_type, "data": image_data}},
            ]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseJsonSchema": {
                    "type": "object",
                    "properties": {
                        "books": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "properties": {
                                    "title": {"type": "string"},
                                    "author": {"type": "string"},
                                },
                                "required": ["title", "author"],
                            },
                        },
                    },
                    "required": ["books"],
                },
                "temperature": 0.1,
            },
        }
        try:
            response = None
            for model_index, model in enumerate(GEMINI_MODELS):
                endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
                attempts = 2 if model_index == 0 else 1
                for attempt in range(attempts):
                    response = requests.post(endpoint, headers={"x-goog-api-key": api_key, "Content-Type": "application/json"}, json=request_body, timeout=12)
                    if response.status_code != 503 or attempt == attempts - 1:
                        break
                    time.sleep(1)
                if response.status_code != 503:
                    break
            if response.status_code != 200:
                self.send_json(502, {"message": f"Image analysis provider rejected the request (HTTP {response.status_code})."})
                return
            response_data = response.json()
            candidates = response_data.get("candidates", [])
            if not candidates:
                self.send_json(502, {"message": "Image analysis returned no result. Try a clearer, smaller image."})
                return
            text_parts = [part.get("text", "") for part in candidates[0].get("content", {}).get("parts", [])]
            text = "".join(text_parts)
            if not text:
                self.send_json(502, {"message": "Image analysis returned no readable book data."})
                return
            json_match = re.search(r"\{.*\}", text, re.DOTALL)
            parsed = json.loads(json_match.group(0) if json_match else text)
            books = clean_books(parsed.get("books") if isinstance(parsed, dict) else parsed)
            self.send_json(200, {"books": books})
        except (requests.RequestException, TypeError, json.JSONDecodeError):
            self.send_json(502, {"message": "Image analysis returned an invalid result."})

    def do_GET(self):
        self.send_json(405, {"message": "Use POST with an image."})
