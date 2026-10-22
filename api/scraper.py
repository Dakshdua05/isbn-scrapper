"""Vercel API endpoint for looking up ISBN-13 values on Amazon India.

Send a JSON POST request to /api/scrape:
{"books": ["Atomic Habits", "Let Us C"]}
"""

import json
import re
from http.server import BaseHTTPRequestHandler
from typing import Optional
from urllib.parse import quote_plus, urljoin

import requests
from bs4 import BeautifulSoup


AMAZON_BASE_URL = "https://www.amazon.in"
REQUEST_TIMEOUT_SECONDS = 10
HEADERS = {
    "User-Agent": "AmazonIsbnLookup/1.0 (educational project)",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


def is_valid_isbn13(value: str) -> bool:
    """Return True when value has a valid ISBN-13 check digit."""
    if not re.fullmatch(r"(?:978|979)\d{10}", value):
        return False
    total = sum(int(digit) * (1 if index % 2 == 0 else 3) for index, digit in enumerate(value[:12]))
    return (10 - (total % 10)) % 10 == int(value[12])


def find_isbn13(text: str) -> Optional[str]:
    """Extract the first valid ISBN-13 from page text."""
    for match in re.finditer(r"(?:978|979)(?:[-\s]?\d){10}", text):
        isbn = re.sub(r"[^0-9]", "", match.group(0))
        if is_valid_isbn13(isbn):
            return isbn
    return None


def find_product_url(search_html: str) -> Optional[str]:
    soup = BeautifulSoup(search_html, "html.parser")
    for link in soup.select("a.a-link-normal.s-no-outline[href]"):
        href = link["href"].split("/ref=")[0]
        if "/dp/" in href:
            return urljoin(AMAZON_BASE_URL, href)
    return None


def get_indian_paperback_isbn(book_title: str) -> dict:
    """Search Amazon India and return one lookup result without bypassing site controls."""
    query = quote_plus(f"{book_title} paperback Indian edition")
    search_url = f"{AMAZON_BASE_URL}/s?k={query}&i=stripbooks"

    try:
        search_response = requests.get(search_url, headers=HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        if search_response.status_code != 200:
            return {"isbn_13": None, "status": "unavailable", "message": f"Amazon returned HTTP {search_response.status_code}."}

        product_url = find_product_url(search_response.text)
        if not product_url:
            return {"isbn_13": None, "status": "not_found", "message": "No matching Amazon product page was found."}

        product_response = requests.get(product_url, headers=HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
        if product_response.status_code != 200:
            return {"isbn_13": None, "status": "unavailable", "message": f"Product page returned HTTP {product_response.status_code}."}

        soup = BeautifulSoup(product_response.text, "html.parser")
        details = soup.select("#detailBullets_feature_div li, #productDetails_techSpec_section_1 tr, #productDetails_detailBullets_sections1 tr")
        page_text = " ".join(element.get_text(" ", strip=True) for element in details) or soup.get_text(" ", strip=True)
        isbn = find_isbn13(page_text)

        if isbn:
            return {"isbn_13": isbn, "status": "found", "product_url": product_url}
        return {"isbn_13": None, "status": "not_found", "message": "No valid ISBN-13 was listed on the product page."}
    except requests.RequestException:
        return {"isbn_13": None, "status": "unavailable", "message": "Amazon could not be reached."}


class handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
            self._send_json(400, {"status": "error", "message": "Send a valid JSON request body."})
            return

        books = payload.get("books") if isinstance(payload, dict) else None
        if not isinstance(books, list) or not books or not all(isinstance(book, str) and book.strip() for book in books):
            self._send_json(400, {"status": "error", "message": "'books' must be a non-empty array of book titles."})
            return
        results = []
        for title in books:
            result = {"query": title.strip()}
            result.update(get_indian_paperback_isbn(title.strip()))
            results.append(result)
        self._send_json(200, {"status": "success", "data": results})

    def do_GET(self) -> None:
        self._send_json(405, {"status": "error", "message": "Use POST with a JSON body containing a 'books' array."})

