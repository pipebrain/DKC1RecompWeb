#!/usr/bin/env python3
"""Serve only the browser host and its private Wasm output on localhost."""
from __future__ import annotations

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1] / 'web'


class Handler(SimpleHTTPRequestHandler):
    # Keep module-graph requests on persistent localhost connections. Each
    # response already has Content-Length through SimpleHTTPRequestHandler.
    protocol_version = 'HTTP/1.1'

    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      '.wasm': 'application/wasm', '.js': 'text/javascript'}

    def send_head(self):
        relative = unquote(urlsplit(self.path).path).lstrip('/')
        path = (ROOT / relative).resolve()
        if (not path.is_relative_to(ROOT) or
                any(part.startswith('.') for part in Path(relative).parts) or
                path.suffix.lower() in {'.smc', '.sfc', '.sav', '.srm'}):
            self.send_error(404)
            return None
        return super().send_head()

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


class Server(ThreadingHTTPServer):
    # A module graph can open more connections in one burst than Python's
    # default five pending accepts. Leave room for the browser's parallel load.
    request_queue_size = 64


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8000)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('--port must be between 1 and 65535')
    with Server(('127.0.0.1', args.port), partial(Handler, directory=str(ROOT))) as server:
        print(f'Open http://127.0.0.1:{args.port}/ in Chrome. Ctrl-C stops the server.', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
