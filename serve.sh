#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT/delta-foods-equipamentos-app"
PORT="${PORT:-8080}"

mkdir -p "$APP_DIR"
for f in index.html manifest.json sw.js icon-192.png icon-512.png \
         quebra-template.xlsx mc00-template.xlsx simulador-template.js \
         serve.sh serve.ps1 serve.py; do
  if [[ -e "$ROOT/$f" ]]; then
    ln -sfn "$ROOT/$f" "$APP_DIR/$f"
  fi
done

# Já há servidor Delta Foods nesta porta? Não reinicia (boot do Cloud Agent).
if python3 - <<PY >/dev/null 2>&1
import urllib.request
try:
    req = urllib.request.Request(
        "http://127.0.0.1:${PORT}/delta-foods-equipamentos-app/",
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=0.6) as r:
        body = r.read(80)
        if r.status == 200 and b"<!DOCTYPE html>" in body:
            raise SystemExit(0)
except Exception:
    pass
raise SystemExit(1)
PY
then
  echo "Já a servir em http://localhost:${PORT}/delta-foods-equipamentos-app/"
  exec tail -f /dev/null
fi

echo "Delta Foods · Gestão de Equipamentos"
echo "Local:  http://localhost:${PORT}/delta-foods-equipamentos-app/"
echo "        http://localhost:${PORT}/"
echo "Bind:   0.0.0.0:${PORT} (+ 8088 se estiver livre)"
echo "Online: https://carloscastro1979.github.io/delta-foods-equipamentos-app/"
echo ""
cd "$ROOT"
export PORT
exec python3 "$ROOT/serve.py"
