-- supabase/staging/sql/20261126_w03_como_produccion.sql
--
-- SOLO STAGING. W03 (Julio, 20/10). Va la ÚLTIMA del manifiesto. La primera,
-- 20261126_w03_c06b_y_m01_de_verdad.sql, pone la C06b y la M01 de verdad.
--
-- Por qué hace falta al final: el manifiesto se pasa entero cada vez, en su
-- orden, y vuelve a pasar migraciones viejas DETRÁS de otras más nuevas. La
-- 0110 del I01a (línea ~107) va detrás de la 0180 (línea ~38) y deja
-- conta_impuesto_estado_vale en su versión de antes (staging 7a4d4ac9,
-- producción 09a8e6ae, medido el 20/10). Y la 0180 deja los motivos en la
-- suya, que la 0300 cambia después.
--
-- Lo que hace: vuelve a pasar, en el orden de producción, las dos que dejan
-- esas funciones como producción —la 0180 y la 0300, las dos se pueden volver
-- a pasar— y COMPRUEBA, función a función, que el cuerpo es byte a byte el de
-- producción (md5 de prosrc, medido en producción el 20/10 a las 17:10 UTC,
-- después de la tanda 0300 + 0310). Si una no casa, para y no entra nada de
-- este fichero: el run sale rojo y dice cuál.
--
-- Lo que NO toca, a propósito (staging va por delante con trabajo de otros
-- frentes sin fusionar, o lo que difiere no está en git): _bank_mes_estado y
-- bank_proponer (conta/b02-espera-extracto), compras_ficha_le_falta y
-- compras_mirar (conta/d01-compras-ficha), conta_entrada_llegada
-- (conta/d01-facturas-correo), el TPV de mesas (pos_table_*, _pos_*,
-- pos_floor, pos_void_reasons, order_for_print de tres argumentos,
-- pos_open_sales) y create_account_tx, tg_auto_print_on_accept y
-- upsert_pos_sale (los dos lados llevan un cuerpo que no está en ningún
-- fichero de ninguna rama).

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'W03: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

\i supabase/migrations/20261122T0180_i01b_asiento_303.sql
\i supabase/migrations/20261125T0300_i01d_autoliquidaciones.sql

do $$
declare
  r record;
  v_md5 text;
  v_mal text := '';
begin
  for r in select * from (values
    -- C06b y M01
    ('public.journal_entry_validar(uuid,text)', '87e0ba8d'),
    ('public.tg_journal_entry_envio_por_aclarar()', 'd19ee69b'),
    ('public.conta_cargos_de_pedidos(uuid,uuid[])', 'a2afcca9'),
    ('public.conta_envio_aclarar(uuid,text,text,text)', '768f03f7'),
    ('public.conta_esperan(uuid,date,date)', '1f2415fb'),
    ('public.conta_propuesta_ventas_unidad(uuid,uuid,date,uuid,uuid)', 'dfd76826'),
    ('public.conta_resumen_ventas(uuid)', '62ba30b9'),
    -- I01b (0180) e I01d (0300)
    ('public.conta_impuesto_estado_vale(text,text)', '09a8e6ae'),
    ('public.conta_impuesto_303_contabilizar(uuid)', '0d49306f'),
    ('public.conta_motivos_para_validar(uuid)', 'ddc58afc'),
    ('public.conta_impuesto_303_calcular(uuid,integer,text)', '14472f81'),
    ('public.conta_vat_book_desde_asiento(uuid)', '08eb4f42'),
    ('public.conta_libro_iva_deducir_en(uuid,jsonb,integer,text,text)', 'dda48150'),
    ('public.conta_impuesto_303_desde_libro(uuid,integer,text)', 'b1cee58e'),
    ('public.conta_impuesto_303_cajas(public.vat_book_entry)', 'd1581482'),
    ('public.conta_proveedor_iva_clase(text,text,text,text,text)', 'b68fff08'),
    ('public.conta_pais_nombre(text)', '5e58af06')
  ) as t(firma, md5) loop
    select left(md5(p.prosrc), 8) into v_md5 from pg_proc p where p.oid = to_regprocedure(r.firma);
    if v_md5 is distinct from r.md5 then
      v_mal := v_mal || format(E'\n  %s: producción %s, staging %s', r.firma, r.md5, coalesce(v_md5, 'NO EXISTE'));
    end if;
  end loop;
  if v_mal <> '' then
    raise exception 'W03: staging no queda como producción en:%', v_mal;
  end if;
  raise notice 'W03: las 17 funciones, byte a byte como producción.';
end $$;
