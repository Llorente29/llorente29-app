-- supabase/staging/sql/20261208_d07_uber_liquidaciones_prueba.sql
--
-- SOLO STAGING. Prueba de 20261208T0860_d07_uber_liquidaciones y de
-- 20261208T0870_d07_uber_quitar_provisionales, con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. Datos inventados, en la empresa A.
-- Cambia en caliente, y aquí se prueba por su nombre:
-- public.conta_liquidacion_factura_proponer.
--
--   0. Lo de antes: conta_liquidacion_factura_proponer es la de producción (md5
--      del cuerpo). La 0860 y la 0870 (sin Foodint, la 0870 no quita nada).
--   1. Como la función de entrada (service_role): dos liquidaciones de Uber de
--      la misma semana (12–18/10) se registran SIN factura provisional: estado
--      «espera_factura», sin enlace, y ninguna factura de liquidación nueva.
--   2. Como administrador de A: la factura de comisión de la semana, de verdad
--      (con número y PDF), se enlaza con las dos; suman lo que dice la factura
--      y lo dice. Las dos quedan con su enlace.
--   3. Lo que no: una liquidación ya enlazada con otra factura, o una factura
--      de un proveedor que no es la plataforma: error y no se enlaza ninguna.
--      B no enlaza las de A.
--   4. La vuelta atrás de la 0870 con datos: una provisional de A (con sus
--      líneas, su IVA y su enlace), respaldada y quitada como lo hace la 0870,
--      vuelve tal cual, con su enlace.
--   5. La vuelta atrás de la 0860: la función como en producción y sin la de
--      enlazar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D07 Uber: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/vuelta-atras/20261208T0870_d07_uber_quitar_provisionales.down.sql
\i supabase/vuelta-atras/20261208T0860_d07_uber_liquidaciones.down.sql

-- 0 · Lo de antes, y la tanda.
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_liquidacion_factura_proponer(uuid,text)'::regprocedure) <> 'daff8f19ef7d7b2eca1a2c2c693d3fa8' then
    raise exception 'PRUEBA D07 Uber · 0: conta_liquidacion_factura_proponer no es la de producción.';
  end if;
end $$;
\i supabase/migrations/20261208T0860_d07_uber_liquidaciones.sql
\i supabase/migrations/20261208T0870_d07_uber_quitar_provisionales.sql

-- Preparar (como postgres): el Uber de A con su plataforma, su proveedor y el corte.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_canal uuid; v_party uuid; v_sup uuid; v_otro uuid;
begin
  delete from public.bank_settings where company_id = v_e;
  insert into public.bank_settings (company_id, account_id, cutover_date) values (v_e, v_acc, date '2026-10-01');
  select id into v_canal from public.sales_channel where account_id = v_acc and slug = 'uber';
  if v_canal is null then raise exception 'PRUEBA D07 Uber · 0: la cuenta A no tiene el canal de Uber.'; end if;
  select pr.party_id into v_party from public.party_role pr where pr.account_id = v_acc and pr.role = 'platform' and pr.channel_id = v_canal;
  if v_party is null then
    insert into public.party (account_id, name, created_by_name) values (v_acc, 'Plataforma inventada (prueba D07)', 'Prueba D07') returning id into v_party;
    insert into public.party_role (account_id, party_id, role, channel_id, commission_account_code) values (v_acc, v_party, 'platform', v_canal, '62300001');
  end if;
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Portier inventada D07', 'Portier Inventada SL', 'B00000707', true, 'Prueba D07') returning id into v_sup;
  update public.party_role set party_id = v_party where account_id = v_acc and supplier_id = v_sup and role = 'supplier';
  if not found then insert into public.party_role (account_id, party_id, role, supplier_id) values (v_acc, v_party, 'supplier', v_sup); end if;
  -- Otro proveedor, que no es la plataforma.
  insert into public.supplier (account_id, name, tax_id, is_active, created_by_name)
  values (v_acc, 'Otro proveedor D07', 'B00000708', true, 'Prueba D07') returning id into v_otro;
  perform set_config('prueba.sup', v_sup::text, true);
  perform set_config('prueba.otro', v_otro::text, true);
end $$;

-- 1 · Como la función de entrada: dos liquidaciones de la misma semana, sin provisional.
select set_config('request.jwt.claims', '', true);
set local role service_role;
do $$
declare
  v_e constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  p jsonb; r jsonb; v_cs public.channel_settlement; v_antes int; i int;
begin
  select count(*) into v_antes from public.supplier_invoice where source = 'liquidacion';
  for i in 1..2 loop
    p := jsonb_build_object('proveedor', 'uber', 'tienda', format('Marca D07 Inventada %s (Calle Inventada %s, Madrid, ES, 28001)', i, i), 'marca', format('Marca D07 Inventada %s', i),
      'referencia', null, 'deposito_iniciado', null, 'pedidos', 4, 'email_id', format('prueba-d07-%s', i), 'desde', '2026-10-12', 'hasta', '2026-10-18',
      'ventas', jsonb_build_object('base', 80, 'iva', 8, 'total', 88, 'pedidos', 4),
      'ganancias', jsonb_build_object('ventas', 88, 'pedidosVentas', 4, 'otras', 0, 'total', 88),
      'uber', jsonb_build_object('tasas', -8, 'otros', 0, 'total', -8),
      'marketing', jsonb_build_object('promociones', -15, 'otrosPromo', -2, 'anuncios', -10, 'total', -27),
      'modificaciones', jsonb_build_object('contracargo', 0, 'pedidosContracargo', 0, 'ajustes', 0, 'total', 0),
      'neto', 53, 'diario', '[]'::jsonb, 'contracargos', '[]'::jsonb, 'mensual', null, 'avisos', '[]'::jsonb,
      'factura', jsonb_build_object('comision', jsonb_build_object('total', 10, 'base', 8.27), 'publicidad', jsonb_build_object('total', 10, 'base', 8.26),
                                    'base', 16.53, 'iva', 3.47, 'total', 20, 'tipo_iva', 21, 'avisos', '[]'::jsonb));
    r := public.conta_liquidacion_registrar(v_e, p, null);
    select * into v_cs from public.channel_settlement where id = (r->>'liquidacion_id')::uuid;
    if r->'factura'->>'estado' <> 'espera_factura' or v_cs.commission_invoice_id is not null or r->>'texto' not like '%llega aparte, cada semana, con su PDF%' then
      raise exception 'PRUEBA D07 Uber · 1: %', r;
    end if;
    perform set_config('prueba.liq' || i, v_cs.id::text, true);
  end loop;
  if (select count(*) from public.supplier_invoice where source = 'liquidacion') <> v_antes then
    raise exception 'PRUEBA D07 Uber · 1: ha creado una factura provisional.';
  end if;
  raise notice 'PRUEBA D07 Uber · 1: dos liquidaciones de la semana 12–18/10, sin factura provisional: %', r->>'texto';
end $$;
reset role;

-- La factura de comisión de verdad, con número y PDF (como postgres: llega por correo).
do $$
declare v_f uuid;
begin
  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source,
                                       tax_base_total, tax_total, grand_total, raw_document_url, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', current_setting('prueba.sup')::uuid, 'invoice',
          'UBER-D07-W42', date '2026-10-20', 'en_revision', 'ocr', 33.06, 6.94, 40, 'c01a0000-0000-4000-8000-00000000000a/prueba-d07/uber-w42.pdf', 'Prueba D07')
  returning id into v_f;
  perform set_config('prueba.fac', v_f::text, true);
  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source, grand_total, created_by_name)
  values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', current_setting('prueba.otro')::uuid, 'invoice',
          'OTRO-D07-1', date '2026-10-20', 'en_revision', 'ocr', 40, 'Prueba D07')
  returning id into v_f;
  perform set_config('prueba.facotro', v_f::text, true);
end $$;

-- 2 y 3 · Como administrador de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; v_liqs uuid[] := array[current_setting('prueba.liq1')::uuid, current_setting('prueba.liq2')::uuid]; v_ok boolean;
begin
  -- 3 · De un proveedor que no es la plataforma: no.
  v_ok := false;
  begin
    perform public.conta_liquidacion_enlazar_factura(current_setting('prueba.facotro')::uuid, v_liqs, 'Prueba D07');
  exception when others then
    if sqlerrm like '%no son de este proveedor%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'PRUEBA D07 Uber · 3: se enlaza una factura de un proveedor que no es la plataforma.'; end if;
  -- 2 · La de la semana, con las dos.
  r := public.conta_liquidacion_enlazar_factura(current_setting('prueba.fac')::uuid, v_liqs, 'Prueba D07');
  if (r->>'enlazadas')::int <> 2 or (r->>'cuadra')::boolean is not true or r->>'texto' not like 'Enlazada con 2 liquidaciones (del 12/10 al 18/10/2026): suman 40,00 €, como la factura.' then
    raise exception 'PRUEBA D07 Uber · 2: %', r;
  end if;
  if (select count(*) from public.channel_settlement where id = any (v_liqs) and commission_invoice_id = current_setting('prueba.fac')::uuid) <> 2 then
    raise exception 'PRUEBA D07 Uber · 2: las dos liquidaciones no han quedado con su factura.';
  end if;
  raise notice 'PRUEBA D07 Uber · 2: %', r->>'texto';
  -- 3 · Ya enlazadas con otra factura: no.
  v_ok := false;
  begin
    perform public.conta_liquidacion_enlazar_factura(current_setting('prueba.facotro')::uuid, v_liqs, 'Prueba D07');
  exception when others then
    if sqlerrm like '%ya tienen otra factura%' then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'PRUEBA D07 Uber · 3: se enlaza una liquidación que ya tiene otra factura.'; end if;
  raise notice 'PRUEBA D07 Uber · 3: ni otro proveedor ni una liquidación ya enlazada.';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.conta_liquidacion_enlazar_factura(current_setting('prueba.fac')::uuid, array[current_setting('prueba.liq1')::uuid], 'Prueba D07');
  exception when insufficient_privilege then v_ok := true;
  end;
  if not v_ok then raise exception 'PRUEBA D07 Uber · 3: B enlaza facturas de A.'; end if;
  raise notice 'PRUEBA D07 Uber · 3: B no enlaza las de A.';
end $$;
reset role;

-- 4 · La vuelta atrás de la 0870, con datos: una provisional de A, respaldada y quitada como lo hace la 0870.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_p uuid; v_cs uuid := current_setting('prueba.liq1')::uuid; v_antes jsonb; v_despues jsonb;
begin
  update public.channel_settlement set commission_invoice_id = null where id = v_cs;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, doc_kind, invoice_number, invoice_date, status, source, arrival_channel,
                                       tax_base_total, tax_total, grand_total, needs_review, notes, reading, reading_confidence, created_by_name)
  values (v_acc, '3b34403a-a7d6-4a48-a8d7-737e8cababdc', current_setting('prueba.sup')::uuid, 'invoice', null, date '2026-10-20', 'en_revision', 'liquidacion', 'correo',
          16.53, 3.47, 20, true, 'Provisional de la prueba D07', jsonb_build_object('origen', 'liquidacion', 'liquidacion_id', v_cs), 'duda', 'Prueba D07')
  returning id into v_p;
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, expense_account_code, position)
  values (v_p, 'Comisión y cargos de la plataforma', 1, 8.27, 8.27, 21, '62300001', 1), (v_p, 'Publicidad (anuncios)', 1, 8.26, 8.26, 21, '62700000', 2);
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_p, 21, 16.53, 3.47);
  update public.channel_settlement set commission_invoice_id = v_p where id = v_cs;
  select jsonb_build_object('f', (select to_jsonb(si) - 'updated_at' from public.supplier_invoice si where si.id = v_p),
                            'l', (select jsonb_agg(to_jsonb(l) order by l.position) from public.supplier_invoice_line l where l.supplier_invoice_id = v_p),
                            't', (select jsonb_agg(to_jsonb(t)) from public.supplier_invoice_tax t where t.supplier_invoice_id = v_p),
                            'cs', (select jsonb_build_object('c', commission_invoice_id, 'n', needs_review, 'r', review_note) from public.channel_settlement where id = v_cs))
    into v_antes;
  -- Lo que hace la 0870 con una de Foodint.
  insert into public.conta_respaldo_d07_provisionales (tabla, id, fila)
  select 'supplier_invoice', si.id, to_jsonb(si) from public.supplier_invoice si where si.id = v_p
  union all select 'supplier_invoice_line', l.id, to_jsonb(l) from public.supplier_invoice_line l where l.supplier_invoice_id = v_p
  union all select 'supplier_invoice_tax', t.id, to_jsonb(t) from public.supplier_invoice_tax t where t.supplier_invoice_id = v_p
  union all select 'channel_settlement', cs.id, jsonb_build_object('commission_invoice_id', cs.commission_invoice_id, 'needs_review', cs.needs_review,
                   'review_note', cs.review_note, 'updated_at', cs.updated_at) from public.channel_settlement cs where cs.id = v_cs;
  update public.channel_settlement set commission_invoice_id = null where id = v_cs;
  delete from public.supplier_invoice where id = v_p;
  if exists (select 1 from public.supplier_invoice_line where supplier_invoice_id = v_p) then raise exception 'PRUEBA D07 Uber · 4: las líneas no se van con su factura.'; end if;
  perform set_config('prueba.prov', v_p::text, true);
  perform set_config('prueba.antes', v_antes::text, true);
end $$;
\i supabase/vuelta-atras/20261208T0870_d07_uber_quitar_provisionales.down.sql
do $$
declare v_p uuid := current_setting('prueba.prov')::uuid; v_cs uuid := current_setting('prueba.liq1')::uuid; v_despues jsonb;
begin
  select jsonb_build_object('f', (select to_jsonb(si) - 'updated_at' from public.supplier_invoice si where si.id = v_p),
                            'l', (select jsonb_agg(to_jsonb(l) order by l.position) from public.supplier_invoice_line l where l.supplier_invoice_id = v_p),
                            't', (select jsonb_agg(to_jsonb(t)) from public.supplier_invoice_tax t where t.supplier_invoice_id = v_p),
                            'cs', (select jsonb_build_object('c', commission_invoice_id, 'n', needs_review, 'r', review_note) from public.channel_settlement where id = v_cs))
    into v_despues;
  if v_despues is distinct from current_setting('prueba.antes')::jsonb then
    raise exception 'PRUEBA D07 Uber · 4: la vuelta atrás de la 0870 no la deja como estaba: antes % / después %', current_setting('prueba.antes'), v_despues;
  end if;
  if to_regclass('public.conta_respaldo_d07_provisionales') is not null then raise exception 'PRUEBA D07 Uber · 4: no ha quitado el respaldo.'; end if;
  raise notice 'PRUEBA D07 Uber · 4: la vuelta atrás de la 0870 devuelve la provisional tal cual, con sus líneas, su IVA y su enlace.';
end $$;

-- 5 · La vuelta atrás de la 0860.
\i supabase/vuelta-atras/20261208T0860_d07_uber_liquidaciones.down.sql
do $$ begin
  if (select md5(prosrc) from pg_proc where oid = 'public.conta_liquidacion_factura_proponer(uuid,text)'::regprocedure) <> 'daff8f19ef7d7b2eca1a2c2c693d3fa8' then
    raise exception 'PRUEBA D07 Uber · 5: la vuelta atrás no deja conta_liquidacion_factura_proponer como en producción.';
  end if;
  if to_regprocedure('public.conta_liquidacion_enlazar_factura(uuid,uuid[],text)') is not null then
    raise exception 'PRUEBA D07 Uber · 5: la vuelta atrás no quita la función de enlazar.';
  end if;
  raise notice 'PRUEBA D07 Uber · 5: la vuelta atrás de la 0860, como en producción.';
end $$;

rollback;
