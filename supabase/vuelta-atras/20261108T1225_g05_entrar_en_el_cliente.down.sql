-- supabase/vuelta-atras/20261108T1225_g05_entrar_en_el_cliente.down.sql
--
-- G05 · Vuelta atrás de la 1225. Los accesos que dio el despacho se APAGAN
-- (active = false) antes de quitar la columna: sin ella no se distinguirían de
-- una persona del equipo del cliente, y seguirían abriendo su cuenta. No se
-- borran. El rastro (conta_despacho_entrada) se va con su tabla.

update public.user_profiles set active = false where advisor_account_id is not null and active;

drop function if exists public.mi_bienvenida_hecha();
drop function if exists public.conta_despacho_donde();
drop function if exists public.conta_despacho_mis_clientes();
drop function if exists public.conta_despacho_volver();
drop function if exists public.conta_despacho_entrar(uuid);
drop function if exists public._conta_despachos_de_quien_llama();
drop table if exists public.conta_despacho_entrada;
drop index if exists public.user_profiles_advisor_idx;
alter table public.user_profiles drop column if exists advisor_account_id;
