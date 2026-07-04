-- coupon_scope_platform_offers_PROPUESTA.sql
--
-- PROPUESTA (Claude propone, Julio ejecuta y verifica). NO aplicada aún.
--
-- Contexto: el módulo "Ofertas de plataforma" v1 guarda el ALCANCE de cada
-- campaña (marcas + platos) para poder REABRIR un borrador y seguir editándolo.
-- El encargo asumía `coupon.applies_to` jsonb, pero en producción esa columna es
-- `text NOT NULL` bloqueada por CHECK a 'subtotal' (verificado vía
-- information_schema el 04/07/2026). No hay ninguna otra columna/tabla donde
-- vivir ese alcance.
--
-- El código YA funciona sin esta migración: en sesión el alcance vive en el
-- estado del editor y, al APROBAR, queda inmutable en promo_push_job.payload. Lo
-- ÚNICO que esta columna habilita es reabrir un borrador PERSISTIDO con sus
-- marcas/platos ya marcados (hoy, sin la columna, un borrador reabierto pierde el
-- alcance y hay que re-elegirlo). platformOffersService escribe `scope`
-- best-effort y degrada solo si la columna no existe (error 42703).
--
-- Cambio: 1 columna nullable, aditiva, sin defaults ni triggers. No toca
-- origin/applies_to/kind ni sus CHECK. No obliga a regenerar database.ts (el
-- servicio opera coupon con cast).
--
-- Forma del jsonb: { "brand_ids": [uuid...], "menu_item_ids": [uuid...] | null }

begin;

alter table public.coupon
  add column if not exists scope jsonb;

comment on column public.coupon.scope is
  'Ofertas de plataforma: alcance del borrador { brand_ids:[uuid], menu_item_ids:[uuid]|null }. NULL para cupones que no son de plataforma.';

commit;
