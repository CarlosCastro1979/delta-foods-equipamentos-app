-- Visitas do dia (Horeca) — rota diária dos vendedores
create table if not exists public.visitas_horeca (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  vendedor text not null,
  cod text not null,
  nome text,
  zd text,
  visitado boolean,
  comprou boolean,
  motivo_nao_compra text,
  canal text not null default 'horeca',
  atualizado_em timestamptz default now(),
  atualizado_por text
);

-- Se a tabela já existir sem zd:
alter table public.visitas_horeca add column if not exists zd text;

create unique index if not exists visitas_horeca_dia_vend_cod_uidx
  on public.visitas_horeca (data, vendedor, cod);

create index if not exists visitas_horeca_data_idx on public.visitas_horeca (data desc);
create index if not exists visitas_horeca_vendedor_idx on public.visitas_horeca (vendedor);

alter table public.visitas_horeca enable row level security;

drop policy if exists "anon all visitas_horeca" on public.visitas_horeca;
create policy "anon all visitas_horeca"
  on public.visitas_horeca
  for all
  using (true)
  with check (true);
