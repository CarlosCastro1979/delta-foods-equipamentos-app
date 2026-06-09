-- Executar no Supabase SQL Editor para activar o campo Região na prospeção (texto livre: cidade, zona, etc.)
ALTER TABLE prospeccao ADD COLUMN IF NOT EXISTS regiao text;
