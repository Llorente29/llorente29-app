-- supabase/vuelta-atras/20261118T1951_e04_pasar_sola_al_leer.down.sql
--
-- E04 · Vuelta atrás de la 1951: fuera el disparador que la pasa sola al leerla, y
-- «Pasarla» vuelve a su definición de antes (su respaldo, con su huella). Va
-- después de la de la 1952 y antes que la de la 1950.
drop trigger if exists e04_pasar_sola on public.supplier_invoice;
drop function if exists public.tg_e04_pasar_sola();
select public._restaurar_funcion('public.conta_recibida_pasar_a(uuid,uuid,text)', '20261118T1951_e04_pasar_sola_al_leer');
