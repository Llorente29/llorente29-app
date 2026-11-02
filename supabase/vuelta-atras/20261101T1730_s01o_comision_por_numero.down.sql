-- supabase/vuelta-atras/20261101T1730_s01o_comision_por_numero.down.sql
--
-- Vuelta atrás de la 1730: _conta_comision_buscar como estaba (su respaldo) y fuera la búsqueda por número.
-- Las facturas que ya ligó por su número se quedan ligadas (lo hace la 1732, que tiene su propia vuelta atrás).
select public._restaurar_funcion('public._conta_comision_buscar(uuid)', '20261101T1730_s01o_comision_por_numero');
drop function if exists public._conta_comision_de_su_numero(uuid);
