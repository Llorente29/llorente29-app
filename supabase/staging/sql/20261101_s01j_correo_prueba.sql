-- supabase/staging/sql/20261101_s01j_correo_prueba.sql
--
-- S01j · Prueba en ROLLBACK de la tanda claude/s01j-liquidaciones-por-correo
-- (0845 y 0846), con la cuenta D de staging y todo inventado (T11):
--
--   1. Glovo: la liquidación del Excel del correo y su factura (el PDF) quedan
--      ligadas; el mismo correo leído otra vez no crea nada (ni liquidación ni
--      factura).
--   2. Just Eat: la liquidación del correo sustituye a la antigua sin periodo con
--      su número (je:<n>); su factura de comisión, escrita en el correo, entra
--      «Por revisar» ligada a su liquidación; otra vez, «ya estaba».
--   3. Una factura del correo que no suma: la liquidación entra igual, y la
--      factura en revisión con el porqué.
--   4. Una antigua con algo ligado (un cobro) no se toca.
--   5. conta_correo_releer_lista, como persona: los de Glovo de su empresa; un
--      remitente que no es Glovo ni Just Eat, error.
--   6. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01j: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- Lo del S01h y el S01i (ya en producción): se pueden pasar dos veces.
\i supabase/migrations/20261031T1850_s01h_pago_por_compensacion.sql
\i supabase/migrations/20261101T0050_s01i_comision_liquidacion.sql
\i supabase/migrations/20261101T0051_s01i_comision_sin_banco.sql
\i supabase/migrations/20261101T0845_s01j_comision_del_correo.sql
\i supabase/migrations/20261101T0846_s01j_antiguas_sin_periodo.sql

-- Preparar: dos plataformas inventadas (canal, proveedor y su tercero) en la cuenta D.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_canal uuid; v_sup uuid; v_party uuid; r record;
begin
  for r in select * from (values ('glovo', 'Glovo de prueba S01j', 'B00000193'), ('justeat', 'Just Eat de prueba S01j', 'B00000194')) x(prov, nombre, nif) loop
    insert into public.sales_channel (account_id, name, slug) values (v_acc, r.nombre, r.prov || '-s01j') returning id into v_canal;
    insert into public.supplier (account_id, name, tax_id) values (v_acc, r.nombre || ', S.L.', r.nif) returning id into v_sup;
    select party_id into v_party from public.party_role where account_id = v_acc and role = 'supplier' and supplier_id = v_sup;
    if v_party is null then
      insert into public.party (account_id, name) values (v_acc, r.nombre || ', S.L.') returning id into v_party;
      insert into public.party_role (account_id, party_id, role, supplier_id) values (v_acc, v_party, 'supplier', v_sup);
    end if;
    insert into public.party_role (account_id, party_id, role, channel_id) values (v_acc, v_party, 'platform', v_canal);
    -- Una tienda de la plataforma ya conocida (con su canal), como las que reconoce conta_tienda_reconocer.
    insert into public.platform_store (account_id, company_id, provider, external_id, external_text, channel_id)
    values (v_acc, v_e, r.prov, 'S01J-' || upper(r.prov), 'Marca de Prueba S01j (Calle Inventada 12)', v_canal);
    perform set_config('prueba.canal_' || r.prov, v_canal::text, true);
    perform set_config('prueba.sup_' || r.prov, v_sup::text, true);
  end loop;
  perform set_config('prueba.acc', v_acc::text, true);
  perform set_config('prueba.e', v_e::text, true);
end $$;

-- 1 · Glovo: la liquidación del Excel y su factura (el PDF), ligadas; otra vez, nada nuevo.
do $$
declare
  v_e uuid := current_setting('prueba.e')::uuid; d jsonb; r jsonb; r2 jsonb; v_inv uuid; v_n int;
begin
  d := jsonb_build_object('proveedor', 'glovo', 'origen', 'excel', 'tienda', 'Marca de Prueba S01j (Calle Inventada 12)', 'tienda_id', 'S01J-GLOVO',
         'desde', '2026-10-01', 'hasta', '2026-10-15', 'pedidos', 31, 'ventas', jsonb_build_object('total', 218.00), 'comision', 43.23, 'otros', 61.50, 'neto', 236.27,
         'referencia', 'I000000000000001', 'factura', jsonb_build_object('numero', 'I000000000000001', 'base', 35.73, 'iva', 7.50, 'total', 43.23),
         'intermediario', jsonb_build_object('nombre', 'Glovo de prueba S01j, S.L.', 'nif', 'B00000193'), 'email_id', 'correo-prueba-s01j-1');
  r := public.conta_liquidacion_registrar(v_e, d, 'Prueba S01j');
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA S01j · 1: la primera vez dice que ya estaba: %', r; end if;
  -- El PDF del mismo correo, como lo deja el lector: su factura de comisión, con su periodo.
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, tax_base_total, tax_total, status, source, created_by_name, reading)
  values (current_setting('prueba.acc')::uuid, v_e, current_setting('prueba.sup_glovo')::uuid, 'PRUEBA-S01J-G1', '2026-10-15', 43.23, 35.73, 7.50, 'en_revision', 'manual', 'Prueba S01j',
          jsonb_build_object('factura', jsonb_build_object('periodo', jsonb_build_object('desde', '2026-10-01', 'hasta', '2026-10-15'))))
  returning id into v_inv;
  if not exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v_inv and settlement_id = (r->>'liquidacion_id')::uuid) then
    raise exception 'PRUEBA S01j · 1: la factura de Glovo no se ha ligado a la liquidación de su Excel: %', public._conta_comision_estado(v_inv);
  end if;
  -- El mismo correo, otra vez (volver a leer): la misma liquidación, ninguna nueva.
  r2 := public.conta_liquidacion_registrar(v_e, d, 'Prueba S01j');
  select count(*) into v_n from public.channel_settlement where account_id = current_setting('prueba.acc')::uuid and channel_id = current_setting('prueba.canal_glovo')::uuid;
  if not (r2->>'ya_estaba')::boolean or r2->>'liquidacion_id' <> r->>'liquidacion_id' or v_n <> 1 then
    raise exception 'PRUEBA S01j · 1: leer otra vez el Excel duplica la liquidación: % (hay %)', r2, v_n;
  end if;
  if (select inbound_email_id from public.channel_settlement where id = (r->>'liquidacion_id')::uuid) is distinct from 'correo-prueba-s01j-1' then
    raise exception 'PRUEBA S01j · 1: la liquidación no guarda de qué correo llegó.';
  end if;
  raise notice 'PRUEBA S01j · 1: Glovo: liquidación del Excel y su factura ligadas; leído otra vez, nada nuevo («%»).', r2->>'texto';
end $$;

-- 2 · Just Eat: sustituye a la antigua sin periodo, y su factura del correo entra ligada; otra vez, «ya estaba».
do $$
declare
  v_acc uuid := current_setting('prueba.acc')::uuid; v_e uuid := current_setting('prueba.e')::uuid; d jsonb; r jsonb; f jsonb; f2 jsonb; v_old uuid; v_inv uuid;
begin
  insert into public.channel_settlement (account_id, channel_id, settlement_date, net_payout, source, import_key, created_by_name)
  values (v_acc, current_setting('prueba.canal_justeat')::uuid, '2026-06-30', 50.00, 'import_csv_je', 'je:4000001', 'Prueba S01j') returning id into v_old;
  d := jsonb_build_object('proveedor', 'justeat', 'origen', 'correo', 'tienda', 'Marca de Prueba S01j (Calle Inventada 12)', 'tienda_id', null, 'marca', 'Marca de Prueba S01j',
         'desde', '2026-06-16', 'hasta', '2026-06-30', 'pedidos', 12, 'ventas', jsonb_build_object('total', 144.02), 'comision', 32.79, 'otros', -20.93, 'neto', 90.30,
         'referencia', '4000009', 'referencia_asunto', '4000001', 'fecha_factura', '2026-07-01', 'pago_el', '2026-07-10',
         'factura', jsonb_build_object('numero', '4000009', 'base', 27.10, 'iva', 5.69, 'total', 32.79),
         'intermediario', jsonb_build_object('nombre', 'Just Eat de prueba S01j, S.L.', 'nif', 'B00000194'), 'email_id', 'correo-prueba-s01j-2');
  r := public.conta_liquidacion_registrar(v_e, d, 'Prueba S01j');
  if exists (select 1 from public.channel_settlement where id = v_old) then
    raise exception 'PRUEBA S01j · 2: la antigua sin periodo (je:4000001) sigue: hay dos.';
  end if;
  if (select raw->'sustituye'->>'import_key' from public.channel_settlement where id = (r->>'liquidacion_id')::uuid) is distinct from 'je:4000001' then
    raise exception 'PRUEBA S01j · 2: la nueva no dice a cuál sustituye.';
  end if;
  f := public.conta_comision_del_correo((r->>'liquidacion_id')::uuid, d);
  v_inv := (f->>'factura_id')::uuid;
  if f->>'estado' <> 'creada' or (select status from public.supplier_invoice where id = v_inv) <> 'en_revision'
     or (select invoice_number from public.supplier_invoice where id = v_inv) <> '4000009'
     or (select invoice_date from public.supplier_invoice where id = v_inv) <> date '2026-07-01'
     or not exists (select 1 from public.channel_settlement_invoice where supplier_invoice_id = v_inv and settlement_id = (r->>'liquidacion_id')::uuid)
     or not exists (select 1 from public.supplier_invoice_tax where supplier_invoice_id = v_inv and base = 27.10 and vat_amount = 5.69) then
    raise exception 'PRUEBA S01j · 2: la factura de Just Eat no ha entrado bien: %', f;
  end if;
  f2 := public.conta_comision_del_correo((r->>'liquidacion_id')::uuid, d);
  if f2->>'estado' <> 'ya_estaba' or (f2->>'factura_id')::uuid <> v_inv
     or (select count(*) from public.supplier_invoice where account_id = v_acc and invoice_number = '4000009') <> 1 then
    raise exception 'PRUEBA S01j · 2: leer otra vez la factura la duplica: %', f2;
  end if;
  raise notice 'PRUEBA S01j · 2: Just Eat: sustituye a la antigua sin periodo; «%»; otra vez: «%»', f->>'texto', f2->>'texto';
end $$;

-- 3 · Una factura del correo que no suma: en revisión, con el porqué; nada inventado.
do $$
declare v_e uuid := current_setting('prueba.e')::uuid; d jsonb; r jsonb; f jsonb; v_inv uuid;
begin
  d := jsonb_build_object('proveedor', 'justeat', 'origen', 'correo', 'tienda', 'Marca de Prueba S01j (Calle Inventada 12)', 'marca', 'Marca de Prueba S01j',
         'desde', '2026-07-01', 'hasta', '2026-07-15', 'pedidos', 3, 'ventas', jsonb_build_object('total', 50.00), 'comision', 32.90, 'otros', 0, 'neto', 17.10,
         'referencia', '4000010', 'factura', jsonb_build_object('numero', '4000010', 'base', 27.10, 'iva', 5.69, 'total', 32.90), 'email_id', 'correo-prueba-s01j-3');
  -- Como la entrada de correo: la liquidación, sin su factura (no suma); la factura, aparte.
  r := public.conta_liquidacion_registrar(v_e, d || jsonb_build_object('factura', null), 'Prueba S01j');
  f := public.conta_comision_del_correo((r->>'liquidacion_id')::uuid, d);
  v_inv := (f->>'factura_id')::uuid;
  if f->>'estado' <> 'en_revision' or not (select needs_review from public.supplier_invoice where id = v_inv)
     or (select grand_total from public.supplier_invoice where id = v_inv) <> 32.90
     or (select notes from public.supplier_invoice where id = v_inv) not like 'La factura no suma: base 27,10 € + IVA 5,69 € no es el total 32,90 €%' then
    raise exception 'PRUEBA S01j · 3: la que no suma no dice por qué: %', f;
  end if;
  raise notice 'PRUEBA S01j · 3: «%»', f->>'texto';
end $$;

-- 4 · Una antigua con algo ligado (un cobro) no se toca.
do $$
declare v_acc uuid := current_setting('prueba.acc')::uuid; v_e uuid := current_setting('prueba.e')::uuid; v_old uuid; r jsonb;
begin
  insert into public.channel_settlement (account_id, channel_id, settlement_date, net_payout, source, import_key, collected_on, collected_amount, created_by_name)
  values (v_acc, current_setting('prueba.canal_justeat')::uuid, '2026-07-31', 60.00, 'import_csv_je', 'je:4000011', '2026-08-05', 60.00, 'Prueba S01j') returning id into v_old;
  r := public.conta_liquidacion_registrar(v_e, jsonb_build_object('proveedor', 'justeat', 'origen', 'correo', 'tienda', 'Marca de Prueba S01j (Calle Inventada 12)',
         'desde', '2026-07-16', 'hasta', '2026-07-31', 'pedidos', 4, 'ventas', jsonb_build_object('total', 80.00), 'comision', 20.00, 'otros', 0, 'neto', 60.00,
         'referencia', '4000011', 'factura', jsonb_build_object('numero', '4000011', 'base', 16.53, 'iva', 3.47, 'total', 20.00)), 'Prueba S01j');
  if not exists (select 1 from public.channel_settlement where id = v_old) then
    raise exception 'PRUEBA S01j · 4: se ha quitado una antigua que tenía su cobro.';
  end if;
  raise notice 'PRUEBA S01j · 4: la antigua con su cobro se queda; la nueva entra al lado.';
end $$;

-- 5 · conta_correo_releer_lista, como persona (administración de D).
insert into public.inbound_email_log (email_id, to_address, from_address, subject, company_id, account_id, outcome, detail)
values ('correo-prueba-s01j-g1', 'facturas-prueba@entrada.folvy.app', 'reenvio@prueba.test', 'Fwd: Glovoapp Spain Platform S.L. - Factura 000000000001', current_setting('prueba.e')::uuid, current_setting('prueba.acc')::uuid, 'recibido', '{}'),
       ('correo-prueba-s01j-o1', 'facturas-prueba@entrada.folvy.app', 'proveedor@prueba.test', 'Factura de otro proveedor', current_setting('prueba.e')::uuid, current_setting('prueba.acc')::uuid, 'recibido', '{}');
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v text[];
begin
  v := public.conta_correo_releer_lista(current_setting('prueba.e')::uuid, null, 'glovo');
  if v is distinct from array['correo-prueba-s01j-g1'] then raise exception 'PRUEBA S01j · 5: los de Glovo no son los suyos: %', v; end if;
  v := public.conta_correo_releer_lista(current_setting('prueba.e')::uuid, array['correo-prueba-s01j-o1', 'no-es-de-esta-empresa'], null);
  if v is distinct from array['correo-prueba-s01j-o1'] then raise exception 'PRUEBA S01j · 5: por id, ha dado %', v; end if;
  begin
    perform public.conta_correo_releer_lista(current_setting('prueba.e')::uuid, null, 'uber');
    raise exception 'PRUEBA S01j · 5: acepta un remitente que no es Glovo ni Just Eat.';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.conta_comision_del_correo(gen_random_uuid(), '{}'::jsonb);
    raise exception 'PRUEBA S01j · 5: la persona puede crear facturas desde un correo.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA S01j · 5: como persona: los de Glovo y los que nombra, solo de su empresa; crear la factura del correo no es suyo.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 6 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261101T0846_s01j_antiguas_sin_periodo.down.sql
\i supabase/vuelta-atras/20261101T0845_s01j_comision_del_correo.down.sql
do $$ begin
  if to_regprocedure('public.conta_comision_del_correo(uuid,jsonb)') is not null or to_regprocedure('public.conta_correo_releer_lista(uuid,text[],text)') is not null
     or exists (select 1 from pg_trigger where tgname = 's01j_liquidacion_sustituye') then
    raise exception 'PRUEBA S01j · 6: la vuelta atrás no quita las funciones o el disparador.';
  end if;
  raise notice 'PRUEBA S01j · 6: la vuelta atrás quita lo de la 0845 y la 0846.';
end $$;
\i supabase/migrations/20261101T0845_s01j_comision_del_correo.sql
\i supabase/migrations/20261101T0846_s01j_antiguas_sin_periodo.sql

rollback;
