-- supabase/migrations/20261121T2347_r15b_libro_del_dia.sql
--
-- R15b · El día del TPV en el libro de IVA, como manda la ley. 2 de 3: lo que CAMBIA, por trozos
-- exactos y con su respaldo (si un trozo no está una sola vez, PARA sin tocar nada). Va detrás de la
-- 2346, que añade las piezas.
--   1. conta_tpv_dia_validar: al validar un día, reparte su libro de IVA (_conta_tpv_libro_repartir):
--      por serie, cada factura con NIF y cada devolución (R5) en su fila; su asiento no cambia.
--   2. conta_impuesto_303_cajas: la R5 de un día del TPV va a las casillas 14 y 15 (modificación de
--      bases y cuotas), y no a «no sabe». La [27] suma la [15]: el resultado del 303 no cambia
--      (Julio, 21/11). Las demás rectificativas emitidas, como hasta ahora.
-- Misma firma las dos. Los días ya contabilizados se reparten en la 2350 (con autorizo).
--
-- cambia: public.conta_tpv_dia_validar · prueba: supabase/staging/sql/20261121_r15b_libro_del_dia_prueba.sql
-- cambia: public.conta_impuesto_303_cajas · prueba: supabase/staging/sql/20261121_r15b_libro_del_dia_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261121T2347_r15b_libro_del_dia.down.sql

-- 7 · Por trozos exactos ---------------------------------------------------------------------
do $g$
begin
  if to_regprocedure('public._respaldar_funcion(text,text)') is null then raise exception 'R15b · 2347: falta _respaldar_funcion.'; end if;
end $g$;
select public._respaldar_funcion('public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text)', '20261121T2347_r15b_libro_del_dia')
 where strpos(pg_get_functiondef('public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text)'::regprocedure), 'R15b · el libro del día') = 0;
select public._respaldar_funcion('public.conta_impuesto_303_cajas(public.vat_book_entry)', '20261121T2347_r15b_libro_del_dia')
 where strpos(pg_get_functiondef('public.conta_impuesto_303_cajas(public.vat_book_entry)'::regprocedure), 'R15b · el libro del día') = 0;

do $do$
declare v_def text; v text; n text;
begin
  v_def := pg_get_functiondef('public.conta_tpv_dia_validar(uuid,uuid,integer,text,text,text,integer,text)'::regprocedure);
  if strpos(v_def, 'R15b · el libro del día') = 0 then
    v := $v$  update public.vat_book_entry set number = v_d.primer_numero::text, number_to = v_d.ultimo_numero::text, updated_at = now()
   where entry_id = p_entry and book = 'issued';
$v$;
    n := $n$  update public.vat_book_entry set number = v_d.primer_numero::text, number_to = v_d.ultimo_numero::text, updated_at = now()
   where entry_id = p_entry and book = 'issued';
  -- R15b · el libro del día: por serie, cada factura con NIF y cada devolución (R5) en su fila; la base y la cuota de cada tipo, las mismas.
  perform public._conta_tpv_libro_repartir(p_dia, p_entry);
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R15b · 2347: public.conta_tpv_dia_validar no es la medida (su trozo 1 no está una sola vez): no se toca.'; end if;
    execute replace(v_def, v, n);
  end if;

  v_def := pg_get_functiondef('public.conta_impuesto_303_cajas(public.vat_book_entry)'::regprocedure);
  if strpos(v_def, 'R15b · el libro del día') = 0 then
    v := $v$        when v.book = 'issued' and v.invoice_type like 'R%' then 'rectificativa_expedida'
$v$;
    n := $n$        -- R15b · el libro del día: la devolución de un día del TPV (R5) sí la declara Sumied, en la [14] y la [15].
        when v.book = 'issued' and v.invoice_type = 'R5' and v.source_type = 'sales_day' then null
        when v.book = 'issued' and v.invoice_type like 'R%' then 'rectificativa_expedida'
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R15b · 2347: public.conta_impuesto_303_cajas no es la medida (su trozo 1 no está una sola vez): no se toca.'; end if;
    v_def := replace(v_def, v, n);
    v := $v$        when v.book = 'issued' and v.qualification = 'S1' and not v.reverse_charge then
$v$;
    n := $n$        when v.book = 'issued' and v.invoice_type = 'R5' and v.source_type = 'sales_day' then array['14', '15']
        when v.book = 'issued' and v.qualification = 'S1' and not v.reverse_charge then
$n$;
    if (length(v_def) - length(replace(v_def, v, ''))) / length(v) <> 1 then raise exception 'R15b · 2347: public.conta_impuesto_303_cajas no es la medida (su trozo 2 no está una sola vez): no se toca.'; end if;
    execute replace(v_def, v, n);
  end if;
end $do$;
