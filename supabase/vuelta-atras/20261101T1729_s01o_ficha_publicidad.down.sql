-- supabase/vuelta-atras/20261101T1729_s01o_ficha_publicidad.down.sql
--
-- Vuelta atrás de la 1729: los dos CHECK como estaban (sin «publicidad»). Si queda
-- algún enlace con ese papel, para: primero se quita (lo hace la vuelta atrás de la 1732).
alter table public.company_account_link drop constraint if exists company_account_link_role_check;
alter table public.company_account_link add constraint company_account_link_role_check
  check (role = any (array['principal', 'soportado', 'repercutido', 'gasto', 'pago', 'suplidos', 'liquidacion']));
alter table public.company_account_link drop constraint if exists company_account_link_papel_de_tercero;
alter table public.company_account_link add constraint company_account_link_papel_de_tercero
  check (role <> all (array['gasto', 'pago', 'suplidos', 'liquidacion']) or entity = any (array['supplier', 'customer']));
