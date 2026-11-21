-- R15b · la vuelta atrás de la 2347: conta_tpv_dia_validar y conta_impuesto_303_cajas vuelven, byte a byte, a como
-- estaban (del respaldo que dejó la 2347). Los días ya repartidos se quedan así hasta la vuelta atrás de la 2346.
select public._restaurar_funcion('public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text)', '20261121T2347_r15b_libro_del_dia');
select public._restaurar_funcion('public.conta_impuesto_303_cajas(public.vat_book_entry)', '20261121T2347_r15b_libro_del_dia');
