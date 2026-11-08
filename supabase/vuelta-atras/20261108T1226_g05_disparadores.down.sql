-- supabase/vuelta-atras/20261108T1226_g05_disparadores.down.sql
--
-- G05 · Vuelta atrás de la 1226: fuera los dos disparadores y sus funciones.
-- Va ANTES que la de la 1225 (la retirada lee advisor_account_id).

drop trigger if exists company_tax_presenter_despacho_retirar on public.company_tax_presenter;
drop function if exists public._conta_despacho_retirar();
drop trigger if exists user_profiles_bienvenida_heredada on public.user_profiles;
drop function if exists public._conta_bienvenida_heredada();
