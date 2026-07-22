-- Mapa cliente Contencioso → escritório de advogados
create table if not exists public.contencioso_escritorios (
  cod text primary key,
  escritorio text not null default '',
  updated_at timestamptz default now()
);

create index if not exists contencioso_escritorios_escritorio_idx
  on public.contencioso_escritorios (escritorio);

alter table public.contencioso_escritorios enable row level security;

drop policy if exists "anon all contencioso_escritorios" on public.contencioso_escritorios;
create policy "anon all contencioso_escritorios"
  on public.contencioso_escritorios
  for all
  using (true)
  with check (true);
