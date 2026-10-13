-- supabase/staging/sql/20261021_d01_revisar_prueba.sql
--
-- SOLO STAGING. Prueba de 20261021T0290 (D01, N23 y «Pedírselas»): en una
-- transacción con ROLLBACK, como administrador de A y como el de B.
--
--   1. conta_factura_para_revisar: la factura, sus bases por tipo, lo leído, el
--      proveedor con su subcuenta y «Sus facturas se apuntan en» (con su origen).
--   2. conta_factura_pedir: la petición queda CONFIRMADA por quien la pide (no
--      «enviada»: no se manda nada), la dirección como contacto de Facturación;
--      la segunda vez el mismo mes, la misma; una dirección mal escrita, no.
--   3. B: ni la lee ni pide en nombre de A.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA D01 revisar: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_e   constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  v_p uuid; v_sub text; v_i uuid; r jsonb; v_id uuid;
begin
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Revisar Prueba D01', 'Revisar Prueba D01, S.L.', 'B00000077', true, 'Prueba D01') returning id into v_p;
  v_sub := public.company_account_add(v_e, '4000', 'Revisar Prueba D01', null, 'supplier', v_p::text, 'Prueba D01')->>'code';
  perform public.company_account_link_set(v_e, 'supplier', v_p::text, 'gasto', (select id from public.company_account where company_id = v_e and code = '60000000'), 'Prueba D01', 'aprendido_diez');
  insert into public.supplier_invoice (account_id, supplier_id, company_id, invoice_number, invoice_date, status, source, grand_total, tax_base_total, tax_total, created_by_name, arrival_channel, reading_confidence, reading)
  values (v_acc, v_p, v_e, 'PD01-R-1', '2026-10-11', 'en_revision', 'ocr', 110, 100, 10, 'Prueba D01', 'correo', 'seguro', '{"porque":["Todo cuadra y trae lo que pide la norma."],"comprobaciones":[]}')
  returning id into v_i;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (v_acc, v_i, 10, 100, 10);
  perform set_config('prueba.i', v_i::text, true);
  perform set_config('prueba.p', v_p::text, true);

  -- 1
  r := public.conta_factura_para_revisar(v_i);
  if r->>'numero' <> 'PD01-R-1' or r->>'confianza' <> 'seguro' or jsonb_array_length(r->'tipos') <> 1 or (r->'tipos'->0->>'base')::numeric <> 100
     or r->'proveedor'->>'subcuenta' <> v_sub or r->'proveedor'->'gasto'->>'cuenta' <> '60000000' or r->'proveedor'->'gasto'->>'origen' <> 'aprendido_diez'
     or r->'lectura'->'porque'->>0 is null or r->'asiento' <> 'null'::jsonb then
    raise exception 'PRUEBA D01 revisar · 1: %', r;
  end if;
  raise notice 'PRUEBA D01 revisar · 1: factura, 1 tipo, subcuenta %, sus facturas se apuntan en % (%), sin asiento.', v_sub, r->'proveedor'->'gasto'->>'cuenta', r->'proveedor'->'gasto'->>'origen';

  -- 2
  r := public.conta_factura_pedir(v_e, v_p, '2026-09-15', 'Facturas@Proveedor-Prueba.test', 'Administración', true, 'Factura de septiembre', 'Hola: nos falta la factura de septiembre.', 'Prueba D01');
  v_id := (r->>'id')::uuid;
  if (r->>'ya_estaba')::boolean then raise exception 'PRUEBA D01 revisar · 2: la primera dice que ya estaba.'; end if;
  if (select status from public.supplier_invoice_request where id = v_id) <> 'confirmado' or (select confirmed_by_name from public.supplier_invoice_request where id = v_id) <> 'Prueba D01'
     or (select period from public.supplier_invoice_request where id = v_id) <> '2026-09-01' then
    raise exception 'PRUEBA D01 revisar · 2: la petición no queda confirmada por quien la pide, del mes 1.';
  end if;
  if not exists (select 1 from public.supplier_contact where supplier_id = v_p and role = 'billing' and email = 'facturas@proveedor-prueba.test') then
    raise exception 'PRUEBA D01 revisar · 2: no ha guardado el contacto de Facturación.';
  end if;
  if (public.conta_factura_pedir(v_e, v_p, '2026-09-30', 'otra@prueba.test', null, false, 'x', 'y', 'Prueba D01')->>'id')::uuid <> v_id then
    raise exception 'PRUEBA D01 revisar · 2: el mismo mes ha hecho otra petición.';
  end if;
  begin
    perform public.conta_factura_pedir(v_e, v_p, '2026-10-01', 'no es un correo', null, false, 'x', 'y', 'Prueba D01');
    raise exception 'PRUEBA D01 revisar · 2: ha aceptado una dirección mal escrita.';
  exception when sqlstate '22023' then null; end;
  if (r := public.conta_factura_para_revisar(v_i)) is null or r->'proveedor'->'facturacion'->>'email' <> 'facturas@proveedor-prueba.test' then
    raise exception 'PRUEBA D01 revisar · 2: la ficha no trae el contacto de Facturación: %', r->'proveedor';
  end if;
  raise notice 'PRUEBA D01 revisar · 2: confirmada por quien la pide (no «enviada»), contacto de Facturación guardado, una por mes, y una dirección mal escrita no.';
end $$;
reset role;

select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  begin
    perform public.conta_factura_para_revisar(current_setting('prueba.i')::uuid);
    raise exception 'PRUEBA D01 revisar · 3: B ha leído la factura de A.';
  exception when sqlstate 'P0002' then null; end;
  begin
    perform public.conta_factura_pedir('3b34403a-a7d6-4a48-a8d7-737e8cababdc', current_setting('prueba.p')::uuid, '2026-10-01', 'b@prueba.test', null, false, 'x', 'y', 'B');
    raise exception 'PRUEBA D01 revisar · 3: B ha pedido en nombre de A.';
  exception when insufficient_privilege then null; end;
  raise notice 'PRUEBA D01 revisar · 3: B ni la lee ni pide en nombre de A.';
end $$;
reset role;

rollback;
