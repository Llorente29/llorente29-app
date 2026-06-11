-- ============================================================
-- Migración: 20260611T2030_contrato_ingesta_sale_line_matricula
-- Contrato único de ingesta de ventas multi-fuente — Paso 2 (§12)
-- Añade la matrícula externa cruda a la línea de venta.
-- El adaptador las rellena al entrar la venta; el núcleo casa
-- (external_source, external_product_id) contra external_product_map.
-- Nullable: las ventas históricas quedan null hasta el recast.
-- Diseño: docs/folvy_contrato_ingesta_diseno.md (11/06/2026)
-- Aplicada: 2026-06-11 (Folvy Interno, SQL Editor, Success)
-- ============================================================

alter table public.sale_line
  add column external_source      text,   -- 'lastapp' | 'otter' | ... (qué adaptador la trajo)
  add column external_product_id  text,   -- id estable del producto en esa fuente
  add column external_brand_id    text;   -- marca en esa fuente (atadura determinista)

create index sale_line_external_match_idx
  on public.sale_line (external_source, external_product_id);
