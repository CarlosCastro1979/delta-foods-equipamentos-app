-- Área Técnica (v1) — numeração de chamados + estado de tratamento
-- Correr no SQL Editor do Supabase (projecto Delta Foods Equipamentos).
-- Não destrutivo: ADD COLUMN IF NOT EXISTS + backfill.
--
-- OBRIGATÓRIO para a home Área Técnica (lista de chamados):
--   Sem as colunas `numero` e `estado`, queries com order/select nesses campos
--   devolvem HTTP 400 no PostgREST. A app tenta carregar com order=id.desc,
--   mas PATCH de estado / numeração AT # precisam desta migration.
--
-- ACL (só na app index.html, não no SQL):
--   Área Técnica: Fernando, Ricardo Vicente Silva, Marcelo + admin Carlos Castro
--   Área Financeira: Christian Souza, Andrea Albuquerque, Daniela Kucinski + admin
-- PIN padrão app: 1304

-- 1) Colunas novas
alter table public.chamados_at
  add column if not exists numero integer;

alter table public.chamados_at
  add column if not exists estado text;

-- 2) Sequência para números sequenciais (AT-001, AT-002… via app: "AT #" + numero)
create sequence if not exists public.chamados_at_numero_seq;

-- 3) Backfill: atribuir número aos registos antigos (por id ascendente)
with ordered as (
  select id, row_number() over (order by id) as rn
  from public.chamados_at
  where numero is null
)
update public.chamados_at c
set numero = o.rn
from ordered o
where c.id = o.id;

-- 4) Ajustar sequência ao máximo actual
select setval(
  'public.chamados_at_numero_seq',
  greatest(coalesce((select max(numero) from public.chamados_at), 0), 1)
);

-- 5) Default para novos inserts (a app também pode enviar numero explicitamente)
alter table public.chamados_at
  alter column numero set default nextval('public.chamados_at_numero_seq');

-- 6) Estado por defeito nos antigos + default em novos
update public.chamados_at
set estado = 'aberto'
where estado is null or trim(estado) = '';

alter table public.chamados_at
  alter column estado set default 'aberto';

-- Estados usados pela app (v1):
--   aberto | em_tratamento | concluido
-- Tipos Dist tratados na Área Técnica (v1):
--   dist_equipamento | dist_pecas
-- Extensível: outros tipo_equip podem entrar na lista sem alterar schema.

comment on column public.chamados_at.numero is
  'Número sequencial do chamado para a Área Técnica (lista / conclusão).';
comment on column public.chamados_at.estado is
  'Fluxo AT: aberto | em_tratamento | concluido';

-- Índice útil para a lista AT
create index if not exists chamados_at_estado_idx
  on public.chamados_at (estado);

create index if not exists chamados_at_numero_idx
  on public.chamados_at (numero desc);

create index if not exists chamados_at_tipo_equip_idx
  on public.chamados_at (tipo_equip);
