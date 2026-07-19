-- Executar no Supabase SQL Editor para isolar Prospeção por canal da app
-- (horeca | ecommerce | varejo | distribuidores).
-- Leads existentes sem valor ficam como 'horeca' (migração na app + backfill opcional).

ALTER TABLE prospeccao ADD COLUMN IF NOT EXISTS canal_app text;

UPDATE prospeccao
SET canal_app = 'horeca'
WHERE canal_app IS NULL OR TRIM(canal_app) = '';

CREATE INDEX IF NOT EXISTS idx_prospeccao_canal_app ON prospeccao (canal_app);
