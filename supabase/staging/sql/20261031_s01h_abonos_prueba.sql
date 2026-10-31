-- supabase/staging/sql/20261031_s01h_abonos_prueba.sql
--
-- SOLO STAGING. Prueba del S01h · los abonos de proveedor (20261031T1850,
-- 1851 y 1852). Todo en una transacción con ROLLBACK: no cambia staging.
-- Datos inventados, en la cuenta D (Asesoría de Prueba Oeste). La 1850 cambia
-- en caliente public.supplier_invoice (amplía un CHECK) y la 1851 le pone un
-- disparador a public.supplier_invoice y otro a public.journal_entry (al
-- validarse el asiento de un abono): aquí se prueban los tres.
--
--   1. Se liga solo: un abono que dice «anula INV-S01H-1» se liga a esa
--      factura (mismo proveedor, número normalizado). Con dos facturas del
--      mismo número, no elige.
--   1b. Un usuario no llama a conta_abono_compensar: solo el disparador.
--   2. Su CAMINO (regla 10): la factura (21 % y 10 %) se valida; el abono se
--      propone al revés (Debe el proveedor; Haber la 60800000 y el IVA de cada
--      tipo, todo en positivo) y se valida. El libro de recibidas lo lleva
--      restando (base −150, cuota −26) y las dos quedan pagadas «por
--      compensación», cada una con su pago contra el asiento de la otra.
--   3. Sin factura ligada, el abono validado queda como saldo a favor
--      (aprobada, 176,00 a favor, sin pagos).
--   4. La 1852 (datos de Foodint) no hace nada sin la cuenta de Foodint.
--   5. La vuelta atrás, y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01h: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

\i supabase/migrations/20261031T1850_s01h_pago_por_compensacion.sql
\i supabase/migrations/20261031T1851_s01h_abonos.sql
\i supabase/migrations/20261031T1852_s01h_abono_europastry_foodint.sql

-- Preparar: un proveedor inventado con su 4000, dos facturas y tres abonos.
do $$
declare
  v_acc constant uuid := 'c01d0000-0000-4000-8000-00000000000d';
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_sup uuid; v_ca uuid; v_f uuid; v_a uuid; v_h1 uuid; v_h2 uuid; v_ah uuid; v_suelto uuid;
begin
  if (select count(*) from public.company_account where company_id = v_e and code in ('60000000', '60800000', '47200010', '47200021')) <> 4 then
    raise exception 'PRUEBA S01h · 0: al plan de D le falta alguna de 60000000, 60800000, 47200010 o 47200021.';
  end if;
  -- El ejercicio de 2026 de D, si no lo tiene (la base local no trae ninguno).
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on, status, origin)
  select v_acc, v_e, '2026', date '2026-01-01', date '2026-12-31', 'open', 'folvy'
   where not exists (select 1 from public.fiscal_year where company_id = v_e and date '2026-10-05' between starts_on and ends_on);
  insert into public.supplier (account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (v_acc, 'Proveedor de prueba S01h', 'Proveedor de Prueba S01h, S.L.', 'B00000190', true, 'Prueba S01h') returning id into v_sup;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select v_acc, v_e, plan, '40000190', '4000', 'Proveedores · Proveedor de prueba S01h', 'own', 'manual', 'Prueba S01h'
    from public.company_account where company_id = v_e limit 1
  on conflict do nothing;
  select id into v_ca from public.company_account where company_id = v_e and code = '40000190';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, v_e, v_ca, 'supplier', v_sup::text, 'principal', 'manual');
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, tax_total, status, source, created_by_name)
  values (v_acc, v_e, v_sup, 'INV-S01H-1', '2026-10-05', 176, 26, 'aprobada', 'manual', 'Prueba S01h') returning id into v_f;
  update public.supplier_invoice set created_at = timestamptz '2026-10-05 10:00+02' where id = v_f;
  -- 1 · El abono se liga solo, por el número que dice que anula (otra forma de escribirlo).
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, tax_total, status, source, doc_kind, reading, created_by_name)
  values (v_acc, v_e, v_sup, 'A-S01H-1', '2026-10-13', -176, -26, 'aprobada', 'manual', 'credit_note',
          jsonb_build_object('factura', jsonb_build_object('clase', 'rectificativa', 'rectificaA', 'inv s01h/1')), 'Prueba S01h') returning id into v_a;
  update public.supplier_invoice set created_at = timestamptz '2026-10-13 10:00+02' where id = v_a;
  if (select corrects_invoice_id from public.supplier_invoice where id = v_a) is distinct from v_f then
    raise exception 'PRUEBA S01h · 1: el abono no se ha ligado a la factura que anula.';
  end if;
  -- Con dos del mismo número, no elige.
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name, not_duplicate_confirmed_at)
  values (v_acc, v_e, v_sup, 'DOBLE-S01H', '2026-10-01', 10, 'en_revision', 'manual', 'Prueba S01h', now()) returning id into v_h1;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, created_by_name, not_duplicate_confirmed_at)
  values (v_acc, v_e, v_sup, 'DOBLE-S01H', '2026-10-02', 12, 'en_revision', 'manual', 'Prueba S01h', now()) returning id into v_h2;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, status, source, doc_kind, reading, created_by_name)
  values (v_acc, v_e, v_sup, 'A-S01H-2', '2026-10-13', -10, 'en_revision', 'manual', 'credit_note',
          jsonb_build_object('factura', jsonb_build_object('rectificaA', 'DOBLE-S01H')), 'Prueba S01h') returning id into v_ah;
  if (select corrects_invoice_id from public.supplier_invoice where id = v_ah) is not null then
    raise exception 'PRUEBA S01h · 1: con dos facturas del mismo número, el abono ha elegido una.';
  end if;
  -- Un abono suelto (la factura que anula no está en Sumied), para el 3.
  insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, grand_total, tax_total, status, source, doc_kind, reading, created_by_name)
  values (v_acc, v_e, v_sup, 'A-S01H-3', '2026-10-20', -176, -26, 'aprobada', 'manual', 'credit_note',
          jsonb_build_object('factura', jsonb_build_object('rectificaA', 'F-000099')), 'Prueba S01h') returning id into v_suelto;
  update public.supplier_invoice set created_at = timestamptz '2026-10-20 10:00+02' where id = v_suelto;
  perform set_config('prueba.f', v_f::text, true);
  perform set_config('prueba.a', v_a::text, true);
  perform set_config('prueba.suelto', v_suelto::text, true);
  raise notice 'PRUEBA S01h · 1: el abono «anula inv s01h/1» se liga a INV-S01H-1; con dos facturas del mismo número, no elige.';
end $$;

-- 1b · Como usuario de D: conta_abono_compensar no se llama desde fuera (solo
-- la llama el disparador al validar). Si la llama, la prueba FALLA a propósito.
select set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.conta_abono_compensar(current_setting('prueba.a')::uuid);
    raise exception 'PRUEBA S01h · 1b: un usuario ha llamado a conta_abono_compensar.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA S01h · 1b: un usuario no puede compensar a mano (42501): solo al validar el asiento.';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- 2 y 3 · Su camino: proponer y validar la factura y los abonos (con el usuario de D).
do $$
declare
  v_e constant uuid := 'c01d0000-0000-4000-8000-0000000000d2';
  v_21 constant text := '28f9a398-2c95-4a3c-aebe-66d8cf37154f';
  v_10 constant text := '5bbab66f-a022-44a6-b146-ac577a2988d3';
  r jsonb; v_ef uuid; v_ea uuid; v_es uuid; f public.supplier_invoice; a public.supplier_invoice; s public.supplier_invoice;
  v_base numeric; v_cuota numeric; v_tipo text; v_n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'c01d0000-0000-4000-8000-0000000000d1', 'role', 'authenticated')::text, true);
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-10-05', 'concepto', 'Factura Proveedor de prueba S01h · INV-S01H-1', 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.f')::uuid, 'confianza', 'seguro', 'porque', 'Prueba S01h', 'documento', 'INV-S01H-1'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60000000', 'debe', 150, 'haber', 0, 'comun', true, 'documento', 'INV-S01H-1'),
      jsonb_build_object('cuenta', '47200021', 'debe', 21, 'haber', 0, 'comun', true, 'documento', 'INV-S01H-1',
                         'iva', jsonb_build_object('tipo_id', v_21, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '47200010', 'debe', 5, 'haber', 0, 'comun', true, 'documento', 'INV-S01H-1',
                         'iva', jsonb_build_object('tipo_id', v_10, 'base', 50, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '40000190', 'debe', 0, 'haber', 176, 'comun', true, 'documento', 'INV-S01H-1')),
    null, 'Prueba S01h');
  v_ef := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_ef, 'Prueba S01h');
  -- El abono, al revés: lo que sale de comoAbono (src/modules/conta/lib/asientosPropuestos.ts).
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-10-13', 'concepto', 'Abono Proveedor de prueba S01h · A-S01H-1', 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.a')::uuid, 'confianza', 'seguro', 'porque', 'Prueba S01h', 'documento', 'A-S01H-1'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60800000', 'debe', 0, 'haber', 150, 'comun', true, 'documento', 'A-S01H-1'),
      jsonb_build_object('cuenta', '47200021', 'debe', 0, 'haber', 21, 'comun', true, 'documento', 'A-S01H-1',
                         'iva', jsonb_build_object('tipo_id', v_21, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '47200010', 'debe', 0, 'haber', 5, 'comun', true, 'documento', 'A-S01H-1',
                         'iva', jsonb_build_object('tipo_id', v_10, 'base', 50, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '40000190', 'debe', 176, 'haber', 0, 'comun', true, 'documento', 'A-S01H-1')),
    null, 'Prueba S01h');
  v_ea := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_ea, 'Prueba S01h');
  if (select status from public.journal_entry where id = v_ea) <> 'validado' then raise exception 'PRUEBA S01h · 2: el asiento del abono no ha quedado validado.'; end if;
  -- El libro de recibidas lo lleva restando, como rectificativa.
  select sum(tax_base), sum(tax_amount), string_agg(distinct invoice_type, ','), count(*) into v_base, v_cuota, v_tipo, v_n from public.vat_book_entry where entry_id = v_ea;
  if v_n <> 2 or v_base <> -150 or v_cuota <> -26 then
    raise exception 'PRUEBA S01h · 2: el libro de recibidas no resta el abono: % filas, base %, cuota %, tipo %.', v_n, v_base, v_cuota, v_tipo;
  end if;
  -- Las dos, pagadas por compensación, cada una contra el asiento de la otra.
  select * into f from public.supplier_invoice where id = current_setting('prueba.f')::uuid;
  select * into a from public.supplier_invoice where id = current_setting('prueba.a')::uuid;
  if f.status <> 'pagada' or f.paid_method <> 'compensation' or a.status <> 'pagada' or a.paid_method <> 'compensation' or f.paid_at <> date '2026-10-13' then
    raise exception 'PRUEBA S01h · 2: no han quedado pagadas por compensación: factura % %, abono % %.', f.status, f.paid_method, a.status, a.paid_method;
  end if;
  if not exists (select 1 from public.supplier_invoice_payment where invoice_id = f.id and amount = 176 and entry_id = v_ea and method = 'compensation')
     or not exists (select 1 from public.supplier_invoice_payment where invoice_id = a.id and amount = -176 and entry_id = v_ef and method = 'compensation') then
    raise exception 'PRUEBA S01h · 2: los pagos de la compensación no están, o no van contra el asiento de la otra.';
  end if;
  -- Volver a compensar no hace nada.
  if (public.conta_abono_compensar(a.id)->>'compensado')::numeric <> 0 then raise exception 'PRUEBA S01h · 2: compensa dos veces.'; end if;
  raise notice 'PRUEBA S01h · 2: validado al revés; el libro resta base −150 y cuota −26 (tipo %); factura y abono, pagadas por compensación, cada una contra el asiento de la otra.', v_tipo;
  -- 3 · El abono suelto queda como saldo a favor.
  r := public.journal_entry_proponer(v_e,
    jsonb_build_object('series', 2, 'fecha', '2026-10-20', 'concepto', 'Abono Proveedor de prueba S01h · A-S01H-3', 'source_type', 'supplier_invoice',
                       'source_id', current_setting('prueba.suelto')::uuid, 'confianza', 'seguro', 'porque', 'Prueba S01h', 'documento', 'A-S01H-3'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '60800000', 'debe', 0, 'haber', 150, 'comun', true, 'documento', 'A-S01H-3'),
      jsonb_build_object('cuenta', '47200021', 'debe', 0, 'haber', 21, 'comun', true, 'documento', 'A-S01H-3',
                         'iva', jsonb_build_object('tipo_id', v_21, 'base', 100, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '47200010', 'debe', 0, 'haber', 5, 'comun', true, 'documento', 'A-S01H-3',
                         'iva', jsonb_build_object('tipo_id', v_10, 'base', 50, 'libro', 'received', 'deducible', 'yes', 'facturas', 1)),
      jsonb_build_object('cuenta', '40000190', 'debe', 176, 'haber', 0, 'comun', true, 'documento', 'A-S01H-3')),
    null, 'Prueba S01h');
  v_es := (r->>'id')::uuid;
  perform public.journal_entry_validar(v_es, 'Prueba S01h');
  select * into s from public.supplier_invoice where id = current_setting('prueba.suelto')::uuid;
  r := public.conta_abono_compensar(s.id);
  if s.status <> 'aprobada' or (r->>'a_favor')::numeric <> 176 or exists (select 1 from public.supplier_invoice_payment where invoice_id = s.id) then
    raise exception 'PRUEBA S01h · 3: el abono sin factura no queda como saldo a favor: % %.', s.status, r;
  end if;
  raise notice 'PRUEBA S01h · 3: sin factura ligada, queda como saldo a favor: %.', r->>'a_favor';
  perform set_config('request.jwt.claims', '', true);
end $$;

-- 4 · La 1852 no hace nada sin Foodint (lo dice su notice al cargarla arriba).
do $$ begin
  if exists (select 1 from public.supplier_invoice where id = 'f9e2738d-675c-4502-a6e9-c6eb71081633') then
    raise exception 'PRUEBA S01h · 4: hay un abono con el id del de Foodint en esta base.';
  end if;
  raise notice 'PRUEBA S01h · 4: la 1852, sin la cuenta de Foodint, no toca nada.';
end $$;

-- 5 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261031T1851_s01h_abonos.down.sql
\i supabase/vuelta-atras/20261031T1850_s01h_pago_por_compensacion.down.sql
do $$ begin
  if to_regprocedure('public.conta_abono_compensar(uuid)') is not null or to_regprocedure('public._conta_abono_ligar()') is not null
     or exists (select 1 from pg_trigger where tgname in ('s01h_abono_ligar', 's01h_abono_validado')) then
    raise exception 'PRUEBA S01h · 5: la vuelta atrás no quita las funciones o los disparadores.';
  end if;
  raise notice 'PRUEBA S01h · 5: la vuelta atrás quita lo de la 1851 y deja el CHECK de antes.';
end $$;
\i supabase/migrations/20261031T1850_s01h_pago_por_compensacion.sql
\i supabase/migrations/20261031T1851_s01h_abonos.sql

rollback;
