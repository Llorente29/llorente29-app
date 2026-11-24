-- supabase/vuelta-atras/20261117T1011_x02_salida_erp10_funciones.down.sql
--
-- X02 · Vuelta atrás de 20261117T1011_x02_salida_erp10_funciones: quita las
-- cinco funciones nuevas. No las llama nada más que la pantalla del 1B, que no
-- existe todavía.

drop function if exists public.conta_erp10_lote_apuntar(uuid, date, jsonb, jsonb, text);
drop function if exists public.conta_erp10_cambiadas(uuid);
drop function if exists public.conta_erp10_por_salir(uuid, date);
drop function if exists public.conta_erp10_salida_poner(uuid, boolean, text, integer, date, text);
drop function if exists public.conta_erp10_subcuenta(text, text, integer);
