-- MC00 (condições especiais de fornecimento) por cliente registado
ALTER TABLE registos ADD COLUMN IF NOT EXISTS mc00_json jsonb;
NOTIFY pgrst, 'reload schema';
