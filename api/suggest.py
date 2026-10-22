"""Return free book-title suggestions from Open Library."""

import json
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

import requests


class handler(BaseHTTPRequestHandler):
    def send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "public, max-age=300")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        query = parse_qs(urlparse(self.path).query).get("q", [""])[0].strip()
        if len(query) < 2:
            self.send_json(200, {"books": []})
            return
        try:
            response = requests.get(
                "https://openlibrary.org/search.json",
                params={"title": query, "limit": 6, "fields": "title,author_name"},
                timeout=8,
            )
            response.raise_for_status()
            seen, books = set(), []
            for item in response.json().get("docs", []):
                title = str(item.get("title") or "").strip()
                authors = [str(author).strip() for author in item.get("author_name", []) if str(author).strip()]
                key = f"{title.lower()}|{'|'.join(author.lower() for author in authors)}"
                if title and key not in seen:
                    seen.add(key)
                    books.append({"title": title, "authors": authors})
            self.send_json(200, {"books": books})
        except (requests.RequestException, ValueError, TypeError):
            self.send_json(502, {"books": [], "message": "Book suggestions are temporarily unavailable."})

    def do_POST(self):
        self.send_json(405, {"message": "Use GET."})
