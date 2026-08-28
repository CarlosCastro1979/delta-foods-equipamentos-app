#!/usr/bin/env python3
"""Servidor estático da app Delta Foods.

O GitHub Pages publica em /delta-foods-equipamentos-app/. Em local/cloud
o mesmo URL tem de funcionar, mesmo sem a pasta-espelho. Também servimos
a raiz (/) para o Simple Browser / «Open Port» do Cursor.
"""
from __future__ import annotations

import os
import posixpath
import sys
import threading
import urllib.parse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

APP_PREFIX = "/delta-foods-equipamentos-app"
SERVER_NAME = "Delta-Foods"


def remap_url_path(url_path: str) -> str:
    """Traduz o path HTTP para o path dentro da raiz do repositório."""
    raw = urllib.parse.urlsplit(url_path).path
    rel = urllib.parse.unquote(raw)
    if rel == APP_PREFIX or rel.startswith(APP_PREFIX + "/"):
        rel = rel[len(APP_PREFIX) :] or "/"
    if not rel.startswith("/"):
        rel = "/" + rel
    return rel


class DeltaHandler(SimpleHTTPRequestHandler):

    def version_string(self) -> str:
        return SERVER_NAME

    def log_message(self, fmt: str, *args) -> None:
        sys.stdout.write("%s - %s\n" % (self.address_string(), fmt % args))
        sys.stdout.flush()

    def end_headers(self) -> None:
        path = urllib.parse.urlsplit(self.path).path.lower()
        if path.endswith((".html", ".js", ".json", "/")) or path == APP_PREFIX:
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def translate_path(self, path: str) -> str:
        rel = remap_url_path(path)
        rel = posixpath.normpath(rel)
        words = [w for w in rel.split("/") if w and w not in (os.curdir, os.pardir)]
        full = self.directory
        for word in words:
            full = os.path.join(full, word)
        full = os.path.realpath(full)
        root = os.path.realpath(self.directory)
        if full != root and not full.startswith(root + os.sep):
            return os.path.join(root, ".__forbidden__")
        return full

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        if code != 404:
            return super().send_error(code, message, explain)
        body = (
            "<!DOCTYPE html><html lang='pt'><head><meta charset='utf-8'>"
            "<title>Delta Foods</title></head><body style='font-family:sans-serif;padding:24px'>"
            "<h1>Delta Foods</h1>"
            "<p>Caminho não encontrado neste servidor.</p>"
            "<p>Abre <a href='/delta-foods-equipamentos-app/'>/delta-foods-equipamentos-app/</a> "
            "ou a <a href='/'>raiz</a>.</p>"
            "</body></html>"
        ).encode("utf-8")
        self.send_response(404)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD" and code >= 200 and code not in (204, 304):
            try:
                self.wfile.write(body)
            except BrokenPipeError:
                pass


    def copyfile(self, source, outputfile) -> None:
        try:
            super().copyfile(source, outputfile)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


def _bind(host: str, port: int, directory: str) -> ThreadingHTTPServer:
    handler = partial(DeltaHandler, directory=directory)
    httpd = ThreadingHTTPServer((host, port), handler)
    httpd.daemon_threads = True
    return httpd


def bind_servers(directory: str, ports: list[int], host: str = "0.0.0.0") -> list[ThreadingHTTPServer]:
    servers: list[ThreadingHTTPServer] = []
    for port in ports:
        try:
            httpd = _bind(host, port, directory)
        except OSError as exc:
            print(f"Porta {port} ocupada ({exc}) — a ignorar.", file=sys.stderr)
            continue
        servers.append(httpd)
        print(f"Delta Foods · http://localhost:{port}{APP_PREFIX}/")
        print(f"           · http://localhost:{port}/")
    return servers


def serve(directory: str, ports: list[int], host: str = "0.0.0.0") -> None:
    servers = bind_servers(directory, ports, host)
    if not servers:
        raise SystemExit("Nenhuma porta disponível.")

    print("Online: https://carloscastro1979.github.io/delta-foods-equipamentos-app/")
    sys.stdout.flush()

    for httpd in servers[1:]:
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        servers[0].serve_forever()
    except KeyboardInterrupt:
        print("\nA parar.")
    finally:
        for httpd in servers:
            httpd.shutdown()


def main() -> None:
    root = os.path.dirname(os.path.abspath(__file__))
    primary = int(os.environ.get("PORT", "8080"))
    extras = os.environ.get("EXTRA_PORTS", "8088")
    ports: list[int] = [primary]
    for chunk in extras.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        p = int(chunk)
        if p not in ports:
            ports.append(p)
    serve(root, ports)


if __name__ == "__main__":
    main()
