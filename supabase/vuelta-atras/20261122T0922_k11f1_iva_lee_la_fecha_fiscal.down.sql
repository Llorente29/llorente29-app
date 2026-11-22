-- K11f1 · vuelta atrás de 20261122T0922: las ocho funciones desde su respaldo (el IVA vuelve a leer la fecha del asiento).
-- Va antes que la de la 0921, que quita _conta_fecha_fiscal (la que leen estas).
select public._restaurar_funcion('public.conta_recibida_otros_datos(uuid,jsonb,text)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._restaurar_funcion('public._conta_iva_ajustar_propuesta(uuid,jsonb,jsonb)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._restaurar_funcion('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._restaurar_funcion('public._tg_s01p_trimestre_presentado()', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._restaurar_funcion('public._conta_periodo_admite(uuid)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._restaurar_funcion('public._conta_iva_candado_asiento()', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._restaurar_funcion('public._conta_iva_candado_apunte()', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
select public._restaurar_funcion('public.conta_vat_book_desde_asiento(uuid)', '20261122T0922_k11f1_iva_lee_la_fecha_fiscal');
