-- PIN por utilizador (hash SHA-256 de pin|utilizador normalizado).
-- Executar no Supabase SQL Editor. RLS anon como nas outras tabelas da app.

create table if not exists public.utilizador_pins (
  utilizador text primary key,
  pin_hash text not null,
  criado_em timestamptz default now(),
  atualizado_em timestamptz default now()
);

create index if not exists utilizador_pins_atualizado_idx
  on public.utilizador_pins (atualizado_em desc);

alter table public.utilizador_pins enable row level security;

drop policy if exists "anon all utilizador_pins" on public.utilizador_pins;
create policy "anon all utilizador_pins"
  on public.utilizador_pins
  for all
  using (true)
  with check (true);
