-- Cadastro SAP (modal Ganho): persistência JSON para autosave e validação
ALTER TABLE prospeccao ADD COLUMN IF NOT EXISTS cadastro_json jsonb;
