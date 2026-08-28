#!/usr/bin/env python3
"""Caminhos do servidor local: raiz e /delta-foods-equipamentos-app/."""
from __future__ import annotations

import os
import sys
import threading
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from serve import APP_PREFIX, bind_servers, remap_url_path  # noqa: E402

ROOT = os.path.dirname(os.path.abspath(__file__))
failed = 0


def check(title: str, cond: bool, detail: str = "") -> None:
    global failed
    if cond:
        print("OK  " + title)
    else:
        failed += 1
        print("FAIL " + title + ((" — " + detail) if detail else ""))


check("raiz", remap_url_path("/") == "/")
check("index na raiz", remap_url_path("/index.html") == "/index.html")
check("prefixo pasta", remap_url_path("/delta-foods-equipamentos-app/") == "/")
check(
    "prefixo ficheiro",
    remap_url_path("/delta-foods-equipamentos-app/index.html") == "/index.html",
)
check(
    "query string",
    remap_url_path("/delta-foods-equipamentos-app/manifest.json?v=1") == "/manifest.json",
)
check("sem prefixo", remap_url_path("/manifest.json") == "/manifest.json")
check("constante", APP_PREFIX == "/delta-foods-equipamentos-app")


def _pick_port() -> int:
    import socket

    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


port = _pick_port()
servers = bind_servers(ROOT, [port], host="127.0.0.1")
if not servers:
    check("bind servidor teste", False)
    sys.exit(1)
httpd = servers[0]
thread = threading.Thread(target=httpd.serve_forever, daemon=True)
thread.start()

try:
    for _ in range(50):
        try:
            req = urllib.request.Request(
                f"http://127.0.0.1:{port}/",
                method="HEAD",
            )
            urllib.request.urlopen(req, timeout=0.2).read()
            break
        except Exception:
            time.sleep(0.05)
    else:
        check("servidor arrancou", False)
        sys.exit(1)

    def get(path: str):
        req = urllib.request.Request(
            f"http://127.0.0.1:{port}{path}",
            headers={"Range": "bytes=0-180"},
        )
        with urllib.request.urlopen(req, timeout=2) as r:
            return r.status, r.headers.get("Server", ""), r.read(200)

    st, srv, body = get("/delta-foods-equipamentos-app/")
    check("GET prefixo 200/206", st in (200, 206), str(st))
    check("Server Delta-Foods", "Delta-Foods" in srv, srv)
    check("HTML da app (prefixo)", b"<!DOCTYPE html>" in body)

    st, srv, body = get("/")
    check("GET raiz 200/206", st in (200, 206), str(st))
    check("HTML da app (raiz)", b"<!DOCTYPE html>" in body)

    st, srv, body = get("/index.html")
    check("GET /index.html 200/206", st in (200, 206), str(st))

    try:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/nao-existe-xyz", timeout=2)
        check("404 caminho inválido", False)
    except urllib.error.HTTPError as e:
        check("404 caminho inválido", e.code == 404)
        snippet = e.read()
        check("404 identifica Delta Foods", b"Delta Foods" in snippet)
finally:
    httpd.shutdown()
    httpd.server_close()

sys.exit(1 if failed else 0)
