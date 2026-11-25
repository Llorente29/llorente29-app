-- supabase/vuelta-atras/20261125T1115_r19a_copia_gocardless.down.sql
-- Vuelta atrás del R19 · paso 0: quita las funciones y las dos tablas de la copia de GoCardless, con las copias que
-- haya. Lo leído de GoCardless (conta_gc_cliente, mandato, suscripción y cobro) no se toca.
drop function if exists public.conta_gc_copias(uuid);
drop function if exists public.conta_gc_copia_tomar(uuid, uuid, text, text);
drop function if exists public.conta_gc_contar_copia(uuid, date);
drop table if exists public.conta_gc_copia_fila;
drop table if exists public.conta_gc_copia;
drop function if exists public._conta_gc_copia_no_se_cambia();
