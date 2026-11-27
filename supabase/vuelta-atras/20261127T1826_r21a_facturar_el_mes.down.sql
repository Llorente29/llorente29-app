-- supabase/vuelta-atras/20261127T1826_r21a_facturar_el_mes.down.sql
-- Vuelta atrás del R21 · PR 1: quita las cuatro funciones y las dos tablas (lo dejado para después y los vistos buenos).
drop function if exists public.conta_factura_visto_bueno_dar(uuid, date, text, numeric, int);
drop function if exists public.conta_factura_resolver_pendiente(uuid, date);
drop function if exists public.conta_factura_deshacer_pendiente(uuid);
drop function if exists public.conta_factura_dejar(uuid, text, text, date, text, numeric, text);
drop table if exists public.conta_factura_visto_bueno;
drop table if exists public.conta_factura_pendiente;
