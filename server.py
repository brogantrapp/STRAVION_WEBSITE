#!/usr/bin/env python3
"""Stravion Aerospace site preview server.

Serves the website at 0.0.0.0:$PORT (default 8080), with a small JSON API for
editable sample products and quote inquiries. This is a local/demo backend, not
a production commerce or payment system.
"""
import base64
import hmac
import json
import mimetypes
import os
import re
import shutil
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from socketserver import ThreadingMixIn
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(HERE)
DATA_DIR = os.environ.get("STRAVION_DATA_DIR", HERE)
ADMIN_PASSWORD = os.environ.get("STRAVION_ADMIN_PASSWORD", "")
os.makedirs(DATA_DIR, exist_ok=True)
PRODUCTS_FILE = os.path.join(DATA_DIR, "products.json")
DEFAULT_BACKUP = os.path.join(DATA_DIR, "products.default.json")
INQUIRIES_FILE = os.path.join(DATA_DIR, "inquiries.json")

# Seed an external persistent data volume from the editable starter catalogue on first run.
SEED_PRODUCTS = os.path.join(HERE, "products.json")
if not os.path.exists(PRODUCTS_FILE) and os.path.exists(SEED_PRODUCTS):
    shutil.copyfile(SEED_PRODUCTS, PRODUCTS_FILE)
# Persistent starter catalogue backup: only created on the first server run.
if os.path.exists(PRODUCTS_FILE) and not os.path.exists(DEFAULT_BACKUP):
    shutil.copyfile(PRODUCTS_FILE, DEFAULT_BACKUP)

MEDIA_FILES = {
    "/fullscale/Stravion_UAV_fullscale_demo.mp4": os.path.join(
        PROJECT_ROOT, "fullscale", "Stravion_UAV_fullscale_demo.mp4"
    ),
    "/retro/Stravion_UAV_1996_preview.mp4": os.path.join(
        PROJECT_ROOT, "retro", "Stravion_UAV_1996_preview.mp4"
    ),
}


def load_json_file(path, fallback):
    if not os.path.exists(path):
        return fallback
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return fallback


def load_products():
    data = load_json_file(PRODUCTS_FILE, [])
    return data if isinstance(data, list) else []


def save_products(items):
    temp_path = PRODUCTS_FILE + ".tmp"
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(items, f, indent=2, ensure_ascii=False)
    os.replace(temp_path, PRODUCTS_FILE)


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class StravionHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HERE, **kwargs)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range, Authorization")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def _read_body_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def _require_admin(self):
        if not ADMIN_PASSWORD:
            return True  # Open only for the local prototype; set STRAVION_ADMIN_PASSWORD before public use.
        authorization = self.headers.get("Authorization", "")
        expected = "Basic " + base64.b64encode(f"admin:{ADMIN_PASSWORD}".encode("utf-8")).decode("ascii")
        if hmac.compare_digest(authorization, expected):
            return True
        raw = json.dumps({"error": "Store manager password required."}).encode("utf-8")
        self.send_response(401)
        self.send_header("WWW-Authenticate", 'Basic realm="Stravion Store Manager"')
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)
        return False

    def _serve_media(self, path):
        if not os.path.isfile(path):
            return self.send_error(404, "Media file not found")
        file_size = os.path.getsize(path)
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        range_header = self.headers.get("Range", "")
        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if match:
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else file_size - 1
            end = min(end, file_size - 1)
            if start > end or start >= file_size:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{file_size}")
                self.end_headers()
                return
            length = end - start + 1
            self.send_response(206)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.send_header("Content-Length", str(length))
            self.end_headers()
            try:
                with open(path, "rb") as media:
                    media.seek(start)
                    remaining = length
                    while remaining:
                        chunk = media.read(min(1024 * 1024, remaining))
                        if not chunk:
                            break
                        self.wfile.write(chunk)
                        remaining -= len(chunk)
            except (BrokenPipeError, ConnectionResetError):
                pass  # Browsers may cancel a preview/video range request during navigation.
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_size))
        self.end_headers()
        try:
            with open(path, "rb") as media:
                shutil.copyfileobj(media, self.wfile)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_HEAD(self):
        parsed = urlparse(self.path)
        if parsed.path in MEDIA_FILES:
            path = MEDIA_FILES[parsed.path]
            if not os.path.isfile(path):
                return self.send_error(404, "Media file not found")
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(path)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(os.path.getsize(path)))
            self.end_headers()
            return
        return super().do_HEAD()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/products":
            return self._send_json(load_products())
        if parsed.path == "/api/health":
            return self._send_json({"ok": True, "service": "Stravion website demo"})
        if parsed.path == "/inquiries.json":
            return self.send_error(404, "Not found")
        if parsed.path in MEDIA_FILES:
            return self._serve_media(MEDIA_FILES[parsed.path])
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        try:
            body = self._read_body_json()
        except (UnicodeDecodeError, json.JSONDecodeError):
            return self._send_json({"error": "Invalid JSON"}, 400)

        if parsed.path in ("/api/products", "/api/reset-products") and not self._require_admin():
            return

        if parsed.path == "/api/products":
            if isinstance(body, list):
                save_products(body)
                return self._send_json({"ok": True, "products": body})
            if isinstance(body, dict):
                items = load_products()
                items.insert(0, body)
                save_products(items)
                return self._send_json({"ok": True, "products": items})
            return self._send_json({"error": "Invalid product payload"}, 400)

        if parsed.path == "/api/reset-products":
            if os.path.exists(DEFAULT_BACKUP):
                shutil.copyfile(DEFAULT_BACKUP, PRODUCTS_FILE)
            return self._send_json({"ok": True, "products": load_products()})

        if parsed.path == "/api/inquiries":
            if not isinstance(body, dict) or not body.get("email"):
                return self._send_json({"error": "Email is required"}, 400)
            inquiries = load_json_file(INQUIRIES_FILE, [])
            body["received_at"] = time.strftime("%Y-%m-%d %H:%M:%S %Z")
            body["id"] = f"inq-{int(time.time() * 1000)}"
            inquiries.append(body)
            with open(INQUIRIES_FILE, "w", encoding="utf-8") as f:
                json.dump(inquiries, f, indent=2, ensure_ascii=False)
            return self._send_json({"ok": True, "message": "Inquiry saved to this demo server."})

        return self._send_json({"error": "Not found"}, 404)

    def do_PUT(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/products/"):
            if not self._require_admin():
                length = int(self.headers.get("Content-Length", "0"))
                if length:
                    self.rfile.read(length)
                return
            product_id = parsed.path.split("/api/products/", 1)[1]
            try:
                body = self._read_body_json()
            except (UnicodeDecodeError, json.JSONDecodeError):
                return self._send_json({"error": "Invalid JSON"}, 400)
            if not isinstance(body, dict):
                return self._send_json({"error": "Invalid product payload"}, 400)
            items = load_products()
            for index, item in enumerate(items):
                if str(item.get("id")) == product_id:
                    items[index] = body
                    break
            else:
                items.insert(0, body)
            save_products(items)
            return self._send_json({"ok": True, "products": items})
        return self._send_json({"error": "Not found"}, 404)

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/products/"):
            if not self._require_admin():
                return
            product_id = parsed.path.split("/api/products/", 1)[1]
            items = [item for item in load_products() if str(item.get("id")) != product_id]
            save_products(items)
            return self._send_json({"ok": True, "products": items})
        return self._send_json({"error": "Not found"}, 404)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8080"))
    server = ThreadingHTTPServer(("0.0.0.0", port), StravionHandler)
    print(f"Stravion Aerospace preview server listening on 0.0.0.0:{port}", flush=True)
    server.serve_forever()
