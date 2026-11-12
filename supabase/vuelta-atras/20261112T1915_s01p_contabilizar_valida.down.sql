-- supabase/vuelta-atras/20261112T1915_s01p_contabilizar_valida.down.sql
-- Vuelta atrás de la 1915: _compras_liquidacion_confirmar desde su respaldo.
select public._restaurar_funcion('public._compras_liquidacion_confirmar(uuid,text)', '20261112T1915_s01p_contabilizar_valida');
