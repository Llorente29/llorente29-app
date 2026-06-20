-- supabase/migrations/20260620T0000_sale_platform_codes.sql
-- Aplicada: 2026-06-20 (SQL Editor) — versionada para evitar drift.
-- ============================================================================
-- Códigos de pedido REALES en sale (frente del código de plataforma).
--   platform_order_code  <- raw_tab.name  = nº REAL de la plataforma (Glovo
--                            101688354460 / JustEat 187227548 / Uber AF5D0).
--                            Portable: cada frontera (Last hoy, HubRise/Glovo
--                            directo mañana) lo rellena desde SU payload.
--   pos_short_code       <- raw_tab.code  = corto del pedido (G931/U382/J076).
--                            En Glovo es el código que el rider muestra al
--                            recoger; efímero. null si no entró por Last.
-- Antes, el ticket usaba un RECORTE del UUID del tab (no servía al rider).
-- Backfill desde el propio raw_tab de cada fila (cubre todas las cuentas).
-- Idempotente (add column if not exists + where is distinct from).
-- ============================================================================

alter table public.sale add column if not exists platform_order_code text;
alter table public.sale add column if not exists pos_short_code      text;

update public.sale s
set platform_order_code = nullif(btrim(s.raw_tab::jsonb ->> 'name'), ''),
    pos_short_code      = nullif(btrim(s.raw_tab::jsonb ->> 'code'), '')
where s.raw_tab is not null
  and (
    s.platform_order_code is distinct from nullif(btrim(s.raw_tab::jsonb ->> 'name'), '')
    or s.pos_short_code   is distinct from nullif(btrim(s.raw_tab::jsonb ->> 'code'), '')
  );
