-- Quadro de vendas: valor em R$ e NPess nas cargas novas.
-- A tabela vendas em produção só tinha id, cod, data, tipo, qty, peso.
-- Não reescreve linhas históricas. Correr uma vez no SQL editor do Supabase.
-- Enquanto estas colunas não existirem, o quadro guarda o R$ no agregado
-- (lista_clientes id = vendas_quadro) e a carga continua sem estas colunas.

alter table public.vendas add column if not exists valor double precision;
alter table public.vendas add column if not exists npess text;
