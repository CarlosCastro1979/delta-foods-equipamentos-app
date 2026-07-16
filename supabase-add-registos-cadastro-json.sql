-- Executar no Supabase SQL Editor (Dashboard → SQL → New query)
-- Necessário para GUARDAR a ficha de cadastro completa de cada cliente registado
-- (aba "Dados Cadastrais" dentro de Editar). Sem esta coluna, o PATCH com
-- cadastro_json falha com "Could not find the 'cadastro_json' column … in the schema cache".

ALTER TABLE registos ADD COLUMN IF NOT EXISTS cadastro_json jsonb;

-- Recarregar cache do PostgREST (opcional; útil se a coluna foi criada mas o erro persistir)
NOTIFY pgrst, 'reload schema';
