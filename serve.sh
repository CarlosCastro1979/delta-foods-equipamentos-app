#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT/delta-foods-equipamentos-app"
PORT="${PORT:-8080}"

mkdir -p "$APP_DIR"
for f in index.html manifest.json sw.js icon-192.png icon-512.png; do
  ln -sf "$ROOT/$f" "$APP_DIR/$f"
done

echo "Delta Foods · Gestão de Equipamentos"
echo "Local:  http://localhost:${PORT}/delta-foods-equipamentos-app/"
echo "Bind:   0.0.0.0:${PORT} (all interfaces — use Cursor Ports forwarding)"
echo "Online: https://carloscastro1979.github.io/delta-foods-equipamentos-app/"
echo ""
cd "$ROOT"
exec python3 -m http.server "$PORT" --bind 0.0.0.0
