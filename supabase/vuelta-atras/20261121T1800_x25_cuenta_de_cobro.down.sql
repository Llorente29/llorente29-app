-- supabase/vuelta-atras/20261121T1800_x25_cuenta_de_cobro.down.sql
--
-- X25 · Vuelta atrás de la 1800: el disparador de antes (de su respaldo). Las cuentas de cobro que se hayan guardado
-- con él se quedan (los enlaces no se tocan); la de antes solo no deja poner otras nuevas que no sean un 57 o un 43.
select public._restaurar_funcion('public.company_account_misma_cuenta()', '20261121T1800_x25_cuenta_de_cobro');
