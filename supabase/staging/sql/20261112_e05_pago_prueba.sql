-- supabase/staging/sql/20261112_e05_pago_prueba.sql
--
-- SOLO STAGING. Prueba de 20261112T0130 (E05 · tarea 4: el pago contra el
-- saldo prepago y el saldo de la 40700001 «Saldo prepago Catcher»). Todo en
-- una transacción con ROLLBACK: no cambia staging. Datos inventados.
--   1. Con Catcher sin ficha, el pago no se propone y dice qué factura falta.
--   2. Con todas a su cuenta: UN asiento propuesto en la serie de tesorería,
--      una línea al debe por factura (la 41000100 para riders y flota, la de
--      Catcher para su comisión) y el total al haber de la 40700001; lo que
--      baja la 40700001 = lo que suman las facturas = el Excel. Cada factura,
--      con su pago.
--   3. Otra vez: no se crea otro y lo dice.
--   4. El saldo: una recarga de 100 € (propuesta) menos el pago; y el saldo
--      del portal, comparado: coincide, o no y cuánto, y queda apuntado.
--   5. B no propone el pago de A ni ve su saldo.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA E05 pago: esta base tiene cuentas de producción. No se toca nada.';
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
  if to_regprocedure('public.conta_lote_pago_proponer(uuid,text)') is null or to_regclass('public.supplier_balance_check') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'supplier_batch' and column_name = 'payment_entry_id') then
    raise exception 'PRUEBA E05 pago · 0: falta el pago del lote, el saldo o su comprobación.';
  end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select v_acc, v_e, plan, '40700001', '407', 'Saldo prepago Catcher', 'own', 'manual', 'Prueba E05' from public.company_account where company_id = v_e limit 1
  on conflict do nothing;
  raise notice 'PRUEBA E05 pago · 0: el pago del lote, el saldo y su comprobación; la 40700001 «Saldo prepago Catcher».';
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

-- 1 · Como administrador de A: la quincena, con Catcher sin ficha; el pago no se propone.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_l1 text := current_setting('prueba.loc1'); v_l2 text := current_setting('prueba.loc2');
  bien jsonb := '[{"id":"numero","ok":true,"texto":"x"}]';
  fac jsonb; lote jsonb; r jsonb; v_lote uuid; v_falla text; v_entry uuid; v_n int;
begin
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
    jsonb_build_object('numero', 'CMS_2026_09_2', 'tipo', 'catcher', 'fecha', '2026-09-30', 'emisor', jsonb_build_object('nombre', 'Catcher Marketplace SL', 'nif', 'B00000125', 'domicilio', 'Avenida Inventada 5, 28005 Madrid'),
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
  perform set_config('prueba.lote', v_lote::text, true);
  begin
    perform public.conta_lote_pago_proponer(v_lote, 'Prueba E05');
    v_falla := null;
  exception when sqlstate '23514' then v_falla := sqlerrm; end;
  if v_falla is null or v_falla not like '%1 factura sin proveedor o sin su cuenta (CMS_2026_09_2)%' then
    raise exception 'PRUEBA E05 pago · 1: con Catcher sin ficha el pago no para o no dice cuál: %', v_falla;
  end if;
  if (select payment_entry_id from public.supplier_batch where id = v_lote) is not null then raise exception 'PRUEBA E05 pago · 1: ha dejado un pago a medias.'; end if;
  raise notice 'PRUEBA E05 pago · 1: %', v_falla;
end $$;
reset role;

-- Catcher, dado de alta y con su cuenta 410 (como lo haría la pantalla).
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_c uuid; v_ca uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name) values (v_acc, 'Catcher (prueba E05)', 'Catcher Marketplace SL', 'B00000125', true, 'Prueba E05') returning id into v_c;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select v_acc, v_e, plan, '41000201', '4100', 'Catcher Marketplace (prueba E05)', 'own', 'manual', 'Prueba E05' from public.company_account where company_id = v_e limit 1
  returning id into v_ca;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source) values (v_acc, v_e, v_ca, 'supplier', v_c::text, 'principal', 'manual');
  update public.supplier_invoice set supplier_id = v_c where batch_id = current_setting('prueba.lote')::uuid and invoice_number = 'CMS_2026_09_2';
end $$;

-- 2–4 · Como administrador de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_lote uuid := current_setting('prueba.lote')::uuid; r jsonb; v_entry uuid; s jsonb; v_falla text;
begin
  -- 2
  r := public.conta_lote_pago_proponer(v_lote, 'Prueba E05');
  v_entry := (r->>'id')::uuid;
  if r->>'texto' <> 'Propuesto el pago de la 2.ª quincena de septiembre de 2026: 4 facturas, 44,11 € desde la 40700001 «Saldo prepago Catcher» (serie 3).' then
    raise exception 'PRUEBA E05 pago · 2: %', r;
  end if;
  if (select (series, status, source_type, source_id) from public.journal_entry where id = v_entry) is distinct from (3::smallint, 'propuesto'::text, 'supplier_payment'::text, v_lote) then
    raise exception 'PRUEBA E05 pago · 2: el asiento no es un pago propuesto en la serie de tesorería con el lote de origen.';
  end if;
  if (select count(*) from public.journal_line l where l.entry_id = v_entry) <> 5
     or (select sum(l.credit) from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_entry and a.code = '40700001') <> 44.11
     or (select sum(l.debit) from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_entry and a.code = '41000100') <> 40.29
     or (select sum(l.debit) from public.journal_line l join public.company_account a on a.id = l.company_account_id where l.entry_id = v_entry and a.code = '41000201') <> 3.82 then
    raise exception 'PRUEBA E05 pago · 2: las líneas no son una por factura a su cuenta y el total al haber de la 40700001.';
  end if;
  if (select count(*) from public.supplier_invoice where batch_id = v_lote and payment_entry_id = v_entry) <> 4
     or (select payment_entry_id from public.supplier_batch where id = v_lote) <> v_entry then
    raise exception 'PRUEBA E05 pago · 2: las facturas o el lote no quedan con su pago.';
  end if;
  raise notice 'PRUEBA E05 pago · 2: %', r->>'texto';

  -- 3
  r := public.conta_lote_pago_proponer(v_lote, 'Prueba E05');
  if not (r->>'ya_estaba')::boolean or (r->>'id')::uuid <> v_entry or (select count(*) from public.journal_entry where source_type = 'supplier_payment' and source_id = v_lote) <> 1 then
    raise exception 'PRUEBA E05 pago · 3: %', r;
  end if;
  raise notice 'PRUEBA E05 pago · 3: %', r->>'texto';

  -- 4 · Una recarga de 100 € con tarjeta (propuesta, como la dejaría Bancos) y el saldo.
  perform public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 3, 'fecha', '2026-09-20', 'concepto', 'Recarga del saldo prepago de Catcher (prueba E05)', 'source_type', 'manual', 'confianza', 'seguro', 'porque', 'Prueba E05'),
    jsonb_build_array(jsonb_build_object('cuenta', '40700001', 'debe', 100, 'haber', 0, 'local_id', null, 'comun', true),
                      jsonb_build_object('cuenta', '57200000', 'debe', 0, 'haber', 100, 'local_id', null, 'comun', true)), null, 'Prueba E05');
  s := public.conta_catcher_saldo(v_e);
  if (s->>'recargas')::numeric <> 100 or (s->>'pagos')::numeric <> 44.11 or (s->>'saldo')::numeric <> 55.89 or (s->>'saldo_validado')::numeric <> 0 or s->>'nombre' <> 'Saldo prepago Catcher' then
    raise exception 'PRUEBA E05 pago · 4: el saldo no es recargas menos pagos: %', s;
  end if;
  r := public.conta_catcher_saldo_comprobar(v_e, 55.89, 'Prueba E05');
  if not (r->>'coincide')::boolean or r->>'texto' <> 'Coincide: 55,89 € en el portal y en la 40700001. Hay pagos o recargas propuestos sin validar.' then raise exception 'PRUEBA E05 pago · 4: %', r; end if;
  r := public.conta_catcher_saldo_comprobar(v_e, 50, 'Prueba E05');
  if (r->>'coincide')::boolean or r->>'texto' <> 'No coincide: el portal dice 50,00 € y la 40700001 55,89 € (el portal tiene 5,89 € menos). Hay pagos o recargas propuestos sin validar.' then
    raise exception 'PRUEBA E05 pago · 4: %', r;
  end if;
  if (select count(*) from public.supplier_balance_check where company_id = v_e) <> 2
     or (public.conta_catcher_saldo(v_e)->'ultima_comprobacion'->>'coincide')::boolean then
    raise exception 'PRUEBA E05 pago · 4: las comprobaciones no quedan apuntadas (la última, la que no coincide).';
  end if;
  begin perform public.conta_catcher_saldo_comprobar(v_e, null, 'Prueba E05'); v_falla := null;
  exception when sqlstate '22023' then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA E05 pago · 4: ha comparado sin saldo del portal.'; end if;
  raise notice 'PRUEBA E05 pago · 4: saldo 55,89 € (100 de recarga menos 44,11 de pago); el del portal, comparado y apuntado.';
end $$;
reset role;

-- 5 · Como administrador de B.
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin perform public.conta_lote_pago_proponer(current_setting('prueba.lote')::uuid, 'B'); raise exception 'PRUEBA E05 pago · 5: B ha propuesto el pago de A.';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.conta_catcher_saldo('3b34403a-a7d6-4a48-a8d7-737e8cababdc'); raise exception 'PRUEBA E05 pago · 5: B ha visto el saldo de A.';
  exception when sqlstate 'P0002' then null; end;
  if exists (select 1 from public.supplier_balance_check where account_id = 'c01a0000-0000-4000-8000-00000000000a') then raise exception 'PRUEBA E05 pago · 5: B ve las comprobaciones de A.'; end if;
  raise notice 'PRUEBA E05 pago · 5: B no propone el pago de A ni ve su saldo.';
end $$;
reset role;

rollback;
