-- supabase/staging/sql/20261112_e05_cruces_prueba.sql
--
-- SOLO STAGING. Prueba de 20261112T0120 (E05 · tarea 3: los cruces y «Por
-- aclarar»). Todo en una transacción con ROLLBACK: no cambia staging. Datos
-- inventados. El cruce en sí (pedido a pedido, tarifa, comisión, totales) lo
-- prueba tests/conta/e05/catcherCruces.test.ts; aquí, lo que la base guarda:
--   1. La tarifa: se guarda fechada, se corrige la del mismo día y no admite
--      una sin tramos o con valores que faltan.
--   2. Los pedidos de la app del periodo: la lectura responde (sin escribir).
--   3. El cruce de la quincena con el caso real (G236 cancelado, comisión
--      cobrada, ningún rider): una cosa por aclarar en la factura de Catcher,
--      con su pedido; cada pedido con su venta; el texto dice lo que ha hecho.
--   4. Guardarlo otra vez no duplica nada.
--   5. Decidir: reclamar sin decir qué, no; reclamar y luego dar por bueno, sí;
--      y lo decidido no se vuelve a abrir al cruzar de nuevo.
--   6. B no decide, no cruza y no ve nada de A.
--   (No se crean ventas: sale tiene los disparadores del despacho y de la
--   impresión, y staging es compartido.)

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E05 cruces: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 0 · Preparar (como postgres): la 41000100 con el proveedor «Riders» y los PDF subidos.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_r uuid; v_ca uuid; v_plan text; n int;
begin
  select count(*) into n from information_schema.tables where table_schema = 'public' and table_name in ('supplier_rate', 'supplier_batch_issue');
  if n <> 2 or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_batch_order' and column_name = 'sale_id') then
    raise exception 'PRUEBA E05 cruces · 0: faltan la tarifa, «Por aclarar» o la venta del pedido.';
  end if;
  raise notice 'PRUEBA E05 cruces · 0: la tarifa, «Por aclarar» y la venta de cada pedido.';

  select plan into v_plan from public.company_account where company_id = v_e limit 1;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  values (v_acc, v_e, v_plan, '41000100', '4100', 'Acreedores · RIDERS (prueba E05)', 'own', 'manual', 'Prueba E05')
  on conflict do nothing;
  select id into v_ca from public.company_account where company_id = v_e and code = '41000100';
  insert into public.supplier (account_id, name, legal_name, is_active, created_by_name) values (v_acc, 'Riders (prueba E05)', 'Riders', true, 'Prueba E05') returning id into v_r;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_r::text, 'principal', 'manual');
  insert into storage.objects (bucket_id, name, metadata)
  select 'receipt-uploads', v_acc::text || '/e05-prueba/' || x || '.pdf', '{"size": 2000, "mimetype": "application/pdf"}'
    from unnest(array['r1', 'r2', 'f1', 'c1', 'r9']) x;
  perform set_config('prueba.riders', v_r::text, true);
  perform set_config('prueba.loc1', (select id::text from public.locations where account_id = v_acc order by created_at limit 1), true);
  perform set_config('prueba.loc2', (select id::text from public.locations where account_id = v_acc order by created_at offset 1 limit 1), true);
end $$;

-- 1–5 · Como administrador de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_l1 text := current_setting('prueba.loc1'); v_l2 text := current_setting('prueba.loc2');
  bien jsonb := '[{"id":"numero","ok":true,"texto":"x"}]';
  tarifa jsonb := '{"tramos":[{"hastaKm":1,"precio":4},{"hastaKm":2,"precio":4.2},{"hastaKm":3,"precio":4.7}],"porKmExtra":0.5,"maximo":12,"bonoLluviaPct":10,"bonoDemandaPct":10,"bonoMaxPct":15,"pedidoExtra":2.5,"comisionPedido":0.79}';
  fac jsonb; lote jsonb; r jsonb; v_lote uuid; v_falla text; cruce jsonb; v_issue uuid; v_venta constant uuid := 'e05e0000-0000-4000-8000-000000000001';
begin
  -- 1 · La tarifa.
  r := public.conta_tarifa_guardar(v_e, 'catcher', '2026-09-01', tarifa, 'Prueba E05');
  if r->>'texto' <> 'Guardada la tarifa de Catcher: vale desde el 01/09/2026.' then raise exception 'PRUEBA E05 cruces · 1: %', r; end if;
  r := public.conta_tarifa_guardar(v_e, 'catcher', '2026-09-01', jsonb_set(tarifa, '{comisionPedido}', '0.8'), 'Prueba E05');
  if r->>'texto' <> 'Corregida la tarifa de Catcher que vale desde el 01/09/2026.'
     or (select (params->>'comisionPedido')::numeric from public.supplier_rate where company_id = v_e and valid_from = '2026-09-01') <> 0.8
     or (select count(*) from public.supplier_rate where company_id = v_e) <> 1 then
    raise exception 'PRUEBA E05 cruces · 1: la del mismo día no se corrige: %', r;
  end if;
  perform public.conta_tarifa_guardar(v_e, 'catcher', '2026-10-14', tarifa, 'Prueba E05');
  begin perform public.conta_tarifa_guardar(v_e, 'catcher', '2026-11-01', '{"tramos":[]}', 'Prueba E05'); v_falla := null;
  exception when sqlstate '22023' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA E05 cruces · 1: ha guardado una tarifa sin tramos.'; end if;
  begin perform public.conta_tarifa_guardar(v_e, 'catcher', '2026-11-01', tarifa - 'comisionPedido', 'Prueba E05'); v_falla := null;
  exception when sqlstate '22023' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA E05 cruces · 1: ha guardado una tarifa sin comisión.'; end if;
  raise notice 'PRUEBA E05 cruces · 1: la tarifa se guarda fechada (2 versiones), se corrige la del mismo día y no admite una sin tramos o sin comisión.';

  fac := jsonb_build_array(
    jsonb_build_object('numero', 'ES_I_1001_26_7', 'tipo', 'rider', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'RIDER INVENTADO UNO', 'nif', '00000001-R', 'domicilio', 'Calle Falsa 1, 28001 Madrid'),
      'base', 8.2, 'cuota', 1.72, 'total', 9.92, 'tipoIva', 21, 'pedidos', 2, 'periodo', '{"desde":"2026-09-16","hasta":"2026-09-30"}'::jsonb, 'localId', v_l1,
      'reparto', jsonb_build_array(jsonb_build_object('tienda', 'FoodInt Camichi', 'localId', v_l1, 'total', 8.2)), 'requisitos', bien, 'contraPdf', bien, 'confianza', 'seguro',
      'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/r1.pdf', 'nombre', 'invoice_1001_ES_I_1001_26_7.pdf', 'sha256', repeat('a1', 32), 'bytes', 2000)),
    jsonb_build_object('numero', 'ES_I_1002_26_7', 'tipo', 'rider', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'RIDER INVENTADA DOS', 'nif', 'X0000002T', 'domicilio', 'Calle Falsa 2, 28002 Madrid'),
      'base', 20.4, 'cuota', 4.28, 'total', 24.68, 'tipoIva', 21, 'pedidos', 5, 'periodo', '{"desde":"2026-09-16","hasta":"2026-09-30"}'::jsonb, 'localId', null,
      'reparto', jsonb_build_array(jsonb_build_object('tienda', 'FoodInt Camichi', 'localId', v_l1, 'total', 12.24), jsonb_build_object('tienda', 'FoodInt Florencio Llorente', 'localId', v_l2, 'total', 8.16)),
      'requisitos', bien, 'contraPdf', bien, 'confianza', 'duda',
      'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/r2.pdf', 'nombre', 'invoice_1002_ES_I_1002_26_7.pdf', 'sha256', repeat('a2', 32), 'bytes', 2000)),
    jsonb_build_object('numero', 'ES_F_2001_26_7', 'tipo', 'flota', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'FLOTA INVENTADA, S.L.', 'nif', 'B00000044', 'domicilio', 'Polígono Inventado 4, 28004 Madrid'),
      'base', 4.7, 'cuota', 0.99, 'total', 5.69, 'tipoIva', 21, 'pedidos', 1, 'periodo', '{"desde":"2026-09-16","hasta":"2026-09-30"}'::jsonb, 'localId', v_l2,
      'reparto', '[]'::jsonb, 'requisitos', bien, 'contraPdf', bien, 'confianza', 'seguro',
      'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/f1.pdf', 'nombre', 'invoice_fleet_2001_ES_F_2001_26_7.pdf', 'sha256', repeat('a3', 32), 'bytes', 2000)),
    jsonb_build_object('numero', 'CMS_2026_09_2', 'tipo', 'catcher', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'Catcher Marketplace SL', 'nif', 'B00000055', 'domicilio', 'Avenida Inventada 5, 28005 Madrid'),
      'base', 3.16, 'cuota', 0.66, 'total', 3.82, 'tipoIva', 21, 'pedidos', 4, 'periodo', '{"desde":"2026-09-16","hasta":"2026-09-30"}'::jsonb, 'localId', v_l1,
      'reparto', '[]'::jsonb, 'requisitos', bien, 'contraPdf', bien, 'confianza', 'seguro',
      'pdf', jsonb_build_object('ruta', v_acc::text || '/e05-prueba/c1.pdf', 'nombre', 'invoice_3001_CMS_2026_09_2.pdf', 'sha256', repeat('a4', 32), 'bytes', 2000)));
  lote := jsonb_build_object('proveedor', 'catcher', 'desde', '2026-09-16', 'hasta', '2026-09-30', 'etiqueta', '2.ª quincena de septiembre de 2026',
    'ficheros', '[{"clase":"zip","nombre":"q.zip"},{"clase":"facturas","nombre":"f.xlsx"},{"clase":"pedidos","nombre":"p.xlsx"}]'::jsonb,
    'avisos', '[]'::jsonb, 'facturas', fac,
    'pedidos', jsonb_build_array(
      jsonb_build_object('factura', 'ES_I_1001_26_7', 'tipo', 'rider to pitcher', 'codigo', 'G901', 'estado', 'finish', 'momento', '2026-09-16T11:05:00Z', 'base', 4.2, 'cuota', 0.88, 'total', 5.08),
      jsonb_build_object('factura', 'ES_I_1001_26_7', 'tipo', 'rider to pitcher', 'codigo', 'G901', 'estado', 'finish', 'momento', '2026-09-27T18:15:00Z', 'base', 4.0, 'cuota', 0.84, 'total', 4.84),
      jsonb_build_object('factura', 'CMS_2026_09_2', 'tipo', 'pitcher commissions', 'codigo', 'G236', 'estado', 'canceled', 'momento', '2026-09-23T14:29:00Z', 'base', 0.79, 'cuota', 0.17, 'total', 0.96)));

  r := public.conta_lote_registrar(v_e, lote, 'Prueba E05');
  v_lote := (r->>'lote_id')::uuid;

  -- 2 · Lo que la app mandó a Catcher en el periodo (aquí, nada: no se crean ventas).
  r := public.conta_lote_pedidos_app(v_lote);
  if jsonb_typeof(r) <> 'array' then raise exception 'PRUEBA E05 cruces · 2: la lectura de pedidos no da una lista: %', r; end if;
  raise notice 'PRUEBA E05 cruces · 2: los pedidos de la app del periodo: % (lista, solo lectura).', jsonb_array_length(r);

  -- 3 · El cruce con el caso real, como lo deja catcherCruces.ts.
  cruce := jsonb_build_object(
    'facturas', jsonb_build_object('ES_I_1001_26_7', '{"estado":"seguro","aclarar":0}'::jsonb, 'ES_I_1002_26_7', '{"estado":"aclarar","aclarar":0}'::jsonb,
                                   'ES_F_2001_26_7', '{"estado":"seguro","aclarar":0}'::jsonb, 'CMS_2026_09_2', '{"estado":"aclarar","aclarar":1}'::jsonb),
    'porAclarar', jsonb_build_array(jsonb_build_object('motivo', 'comision_sin_entrega', 'factura', 'CMS_2026_09_2',
                    'pedido', jsonb_build_object('codigo', 'G236', 'momento', '2026-09-23T14:29:00.000Z'), 'diferencia', 79,
                    'texto', 'G236 del 23/09 a las 16:29: cancelado, con comisión cobrada (0,79 €) y ningún rider que lo facture.')),
    'casados', jsonb_build_object('ES_I_1001_26_7|G901|2026-09-16T11:05:00.000Z', v_venta),
    'totales', '{"comisionEsperada":7.11,"comisionCobrada":7.9}'::jsonb, 'coste', '[]'::jsonb);
  r := public.conta_lote_cruce_guardar(v_lote, cruce, 'Prueba E05');
  if r->>'texto' <> 'Cruzada la 2.ª quincena de septiembre de 2026: 4 facturas, 2 cuadran y 2 por aclarar (1 cosa que mirar).' then raise exception 'PRUEBA E05 cruces · 3: %', r; end if;
  select id into v_issue from public.supplier_batch_issue where batch_id = v_lote;
  if (select count(*) from public.supplier_batch_issue where batch_id = v_lote) <> 1
     or (select (reason, order_code, ordered_at, status, difference_cents) from public.supplier_batch_issue where id = v_issue)
        is distinct from ('comision_sin_entrega'::text, 'G236'::text, '2026-09-23T14:29:00Z'::timestamptz, 'abierta'::text, 79)
     or (select f.invoice_number from public.supplier_batch_issue i join public.supplier_invoice f on f.id = i.supplier_invoice_id where i.id = v_issue) <> 'CMS_2026_09_2' then
    raise exception 'PRUEBA E05 cruces · 3: el G236 no queda por aclarar en la factura de Catcher con su pedido.';
  end if;
  if (select sale_id from public.supplier_batch_order where batch_id = v_lote and order_code = 'G901' and ordered_at = '2026-09-16T11:05:00Z') is distinct from v_venta
     or (select count(*) from public.supplier_batch_order where batch_id = v_lote and sale_id is not null) <> 1 then
    raise exception 'PRUEBA E05 cruces · 3: el G901 del 16/09 no queda casado con su venta (y solo él).';
  end if;
  if (select reading_confidence from public.supplier_invoice where batch_id = v_lote and invoice_number = 'ES_I_1001_26_7') <> 'seguro'
     or (select reading_confidence from public.supplier_invoice where batch_id = v_lote and invoice_number = 'CMS_2026_09_2') <> 'duda'
     or (select reading->'cruce'->>'aclarar' from public.supplier_invoice where batch_id = v_lote and invoice_number = 'CMS_2026_09_2') <> '1'
     or (select cross_summary->>'abiertas' from public.supplier_batch where id = v_lote) <> '1' then
    raise exception 'PRUEBA E05 cruces · 3: las facturas no quedan seguras o por aclarar como dice el cruce.';
  end if;
  raise notice 'PRUEBA E05 cruces · 3: %', r->>'texto';

  begin perform public.conta_lote_cruce_guardar(v_lote, cruce - 'facturas', 'Prueba E05'); v_falla := null;
  exception when sqlstate '22023' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA E05 cruces · 3: ha guardado un cruce sin sus facturas.'; end if;

  -- 4
  perform public.conta_lote_cruce_guardar(v_lote, cruce, 'Prueba E05');
  if (select count(*) from public.supplier_batch_issue where batch_id = v_lote) <> 1 then raise exception 'PRUEBA E05 cruces · 4: cruzar otra vez ha duplicado lo por aclarar.'; end if;
  select id into v_issue from public.supplier_batch_issue where batch_id = v_lote;
  raise notice 'PRUEBA E05 cruces · 4: cruzar otra vez no duplica nada.';

  -- 5
  begin perform public.conta_lote_aclarar(v_issue, 'reclamada', '  ', 'Prueba E05'); v_falla := null;
  exception when sqlstate '22023' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA E05 cruces · 5: ha reclamado sin decir qué.'; end if;
  r := public.conta_lote_aclarar(v_issue, 'reclamada', 'Comisión de un pedido cancelado', 'Prueba E05');
  if r->>'texto' <> 'Apuntado para reclamar a Catcher (G236). A su factura le queda 1 cosa.' then raise exception 'PRUEBA E05 cruces · 5: %', r; end if;
  r := public.conta_lote_aclarar(v_issue, 'aceptada', 'Catcher lo devuelve en la siguiente', 'Prueba E05');
  if r->>'texto' <> 'Dado por bueno (G236). A su factura no le queda nada por aclarar.' then raise exception 'PRUEBA E05 cruces · 5: %', r; end if;
  -- La de Catcher no tiene ficha: era «duda» al leerla, y sigue siéndolo aunque se aclare.
  if (select reading_confidence from public.supplier_invoice where batch_id = v_lote and invoice_number = 'CMS_2026_09_2') <> 'duda' then
    raise exception 'PRUEBA E05 cruces · 5: una factura que no era segura al leerla se ha vuelto segura al aclarar.';
  end if;
  perform public.conta_lote_cruce_guardar(v_lote, cruce, 'Prueba E05');
  if (select count(*) from public.supplier_batch_issue where batch_id = v_lote and status = 'abierta') <> 0
     or (select count(*) from public.supplier_batch_issue where batch_id = v_lote) <> 1 then
    raise exception 'PRUEBA E05 cruces · 5: cruzar otra vez ha vuelto a abrir lo decidido.';
  end if;
  raise notice 'PRUEBA E05 cruces · 5: reclamar sin decir qué, no; reclamar y dar por bueno, sí; y lo decidido no se reabre al cruzar otra vez.';
  perform set_config('prueba.lote', v_lote::text, true);
  perform set_config('prueba.issue', v_issue::text, true);
end $$;
reset role;

-- 6 · Como administrador de B.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin perform public.conta_lote_aclarar(current_setting('prueba.issue')::uuid, 'abierta', null, 'B'); raise exception 'PRUEBA E05 cruces · 6: B ha decidido en A.';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.conta_lote_cruce_guardar(current_setting('prueba.lote')::uuid, '{"facturas":{},"porAclarar":[]}', 'B'); raise exception 'PRUEBA E05 cruces · 6: B ha cruzado un lote de A.';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.conta_lote_pedidos_app(current_setting('prueba.lote')::uuid); raise exception 'PRUEBA E05 cruces · 6: B ha leído los pedidos de A.';
  exception when sqlstate 'P0002' then null; end;
  if exists (select 1 from public.supplier_batch_issue where batch_id = current_setting('prueba.lote')::uuid)
     or exists (select 1 from public.supplier_rate where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA E05 cruces · 6: B ve lo por aclarar o la tarifa de A.';
  end if;
  raise notice 'PRUEBA E05 cruces · 6: B no decide, no cruza, no lee los pedidos y no ve nada de A.';
end $$;
reset role;

rollback;
