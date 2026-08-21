#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT/delta-foods-equipamentos-app"
PORT="${PORT:-8080}"

mkdir -p "$APP_DIR"
for f in index.html manifest.json sw.js icon-192.png icon-512.png \
         quebra-template.xlsx mc00-template.xlsx simulador-template.js \
         serve.sh serve.ps1; do
  if [[ -e "$ROOT/$f" ]]; then
    ln -sfn "$ROOT/$f" "$APP_DIR/$f"
  fi
done

# Se já há servidor nesta porta, não reinicia (evita race no boot do agent)
if python3 - <<PY >/dev/null 2>&1
import socket
s = socket.socket()
s.settimeout(0.3)
try:
    s.connect(("127.0.0.1", int("$PORT")))
except Exception:
    raise SystemExit(1)
finally:
    s.close()
raise SystemExit(0)
PY
then
  echo "Já a servir em http://localhost:${PORT}/delta-foods-equipamentos-app/"
  # Mantém o processo start vivo sem ocupar a porta (Cloud Agent start)
  exec tail -f /dev/null
fi

echo "Delta Foods · Gestão de Equipamentos"
echo "Local:  http://localhost:${PORT}/delta-foods-equipamentos-app/"
echo "Bind:   0.0.0.0:${PORT}"
echo "Online: https://carloscastro1979.github.io/delta-foods-equipamentos-app/"
echo ""
cd "$ROOT"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
