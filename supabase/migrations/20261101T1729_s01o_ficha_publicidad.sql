-- supabase/migrations/20261101T1729_s01o_ficha_publicidad.sql
-- cambia: public.company_account_link · prueba: supabase/staging/sql/20261101_s01o_apunta_solo_prueba.sql
--
-- S01o · La ficha de un proveedor guarda también su cuenta de PUBLICIDAD
-- (Julio, 01/11): Uber y Just Eat mandan la publicidad en una factura aparte,
-- que va a su 627 (62700002, 62700003), y la comisión a su 623. Un papel nuevo
-- en company_account_link, «publicidad», solo de terceros como «gasto».
-- Los dos CHECK solo AMPLÍAN: lo que ya estaba sigue valiendo.

alter table public.company_account_link drop constraint if exists company_account_link_role_check;
alter table public.company_account_link add constraint company_account_link_role_check
  check (role = any (array['principal', 'soportado', 'repercutido', 'gasto', 'pago', 'suplidos', 'liquidacion', 'publicidad']));
alter table public.company_account_link drop constraint if exists company_account_link_papel_de_tercero;
alter table public.company_account_link add constraint company_account_link_papel_de_tercero
  check (role <> all (array['gasto', 'pago', 'suplidos', 'liquidacion', 'publicidad']) or entity = any (array['supplier', 'customer']));
