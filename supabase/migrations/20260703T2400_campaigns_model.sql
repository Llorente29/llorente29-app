-- 20260703T2400_campaigns_model.sql
-- Aplicada: (pendiente)
--
-- G1 — Gestor de campañas del Shop (costuras de automatización). Modelo:
--   coupon += origin ('manual'|'rule'|'agent')  -- G2 usará 'rule', F9 'agent'.
--   coupon += paused_at timestamptz             -- pausar SIN perder la config.
--
-- Semántica de pausa (decisión: NO tocar el motor, que ya filtra por `active`):
--   pausada   = active=false + paused_at con la fecha.
--   reactivar = active=true  + paused_at=null.
-- place_shop_order NO cambia (sigue exigiendo active=true). Cero riesgo de motor.
--
-- Backfill: ninguno (los defaults cubren lo existente: origin='manual', paused_at null).
-- No se aplica aquí (Julio aplica y verifica).

begin;

alter table public.coupon add column if not exists origin text not null default 'manual';
alter table public.coupon drop constraint if exists coupon_origin_check;
alter table public.coupon add constraint coupon_origin_check check (origin in ('manual','rule','agent'));

alter table public.coupon add column if not exists paused_at timestamptz;

commit;
