-- Chamados AT — permitir DELETE (Histórico AT / Área Técnica)
-- Correr no SQL Editor do Supabase (projecto Delta Foods Equipamentos)
-- SE a UI devolver HTTP 401/403 ao eliminar.
--
-- A app faz hard-delete via PostgREST (role anon), com confirmação na UI.
-- Padrão alinhado com visitas_horeca / clientes_contencioso.

alter table public.chamados_at enable row level security;

-- Política ampla para anon (SELECT/INSERT/UPDATE/DELETE), se ainda não existir
drop policy if exists "anon all chamados_at" on public.chamados_at;
create policy "anon all chamados_at"
  on public.chamados_at
  for all
  using (true)
  with check (true);

-- Reforço explícito de DELETE (útil se houver outras políticas restritivas)
drop policy if exists "anon delete chamados_at" on public.chamados_at;
create policy "anon delete chamados_at"
  on public.chamados_at
  for delete
  using (true);

grant select, insert, update, delete on public.chamados_at to anon, authenticated;
