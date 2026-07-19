-- =============================================================================
-- Distribuidores: registo com/sem comodato + carga Excel de equipamentos (NF)
-- Executar no Supabase SQL Editor (Dashboard → SQL → New query).
-- =============================================================================
-- Depois de correr: NOTIFY pgrst, 'reload schema';
-- =============================================================================

-- 1) Campos no registo (só usados no canal Distribuidores)
ALTER TABLE registos ADD COLUMN IF NOT EXISTS tem_comodato boolean;
ALTER TABLE registos ADD COLUMN IF NOT EXISTS dist_contratos jsonb;

COMMENT ON COLUMN registos.tem_comodato IS
  'Distribuidores: true = tem contratos de comodato; false = sem comodato/sem equipamentos; NULL = legado (inferir).';
COMMENT ON COLUMN registos.dist_contratos IS
  'Distribuidores: [{ "numero": "…", "equipamentos": [{ "tipo", "tag", "codigo", "nf", "origem" }] }]. Compat: legado usa contrato + equipamentos planos.';

-- 2) Catálogo importado por Excel (NF + máquinas que saíram) — universo Dist
CREATE TABLE IF NOT EXISTS dist_equip_carga (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nf text,
  cod_cliente text NOT NULL,
  nome_cliente text,
  codigo_sap text,
  descricao text,
  qty numeric DEFAULT 1,
  data_nf date,
  tag text,
  vendedor text,
  origem_ficheiro text,
  importado_em timestamptz DEFAULT now(),
  importado_por text,
  meta jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_dist_equip_carga_cod ON dist_equip_carga (cod_cliente);
CREATE INDEX IF NOT EXISTS idx_dist_equip_carga_nf ON dist_equip_carga (nf);

COMMENT ON TABLE dist_equip_carga IS
  'Carga Excel Distribuidores: NFs e máquinas disponíveis para associar a contratos no registo.';

-- Excel: usar a aba "base" (export SAP). A app escolhe sheet "base" (case-insensitive);
-- se só houver uma sheet, usa essa. Não usar outras abas como fonte principal.
--
-- Colunas esperadas (headers flexíveis / aliases SAP PT-BR — a app mapeia):
--   nf | numero_nf | nota_fiscal | doc.faturamento | nº documento | billing
--   cod_cliente | codigo_cliente | cliente | emissor | sold-to | nº cliente
--   nome_cliente | nome | razao_social | name 1
--   codigo_sap | material | codigo_equipamento | equipamento | nº material
--   descricao | desc | descricao_material | texto breve material | denominação
--   qty | quantidade | qtd | quantity
--   data_nf | data | data_saida | data documento | data de faturação
--   tag | numero_tag | nº série | serial (opcional na carga)
--
-- RLS: se a tabela for criada com RLS activo, permitir SELECT/INSERT/DELETE
-- ao role anon (ou service) conforme o resto da app. Exemplo permissivo:
--   ALTER TABLE dist_equip_carga ENABLE ROW LEVEL SECURITY;
--   CREATE POLICY "anon_all_dist_equip_carga" ON dist_equip_carga
--     FOR ALL TO anon USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
