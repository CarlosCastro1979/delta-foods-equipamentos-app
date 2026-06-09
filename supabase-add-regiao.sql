-- Executar no Supabase SQL Editor para activar o campo Região na prospeção
ALTER TABLE prospeccao ADD COLUMN IF NOT EXISTS regiao text;
