-- Pedidos Contencioso pendentes (espelha clientes_encerrados)
create table if not exists public.clientes_contencioso (
  id uuid primary key default gen_random_uuid(),
  cod text not null,
  nome text,
  vendedor text,
  valor_divida numeric,
  dias_atraso integer,
  ultima_compra text,
  observacoes text,
  solicitado_por text,
  criado_em timestamptz default now()
);

create index if not exists clientes_contencioso_cod_idx on public.clientes_contencioso (cod);
create index if not exists clientes_contencioso_criado_idx on public.clientes_contencioso (criado_em desc);

alter table public.clientes_contencioso enable row level security;

drop policy if exists "anon all clientes_contencioso" on public.clientes_contencioso;
create policy "anon all clientes_contencioso"
  on public.clientes_contencioso
  for all
  using (true)
  with check (true);
