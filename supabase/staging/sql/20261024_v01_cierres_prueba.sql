-- supabase/staging/sql/20261024_v01_cierres_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T1440_v01_cierres (añade) y de
-- 20261024T1441_v01_cierres_cambia (public.conta_pedidos_del_dia,
-- public.conta_dias_por_asentar, public.conta_resumen_ventas,
-- public.conta_venta_cobrar, public.conta_venta_pdf_guardar,
-- public.conta_venta_emitir, public.conta_venta_corregir y
-- public.journal_entry_anular), con \i dentro de la transacción y ROLLBACK:
-- staging no cambia. En la empresa A (Taberna de Prueba Norte, carril 0), con
-- su cierre de Glovo del 24/09 en Norte Centro (2 pedidos, 33,00 €).
--
--   0. Lo de antes: los pedidos del día y los días por asentar, tal cual; las
--      huellas de las ocho funciones que cambian.
--   1. Sin cambios, conta_pedidos_del_dia devuelve lo mismo, fila a fila.
--   2. Como usuario de A: la lista (por validar) y la ficha (2 pedidos).
--   3. Ajustar el importe de uno: el cierre se rehace (otro asiento, propuesto
--      y cuadrado) con el total nuevo; quitar el otro con su motivo; deshacer.
--      Ningún pedido de Folvy cambia (huella de sale antes y después).
--   4. En espera: no se valida; quitado de espera, sí.
--   5. Validar: el asiento con su PDF (resumen_ventas), la factura resumen
--      GLV-2026/00001 emitida y enlazada, el libro con su número; y el asiento
--      no se anula desde Contabilidad.
--   6. Corregir la resumen: «datos» no; «anular» sí, con la rectificativa R5 a
--      la 430 del canal, y la resumen queda anulada.
--   7. Una factura a mano: su PDF queda junto al asiento (factura_expedida); un
--      cobro en efectivo hace su asiento 570 / 430; anularlo quita el cobro.
--   8. B no ve ni toca nada de A.
--   9. Las vueltas atrás, en orden inverso: las funciones, byte a byte como
--      en producción, y lo añadido, fuera.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA V01 CIERRES: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- El ensayo de la rama ya ha pasado la 1440 y la 1441 antes de esta prueba (y la
-- 1440 entra de verdad, porque solo añade): primero sus vueltas atrás, en orden
-- inverso, y desde ahí «lo de antes» es lo de producción.
\i supabase/vuelta-atras/20261024T1441_v01_cierres_cambia.down.sql
\i supabase/vuelta-atras/20261024T1440_v01_cierres.down.sql

create temp table _c (clave text primary key, v text) on commit drop;
grant select, insert, update on _c to authenticated;
insert into _c values
  ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('local', 'c01a0000-0000-4000-8000-0000000000a2'), ('cierre', 'acebcda4-f03a-4f84-bfe4-062a941e60a2');

-- 0 · Lo de antes.
create temp table _antes on commit drop as
  select * from public.conta_pedidos_del_dia('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a2', '2026-09-24');
create temp table _huellas on commit drop as
  select p.proname, md5(pg_get_functiondef(p.oid)) as h from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('conta_pedidos_del_dia', 'conta_dias_por_asentar', 'conta_resumen_ventas', 'conta_venta_cobrar',
                                                 'conta_venta_pdf_guardar', 'conta_venta_emitir', 'conta_venta_corregir', 'journal_entry_anular');
create temp table _ventas on commit drop as
  select md5(string_agg(s::text, '|' order by s.id)) as h from public.sale s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a';
do $$ begin
  if (select count(*) from _huellas) <> 8 then raise exception 'PRUEBA V01 CIERRES · 0: faltan funciones de las que cambian.'; end if;
  if (select count(*) from _antes) = 0 then raise exception 'PRUEBA V01 CIERRES · 0: el 24/09 de Norte Centro no tiene pedidos.'; end if;
  if (select e.status from public.sales_day_summary s join public.journal_entry e on e.id = s.entry_id where s.id = 'acebcda4-f03a-4f84-bfe4-062a941e60a2') <> 'propuesto' then
    raise exception 'PRUEBA V01 CIERRES · 0: el cierre de Glovo del 24/09 no está propuesto.';
  end if;
  raise notice '0 · lo de antes: % pedidos el 24/09, 8 funciones', (select count(*) from _antes);
end $$;

\i supabase/migrations/20261024T1440_v01_cierres.sql
\i supabase/migrations/20261024T1441_v01_cierres_cambia.sql

-- 1 · Sin cambios, lo mismo fila a fila.
do $$ begin
  if exists (select * from _antes except select * from public.conta_pedidos_del_dia('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a2', '2026-09-24'))
     or exists (select * from public.conta_pedidos_del_dia('3b34403a-a7d6-4a48-a8d7-737e8cababdc', 'c01a0000-0000-4000-8000-0000000000a2', '2026-09-24') except select * from _antes) then
    raise exception 'PRUEBA V01 CIERRES · 1: sin cambios, conta_pedidos_del_dia no devuelve lo mismo que antes.';
  end if;
  raise notice '1 · sin cambios, los pedidos del día son los mismos';
end $$;

-- 2 a 7 · Como usuario de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e uuid := (select v::uuid from _c where clave = 'empresa');
  v_cierre uuid := (select v::uuid from _c where clave = 'cierre');
  r jsonb; v_lista jsonb; v_x jsonb; v_p jsonb; v_a uuid; v_b uuid; v_tot_a numeric; v_entry0 uuid; v_entry uuid; v_d numeric; v_h numeric;
begin
  -- 2 · La lista y la ficha.
  v_lista := public.conta_cierres(v_e, '2026-09-01', '2026-09-30');
  select x into v_x from jsonb_array_elements(v_lista) x where x->>'id' = v_cierre::text;
  if v_x is null or v_x->>'estado' <> 'por_validar' or (v_x->>'total')::numeric <> 33 or v_x->>'canal' <> 'Glovo' then
    raise exception 'PRUEBA V01 CIERRES · 2: la lista no trae el cierre de Glovo del 24/09 por validar con 33,00 € (%).', v_x;
  end if;
  v_p := public.conta_cierre_pedidos(v_cierre);
  if jsonb_array_length(v_p) <> 2 or exists (select 1 from jsonb_array_elements(v_p) y where not (y->>'cuenta')::boolean) then
    raise exception 'PRUEBA V01 CIERRES · 2: la ficha no trae los 2 pedidos que cuentan (%).', v_p;
  end if;
  v_a := (v_p->0->>'id')::uuid; v_b := (v_p->1->>'id')::uuid; v_tot_a := (v_p->0->>'total')::numeric;
  v_entry0 := (v_x->>'asiento_id')::uuid;
  raise notice '2 · la lista y la ficha';

  -- 3 · Ajustar el importe del primero (1 € menos): el cierre se rehace.
  r := public.conta_cierre_guardar(v_cierre, jsonb_build_array(jsonb_build_object('pedido', v_a, 'accion', 'importe', 'importe', v_tot_a - 1, 'motivo', 'Prueba: la plataforma cobró 1 € menos')), 'Prueba V01');
  if (r->>'total')::numeric <> 32 or (r->>'antes')::numeric <> 33 then raise exception 'PRUEBA V01 CIERRES · 3: con el importe ajustado el cierre no dice 32,00 (antes 33,00): %.', r; end if;
  v_entry := (r->>'asiento')::uuid;
  if v_entry is null or v_entry = v_entry0 then raise exception 'PRUEBA V01 CIERRES · 3: el cierre no se ha rehecho con otro asiento.'; end if;
  if exists (select 1 from public.journal_entry where id = v_entry0) then raise exception 'PRUEBA V01 CIERRES · 3: el asiento de antes sigue vivo.'; end if;
  select sum(debit), sum(credit) into v_d, v_h from public.journal_line where entry_id = v_entry;
  if v_d <> v_h then raise exception 'PRUEBA V01 CIERRES · 3: el asiento rehecho no cuadra (% / %).', v_d, v_h; end if;
  if (select sum(debit) from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_entry and a.code like '43%') <> 32 then
    raise exception 'PRUEBA V01 CIERRES · 3: el cobro del asiento rehecho no es 32,00.';
  end if;
  v_p := public.conta_cierre_pedidos(v_cierre);
  if not exists (select 1 from jsonb_array_elements(v_p) y where y->>'id' = v_a::text and (y->>'total')::numeric = v_tot_a - 1 and (y->'ajuste'->>'importe_antes')::numeric = v_tot_a) then
    raise exception 'PRUEBA V01 CIERRES · 3: la ficha no dice el importe nuevo con el de antes.';
  end if;
  -- Sin motivo no se quita; con motivo, sí, y el segundo sigue en la ficha (no cuenta).
  begin
    perform public.conta_cierre_guardar(v_cierre, jsonb_build_array(jsonb_build_object('pedido', v_b, 'accion', 'quitar')), 'Prueba V01');
    raise exception 'PRUEBA V01 CIERRES · 3: se ha quitado un pedido sin decir por qué.';
  exception when invalid_parameter_value then null;
  end;
  r := public.conta_cierre_guardar(v_cierre, jsonb_build_array(jsonb_build_object('pedido', v_b, 'accion', 'quitar', 'motivo', 'Prueba: pedido de prueba del local')), 'Prueba V01');
  v_p := public.conta_cierre_pedidos(v_cierre);
  if not exists (select 1 from jsonb_array_elements(v_p) y where y->>'id' = v_b::text and not (y->>'cuenta')::boolean and (y->'ajuste'->>'quitado')::boolean) then
    raise exception 'PRUEBA V01 CIERRES · 3: el quitado no sale en la ficha como quitado.';
  end if;
  -- Deshacer: vuelve a contar.
  r := public.conta_cierre_guardar(v_cierre, jsonb_build_array(jsonb_build_object('pedido', v_b, 'accion', 'deshacer')), 'Prueba V01');
  if (r->>'total')::numeric <> 32 then raise exception 'PRUEBA V01 CIERRES · 3: deshacer el quitar no devuelve el total a 32,00 (%).', r->>'total'; end if;
  insert into _c values ('asiento', r->>'asiento');
  raise notice '3 · ajustar, quitar con motivo y deshacer: el cierre se rehace cada vez';

  -- 4 · En espera.
  perform public.conta_cierre_espera(v_cierre, 'Glovo paga 4,50 € menos de lo que dice el cierre.', 'Prueba V01');
  select x into v_x from jsonb_array_elements(public.conta_cierres(v_e, '2026-09-24', '2026-09-24')) x where x->>'id' = v_cierre::text;
  if v_x->>'estado' <> 'en_espera' or v_x->>'motivo' not like 'Glovo paga%' then raise exception 'PRUEBA V01 CIERRES · 4: en espera no sale en espera con su motivo (%).', v_x; end if;
  begin
    perform public.conta_cierre_validar((r->>'asiento')::uuid, 1, 'X', 'x', 'x.pdf', repeat('a', 64), 1, 'Prueba V01');
    raise exception 'PRUEBA V01 CIERRES · 4: un cierre en espera se ha validado.';
  exception when check_violation then null;
  end;
  perform public.conta_cierre_espera(v_cierre, '', 'Prueba V01');
  raise notice '4 · en espera no se valida; quitado de espera, sí';
end $$;

-- El PDF del cierre, subido (lo haría el navegador).
reset role;
insert into _c select 'ruta', (select account_id::text from public.company where id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc') || '/' || v || '/0123456789abcdef.pdf' from _c where clave = 'asiento';
insert into storage.objects (bucket_id, name, metadata) select 'conta-documentos', v, '{"size": 1234, "mimetype": "application/pdf"}'::jsonb from _c where clave = 'ruta';
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;

do $$
declare
  v_e uuid := (select v::uuid from _c where clave = 'empresa');
  v_entry uuid := (select v::uuid from _c where clave = 'asiento');
  v_ruta text := (select v from _c where clave = 'ruta');
  v_prev jsonb; v_num int; r jsonb; v_f uuid; v_rect uuid; v_n int; v_cta430 text;
begin
  -- 5 · Validar.
  v_prev := public.conta_cierre_factura_prevista(v_entry);
  if v_prev->>'texto' <> 'GLV-2026/00001' then raise exception 'PRUEBA V01 CIERRES · 5: la factura prevista es % y no GLV-2026/00001.', v_prev->>'texto'; end if;
  v_num := public.conta_numero_previsto(v_entry);
  begin
    perform public.conta_cierre_validar(v_entry, v_num, 'GLV-2026/00009', v_ruta, 'ResumenDeVentas_GLV-2026-00001.pdf', repeat('b', 64), 1234, 'Prueba V01');
    raise exception 'PRUEBA V01 CIERRES · 5: se ha validado con un número de factura que no tocaba.';
  exception when serialization_failure then null;
  end;
  r := public.conta_cierre_validar(v_entry, v_num, v_prev->>'texto', v_ruta, 'ResumenDeVentas_GLV-2026-00001.pdf', repeat('b', 64), 1234, 'Prueba V01');
  v_f := (r->>'factura_id')::uuid;
  perform 1 from public.customer_invoice where id = v_f and status = 'emitida' and origin = 'cierre_dia' and number_text = 'GLV-2026/00001'
     and entry_id = v_entry and pdf_path = v_ruta and total = 32 and series_code = 'GLV';
  if not found then raise exception 'PRUEBA V01 CIERRES · 5: la factura resumen no queda emitida, enlazada y por 32,00 (%).',
    (select to_jsonb(c) from public.customer_invoice c where id = v_f); end if;
  if (select status from public.journal_entry where id = v_entry) <> 'validado' then raise exception 'PRUEBA V01 CIERRES · 5: el asiento no está validado.'; end if;
  if not exists (select 1 from public.journal_entry_document where entry_id = v_entry and kind = 'resumen_ventas' and storage_path = v_ruta) then
    raise exception 'PRUEBA V01 CIERRES · 5: el PDF no queda junto al asiento.';
  end if;
  if exists (select 1 from public.vat_book_entry where entry_id = v_entry and book = 'issued' and number is distinct from 'GLV-2026/00001')
     or not exists (select 1 from public.vat_book_entry where entry_id = v_entry and book = 'issued') then
    raise exception 'PRUEBA V01 CIERRES · 5: el libro de expedidas no lleva el número de la factura resumen.';
  end if;
  if not exists (select 1 from public.invoice_series where company_id = v_e and code = 'GLV' and channel_id is not null) then
    raise exception 'PRUEBA V01 CIERRES · 5: no se ha creado la serie GLV del canal.';
  end if;
  if (public.conta_cierre_pedidos((select id from public.sales_day_summary where entry_id = v_entry))) is null then null; end if;
  begin
    perform public.conta_cierre_guardar((select id from public.sales_day_summary where entry_id = v_entry),
      jsonb_build_array(jsonb_build_object('pedido', (select sale_ids[1] from public.sales_day_summary where entry_id = v_entry), 'accion', 'deshacer')), 'Prueba V01');
    raise exception 'PRUEBA V01 CIERRES · 5: un cierre validado se ha cambiado.';
  exception when check_violation then null;
  end;
  begin
    perform public.journal_entry_anular(v_entry, 'Prueba', null, 'Prueba V01');
    raise exception 'PRUEBA V01 CIERRES · 5: el asiento de un cierre con factura se ha anulado desde Contabilidad.';
  exception when check_violation then null;
  end;
  raise notice '5 · validado: asiento con su PDF, GLV-2026/00001 emitida y en el libro; no se cambia ni se anula desde Contabilidad';

  -- 6 · Corregir la resumen.
  begin
    perform public.conta_venta_corregir(v_f, 'datos', 'Prueba', 'Prueba V01');
    raise exception 'PRUEBA V01 CIERRES · 6: se han corregido los datos del cliente de una resumen.';
  exception when invalid_parameter_value then null;
  end;
  r := public.conta_venta_corregir(v_f, 'anular', 'Prueba: el día estaba duplicado', 'Prueba V01');
  v_rect := (r->>'id')::uuid;
  r := public.conta_venta_emitir(v_rect, 'Prueba V01');
  select a.code into v_cta430 from public.journal_line l join public.company_account a on a.id = l.company_account_id
   where l.entry_id = (r->>'asiento')::uuid and a.code like '43%';
  if v_cta430 is distinct from (select a.code from public.journal_line l join public.company_account a on a.id = l.company_account_id
                                 where l.entry_id = v_entry and a.code like '43%' and l.debit > 0 limit 1) then
    raise exception 'PRUEBA V01 CIERRES · 6: la rectificativa no va a la 430 del canal (%).', v_cta430;
  end if;
  select count(*) into v_n from public.vat_book_entry where entry_id = (r->>'asiento')::uuid and invoice_type = 'R5' and corrects_ref = 'GLV-2026/00001';
  if v_n = 0 then raise exception 'PRUEBA V01 CIERRES · 6: la rectificativa no va al libro como R5 de la GLV-2026/00001.'; end if;
  if (select status from public.customer_invoice where id = v_f) <> 'anulada' then raise exception 'PRUEBA V01 CIERRES · 6: la resumen no queda anulada.'; end if;
  raise notice '6 · corregir una resumen: datos no; anular, con su R5 a la 430 del canal';
  insert into _c values ('factura', v_f::text);
end $$;

-- 7 · Una factura a mano: su PDF junto al asiento, y un cobro en efectivo.
do $$
declare
  v_acc uuid := (select v::uuid from _c where clave = 'cuenta');
  v_e uuid := (select v::uuid from _c where clave = 'empresa');
  v_t21 uuid := (select id from public.tax_rate where code = 'iva_general' and company_id is null);
  v_c705 uuid := (select id from public.company_account where company_id = (select v::uuid from _c where clave = 'empresa') and code like '70%' order by code limit 1);
  r jsonb; v_cli uuid; v_f uuid; v_entry uuid; v_cobro uuid; v_d numeric; v_h numeric;
begin
  r := public.party_save_customer(v_acc, null, 'Cliente Prueba Cierres', '12345678Z', '{}'::jsonb, 'Prueba V01');
  v_cli := (r->>'party_id')::uuid;
  r := public.conta_venta_guardar(v_e, null, jsonb_build_object('cliente_id', v_cli, 'fecha', '2026-10-24'),
    jsonb_build_array(jsonb_build_object('concepto', 'Catering', 'cantidad', 1, 'precio', 100, 'descuento', 0, 'tipo_id', v_t21, 'cuenta_id', v_c705)), 'Prueba V01');
  v_f := (r->>'id')::uuid;
  r := public.conta_venta_emitir(v_f, 'Prueba V01');
  v_entry := (r->>'asiento')::uuid;
  insert into _c values ('venta', v_f::text), ('venta_asiento', v_entry::text);

  -- El cobro en efectivo (60 de 121): su asiento 570 / 430, validado.
  r := public.conta_venta_cobrar(v_f, '2026-10-24', 60, 'Efectivo', null, 'Prueba V01');
  v_cobro := (r->>'asiento')::uuid;
  if v_cobro is null or (select status from public.journal_entry where id = v_cobro) <> 'validado' then
    raise exception 'PRUEBA V01 CIERRES · 7: el cobro en efectivo no hace su asiento validado (%).', r;
  end if;
  select sum(l.debit) filter (where a.code like '570%'), sum(l.credit) filter (where a.code like '43%') into v_d, v_h
    from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_cobro;
  if v_d <> 60 or v_h <> 60 then raise exception 'PRUEBA V01 CIERRES · 7: el asiento del cobro no es 570 a 430 por 60 (% / %).', v_d, v_h; end if;
  -- Por banco, sin asiento.
  r := public.conta_venta_cobrar(v_f, '2026-10-24', 10, 'Transferencia', null, 'Prueba V01');
  if r->>'asiento' is not null then raise exception 'PRUEBA V01 CIERRES · 7: un cobro por banco ha hecho asiento.'; end if;
  -- Anular el del efectivo quita el cobro.
  perform public.journal_entry_anular(v_cobro, 'Prueba: no se cobró', null, 'Prueba V01');
  if exists (select 1 from public.customer_invoice_payment where entry_id = v_cobro) then raise exception 'PRUEBA V01 CIERRES · 7: anular el asiento del cobro no lo quita de la factura.'; end if;
  if (select coalesce(sum(amount), 0) from public.customer_invoice_payment where invoice_id = v_f) <> 10 then raise exception 'PRUEBA V01 CIERRES · 7: después de anular, lo cobrado no es 10.'; end if;
  -- Y el asiento de la factura no se anula.
  begin
    perform public.journal_entry_anular(v_entry, 'Prueba', null, 'Prueba V01');
    raise exception 'PRUEBA V01 CIERRES · 7: el asiento de una factura emitida se ha anulado desde Contabilidad.';
  exception when check_violation then null;
  end;
  raise notice '7 · efectivo con su asiento 570 / 430 (anularlo quita el cobro); por banco sin asiento; el de la factura no se anula';
end $$;

reset role;
insert into storage.objects (bucket_id, name, metadata)
select 'conta-documentos', account_id::text || '/ventas/' || id::text || '/fedcba9876543210.pdf', '{"size": 999, "mimetype": "application/pdf"}'::jsonb
  from public.customer_invoice where id = (select v::uuid from _c where clave = 'venta');
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_f uuid := (select v::uuid from _c where clave = 'venta'); v_entry uuid := (select v::uuid from _c where clave = 'venta_asiento'); v_ruta text;
begin
  select account_id::text || '/ventas/' || id::text || '/fedcba9876543210.pdf' into v_ruta from public.customer_invoice where id = v_f;
  perform public.conta_venta_pdf_guardar(v_f, v_ruta, repeat('c', 64), 999);
  if not exists (select 1 from public.journal_entry_document where entry_id = v_entry and kind = 'factura_expedida' and storage_path = v_ruta and file_name ~ '^Factura_[A-Za-z0-9.-]+\.pdf$') then
    raise exception 'PRUEBA V01 CIERRES · 7: el PDF de la factura no queda junto a su asiento.';
  end if;
  raise notice '7 · el PDF de la factura, junto a su asiento (factura_expedida)';
end $$;

-- 8 · B no ve ni toca nada de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
do $$ begin
  begin
    perform public.conta_cierres((select v::uuid from _c where clave = 'empresa'));
    raise exception 'PRUEBA V01 CIERRES · 8: B lee los cierres de A.';
  exception when sqlstate 'P0002' then null;
  end;
  begin
    perform public.conta_cierre_espera((select id from public.sales_day_summary where entry_id = (select v::uuid from _c where clave = 'asiento')), 'B', 'B');
    raise exception 'PRUEBA V01 CIERRES · 8: B pone en espera un cierre de A.';
  exception when sqlstate 'P0002' then null;
  end;
  if exists (select 1 from public.conta_cierre_ajuste) then raise exception 'PRUEBA V01 CIERRES · 8: B ve los cambios de A.'; end if;
  raise notice '8 · B fuera';
end $$;
reset role;

-- Ningún pedido de Folvy ha cambiado.
do $$ begin
  if (select h from _ventas) is distinct from (select md5(string_agg(s::text, '|' order by s.id)) from public.sale s where s.account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA V01 CIERRES · 3: algún pedido de Folvy ha cambiado.';
  end if;
  raise notice '3 · ningún pedido de Folvy ha cambiado (huella de sale, igual)';
end $$;

-- 9 · Las vueltas atrás, en orden inverso.
\i supabase/vuelta-atras/20261024T1441_v01_cierres_cambia.down.sql
\i supabase/vuelta-atras/20261024T1440_v01_cierres.down.sql
do $$
declare v_mal text;
begin
  -- Byte a byte como antes (que es como en producción: lo de antes salió de la misma vuelta atrás).
  select string_agg(h.proname, ', ') into v_mal from _huellas h
    join pg_proc p on p.proname = h.proname join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
   where md5(pg_get_functiondef(p.oid)) <> h.h;
  if (select h from _huellas where proname = 'conta_resumen_ventas') <> 'a933c39820650e004d01beab7508472c' then
    raise exception 'PRUEBA V01 CIERRES · 9: la vuelta atrás no deja conta_resumen_ventas como en producción (a933c398…).';
  end if;
  if v_mal is not null then raise exception 'PRUEBA V01 CIERRES · 9: después de la vuelta atrás no son las de antes: %.', v_mal; end if;
  if to_regclass('public.conta_cierre_ajuste') is not null or to_regclass('public.conta_cierre_espera') is not null
     or exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'invoice_series' and column_name = 'channel_id')
     or exists (select 1 from pg_proc where proname in ('conta_cierres', 'conta_cierre_pedidos', 'conta_cierre_guardar', 'conta_cierre_espera', 'conta_cierre_validar',
                                                     'conta_cierre_factura_prevista', '_conta_cierre_serie', '_conta_cierre_de', '_conta_cierre_rehacer')) then
    raise exception 'PRUEBA V01 CIERRES · 9: la vuelta atrás de la 1440 se deja algo.';
  end if;
  raise notice '9 · las vueltas atrás: las ocho funciones como antes y lo añadido, fuera';
  raise notice 'PRUEBA V01 CIERRES en verde: ajustes, espera, validar con su factura y su PDF, R5, efectivo, no anular, B fuera, vueltas atrás.';
end $$;

rollback;
