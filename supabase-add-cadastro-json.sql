-- Executar no Supabase SQL Editor (Dashboard → SQL → New query)
-- Necessário para autosave das Fichas de Cadastro / simulação no modal Editar Lead.
-- Sem esta coluna, o PATCH com cadastro_json falha com "Could not find the 'cadastro_json' column … in the schema cache".

ALTER TABLE prospeccao ADD COLUMN IF NOT EXISTS cadastro_json jsonb;

-- Recarregar cache do PostgREST (opcional; útil se a coluna foi criada mas o erro persistir)
NOTIFY pgrst, 'reload schema';
