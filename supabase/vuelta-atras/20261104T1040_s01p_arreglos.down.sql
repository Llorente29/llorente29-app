-- supabase/vuelta-atras/20261104T1040_s01p_arreglos.down.sql
-- Vuelta atrás de la 1040: las dos funciones, las de antes (desde su respaldo),
-- y fuera lo que añadía (conta_esperadas_del_mes y el disparador de la factura).
-- El aviso de Compras vuelve a su texto de antes antes de quitar la función que usa.
select public._restaurar_funcion('public.conta_esperadas_no_llegadas(uuid,date)', '20261104T1040_s01p_arreglos');
select public._restaurar_funcion('public.conta_puerta_fuentes_proponer(uuid)', '20261104T1040_s01p_arreglos');
drop trigger if exists s01p_factura_su_asiento on public.journal_entry;
drop function if exists public._tg_s01p_factura_su_asiento();
drop function if exists public._s01p_factura_su_asiento(uuid, uuid);
drop function if exists public._s01p_asiento_de_factura(uuid, uuid);
drop function if exists public.conta_esperadas_del_mes(uuid, date);
