-- 20260814T1300_recepcion_oficina_a1_not_goods_columnas.sql
-- ENCARGO CODE (14/08) feat/recepcion-oficina-cierre, Tramo A.1
-- Aplicada: 14/08/2026 vía MCP (mcp__claude_ai_Supabase__apply_migration),
-- verificada con query independiente contra information_schema/pg_constraint.
--
-- Columnas nuevas en goods_receipt_line para que la oficina marque una línea
-- como "no es mercancía" (portes, envases, descuento, impuesto, otro) sin que
-- desaparezca del radar en confirm_goods_receipt.
--
-- Por qué columna nueva y no reutilizar (RECON 14/08, verificado por MCP):
--   - notes: 0 valores no vacíos en las 775 filas vivas (muerta), pero es
--     texto libre y esto es una decisión tipificada (CHECK).
--   - map_source: 5 valores vivos (unmapped 404 · manual 179 · code 151 ·
--     created 29 · fuzzy 12) — meter "not_goods" ahí contaminaría la métrica
--     del casado automático (85,6% que resuelve solo). Medido a 90 días.

alter table goods_receipt_line
  add column if not exists not_goods boolean not null default false,
  add column if not exists not_goods_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'goods_receipt_line_not_goods_kind_chk'
  ) then
    alter table goods_receipt_line
      add constraint goods_receipt_line_not_goods_kind_chk
      check (not_goods_kind is null or not_goods_kind in ('portes','envases','descuento','impuesto','otro'));
  end if;
end $$;

-- ── Verificación (aborta si el objeto no quedó) ──────────────────────────
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='goods_receipt_line' and column_name='not_goods'
  ) then
    raise exception 'A.1: goods_receipt_line.not_goods no quedó creada';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='goods_receipt_line' and column_name='not_goods_kind'
  ) then
    raise exception 'A.1: goods_receipt_line.not_goods_kind no quedó creada';
  end if;
  if not exists (
    select 1 from pg_constraint where conname='goods_receipt_line_not_goods_kind_chk'
  ) then
    raise exception 'A.1: constraint goods_receipt_line_not_goods_kind_chk no quedó creada';
  end if;
end $$;
