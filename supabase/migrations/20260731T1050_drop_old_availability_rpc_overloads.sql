-- 20260731T1050_drop_old_availability_rpc_overloads.sql
-- ============================================================================
-- DISPONIBILIDAD · C1 — FIX de overloads. Las migraciones 1010/1020/1030
-- añadieron p_reason_code vía `create or replace function`. En Postgres,
-- cambiar la LISTA DE ARGUMENTOS no reemplaza: crea una SEGUNDA versión
-- (overload). Convivían la firma vieja (sin p_reason_code) y la nueva → al
-- llamar la app con los args de siempre, "could not choose the best candidate
-- function" (error en vivo al Cerrar marca, 31/07). Este fix borra las 6
-- firmas VIEJAS; quedan solo las nuevas (p_reason_code default null →
-- retrocompatibles). Aplicado a mano en prod el 31/07 y verificado (cerrar
-- marca funciona + escribe en availability_event); este fichero alinea el repo.
-- LECCIÓN para C3: al añadir/quitar un parámetro, DROP de la firma vieja
-- ANTES del create — no basta create or replace.
-- ============================================================================

begin;
drop function if exists public.set_brand_status(uuid, text, timestamptz, text);
drop function if exists public.set_brand_status_by_token(text, uuid, text, timestamptz, text);
drop function if exists public.set_location_status(uuid, text, timestamptz, text);
drop function if exists public.set_location_status_by_token(text, text, timestamptz, text);
drop function if exists public.set_product_availability(uuid, boolean, uuid, text, timestamptz);
drop function if exists public.set_product_availability_by_token(text, uuid, boolean, text, timestamptz);
commit;

notify pgrst, 'reload schema';
