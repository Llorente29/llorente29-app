-- supabase/vuelta-atras/20261101T1732_s01o_foodint.down.sql
--
-- Vuelta atrás de la 1732: fuera las cuentas que puso en las fichas de las
-- plataformas de Foodint. El interruptor no lo tocó la 1732, así que no se toca.
delete from public.company_account_link k using public.s01o_ficha_puesta p where p.link_id = k.id and p.account_id = k.account_id;
drop table if exists public.s01o_ficha_puesta;
