Carga equipamentos Distribuidores (Excel)
========================================

Fonte principal: aba "base" do export SAP (case-insensitive: base / BASE / Base).
Não usar outras abas do workbook como fonte.

CSV de exemplo (dist-equip-carga-exemplo.csv):
  - Uma única "folha" — a app aceita.
  - Colunas: nf, cod_cliente, nome_cliente, codigo_sap, descricao, qty, data_nf, valor, tag
  - valor = montante da linha (R$); usado no Total de Eq por distribuidor
  - Na UI Dist: badge "10" = qty de máquinas (não é data); a data da NF aparece completa (DD/MM/AAAA)

Quando tiveres o Excel real:
  1. Dados (PIN) → "Carga equipamentos Distribuidores (Excel)"
  2. Selecionar o .xlsx — a app lê a aba base
  3. Confirmar / ajustar mapeamento de colunas
  4. No canal Distribuidores → Registar cliente → Sim comodato → chips da carga

Teste sem Excel:
  - Canal Distribuidores → Por Registar → Registar
  - Não → grava sem_comodato e vai à lista
  - Sim → + Adicionar contrato → equipamentos + Tags (catálogo manual)
