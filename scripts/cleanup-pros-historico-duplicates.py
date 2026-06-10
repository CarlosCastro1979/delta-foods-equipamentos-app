#!/usr/bin/env python3
"""Remove entradas duplicadas do histórico de prospeção (máx. 1 por dia por lead)."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime
from zoneinfo import ZoneInfo

SUPABASE_URL = "https://qnscwppgljobelplgbkp.supabase.co/rest/v1"
SUPABASE_KEY = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFuc2N3cHBnbGpvYmVscGxnYmtwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxMDc3NzgsImV4cCI6MjA5MTY4Mzc3OH0."
    "9ysq0ibsn3qDPHe5WYF-yyq9-vEKjc_hIn9BNKZccYY"
)
TZ = ZoneInfo("America/Sao_Paulo")


def api(method: str, path: str, body: dict | None = None) -> tuple[int, str]:
    url = f"{SUPABASE_URL}{path}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "apikey": SUPABASE_KEY,
            "Authorization": f"Bearer {SUPABASE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode() or ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def day_key(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(TZ).strftime("%Y-%m-%d")


def fetch_historico(prospeccao_id: int | None) -> list[dict]:
    path = "/prospeccao_historico?select=id,prospeccao_id,estado_anterior,estado_novo,nota,criado_em&order=criado_em.asc"
    if prospeccao_id is not None:
        path += f"&prospeccao_id=eq.{prospeccao_id}"
    status, raw = api("GET", path)
    if status != 200:
        raise RuntimeError(f"Erro ao ler histórico: HTTP {status} {raw}")
    return json.loads(raw)


def merge_day_entries(entries: list[dict]) -> tuple[dict, list[int]]:
    entries = sorted(entries, key=lambda e: e["criado_em"])
    with_nota = [e for e in entries if e.get("nota")]
    keeper = with_nota[0] if with_nota else entries[0]
    last = entries[-1]

    merged = {
        "estado_novo": last.get("estado_novo"),
        "estado_anterior": last.get("estado_anterior"),
        "nota": keeper.get("nota") or last.get("nota"),
    }
    if merged["estado_anterior"] == merged["estado_novo"]:
        merged["estado_anterior"] = keeper.get("estado_anterior")

    delete_ids = [e["id"] for e in entries if e["id"] != keeper["id"]]
    return {"id": keeper["id"], **merged}, delete_ids


def run(prospeccao_id: int | None, dry_run: bool) -> int:
    rows = fetch_historico(prospeccao_id)
    groups: dict[tuple[int, str], list[dict]] = defaultdict(list)
    for row in rows:
        groups[(row["prospeccao_id"], day_key(row["criado_em"]))].append(row)

    total_deleted = 0
    total_patched = 0

    for (lead_id, day), entries in sorted(groups.items()):
        if len(entries) <= 1:
            continue

        merged, delete_ids = merge_day_entries(entries)
        print(f"Lead {lead_id} · {day}: manter #{merged['id']}, apagar {len(delete_ids)} duplicados")

        if dry_run:
            print(f"  PATCH #{merged['id']}: {json.dumps({k: merged[k] for k in ('estado_anterior','estado_novo','nota')}, ensure_ascii=False)}")
            print(f"  DELETE ids: {delete_ids}")
            total_deleted += len(delete_ids)
            total_patched += 1
            continue

        patch_body = {
            "estado_anterior": merged["estado_anterior"],
            "estado_novo": merged["estado_novo"],
            "nota": merged["nota"],
        }
        status, raw = api("PATCH", f"/prospeccao_historico?id=eq.{merged['id']}", patch_body)
        if status not in (200, 204):
            print(f"  ERRO PATCH #{merged['id']}: HTTP {status} {raw}", file=sys.stderr)
            return 1
        total_patched += 1

        for dup_id in delete_ids:
            status, raw = api("DELETE", f"/prospeccao_historico?id=eq.{dup_id}")
            if status not in (200, 204):
                print(f"  ERRO DELETE #{dup_id}: HTTP {status} {raw}", file=sys.stderr)
                return 1
            total_deleted += 1

    print(f"Concluído: {total_patched} dia(s) consolidados, {total_deleted} entrada(s) removidas.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Limpar duplicados do histórico de prospeção")
    parser.add_argument("--lead", type=int, help="ID do lead (prospeccao_id). Ex: 9")
    parser.add_argument("--all", action="store_true", help="Processar todos os leads")
    parser.add_argument("--dry-run", action="store_true", help="Mostrar o que seria feito sem gravar")
    args = parser.parse_args()

    if not args.all and args.lead is None:
        parser.error("Indica --lead ID ou --all")

    return run(None if args.all else args.lead, args.dry_run)


if __name__ == "__main__":
    raise SystemExit(main())
