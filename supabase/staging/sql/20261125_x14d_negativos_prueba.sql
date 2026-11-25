-- supabase/staging/sql/20261125_x14d_negativos_prueba.sql
--
-- SOLO STAGING. Prueba del X14 · 2 (20261125T1132_x14d_negativos), que el ensayo de staging pone delante en la misma sesión. Todo en una
-- transacción con ROLLBACK: staging no cambia. Lo que cambia: public.journal_line (journal_line_debe_o_haber: un lado
-- distinto de 0, con cualquier signo; sin journal_line_debit_check ni journal_line_credit_check), public._conta_traer_seguir,
-- public.conta_asiento_modificar, public.conta_motivos_para_validar, public.conta_cierre_validar,
-- public._s01p_nomina_retencion_poner y public.conta_apunte_pago_modelo.
--
-- Datos inventados (T11). Los caminos:
--   1. journal_line: una línea en negativo entra; a 0 en los dos lados, no; con importe en los dos, no.
--   2. Un asiento a mano en negativo (la gestoría de la semilla, su administrador): se valida, y conta_asiento_modificar lo
--      cambia a otro importe en negativo. Las sumas y saldos del día llevan el negativo en su columna, como ERP10.
--   3. Una compra en negativo con su IVA (base −100, cuota −21): se valida sin motivos, y el libro de IVA la lleva en
--      negativo (base −100, cuota −21).
--   4. Traer de ERP10 (una empresa nueva, solo con 2026, con lo leído de 2024): una línea a cero no entra y queda en «lo que
--      no ha entrado» con su porqué; el abono en negativo entra tal cual; las sumas del debe y del haber de cada cuenta son
--      las de lo leído, al céntimo; y se da por bueno.
--   5. La vuelta atrás (sin negativos): las restricciones y las seis funciones de antes.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_line_debe_o_haber')) not like '%<> (0)%' then
    raise exception 'PRUEBA X14d · 0: falta la 20261125T1132 delante.';
  end if;
  if (select count(*) from public.company_account where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and code in ('57200001', '41000001', '62800000', '47200021')) <> 4 then
    raise exception 'PRUEBA X14d · 0: la gestoría de la semilla no tiene la 57200001, la 41000001, la 62800000 y la 47200021.';
  end if;
end $$;
savepoint antes;

-- 1 a 3 · La gestoría de la semilla, como su administrador -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;
do $$
declare
  a constant uuid := 'c0e20000-0000-4000-8000-0000000000e0'; emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_y uuid; v_e uuid; v_c uuid; ok boolean; r jsonb; v_s record; v_iva uuid;
begin
  select id into v_y from public.fiscal_year where company_id = emp and date '2026-11-12' between starts_on and ends_on;
  -- 1 · La regla de la tabla.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
  values (a, emp, v_y, 4, '2026-11-12', 'X14d en negativo', 'manual', 'borrador', 'Prueba X14d') returning id into v_e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, is_common)
  select a, emp, v_e, x.p, c.id, x.d, x.h, 'X14d', true
    from (values (1, '41000001', -63.60, 0), (2, '57200001', 0, -63.60)) x(p, code, d, h)
    join public.company_account c on c.company_id = emp and c.code = x.code;
  select id into v_c from public.company_account where company_id = emp and code = '62800000';
  ok := false;
  begin insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, is_common)
        values (a, emp, v_e, 9, v_c, 0, 0, 'X14d', true);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'PRUEBA X14d · 1: ha entrado una línea a 0 en los dos lados.'; end if;
  ok := false;
  begin insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, is_common)
        values (a, emp, v_e, 9, v_c, -5, 5, 'X14d', true);
  exception when check_violation then ok := true; end;
  if not ok then raise exception 'PRUEBA X14d · 1: ha entrado una línea con importe en los dos lados.'; end if;
  raise notice 'PRUEBA X14d · 1: la línea en negativo entra; a 0 en los dos lados y con importe en los dos, no.';

  -- 2 · El asiento a mano en negativo: se valida, y se cambia a otro negativo.
  perform public.journal_entry_validar(v_e, 'Prueba X14d');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then
    raise exception 'PRUEBA X14d · 2: el asiento en negativo no se valida: %', public.conta_motivos_para_validar(v_e);
  end if;
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
  values (a, emp, v_y, 4, '2026-11-12', 'X14d a cambiar', 'manual', 'borrador', 'Prueba X14d') returning id into v_e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, is_common)
  select a, emp, v_e, x.p, c.id, x.d, x.h, 'X14d', true
    from (values (1, '62800000', 10, 0), (2, '57200001', 0, 10)) x(p, code, d, h)
    join public.company_account c on c.company_id = emp and c.code = x.code;
  perform public.journal_entry_validar(v_e, 'Prueba X14d');
  r := public.conta_asiento_modificar(v_e, '{}', '[{"cuenta": "62800000", "debe": -70}, {"cuenta": "57200001", "haber": -70}]', 'Prueba X14d');
  if (select string_agg(debit || '/' || credit, ' ' order by position) from public.journal_line where entry_id = v_e) <> '-70.00/0.00 0.00/-70.00' then
    raise exception 'PRUEBA X14d · 2: conta_asiento_modificar no lo deja en negativo: %', (select string_agg(debit || '/' || credit, ' ' order by position) from public.journal_line where entry_id = v_e);
  end if;
  select * into v_s from public.conta_sumas_saldos(emp, '2026-11-12', '2026-11-12') s where s.code = '41000001';
  if v_s.debe is distinct from -63.60 or v_s.saldo is distinct from -63.60 then
    raise exception 'PRUEBA X14d · 2: las sumas y saldos de la 41000001 del día dan debe % y saldo %.', v_s.debe, v_s.saldo;
  end if;
  raise notice 'PRUEBA X14d · 2: el asiento a mano en negativo se valida, se cambia a −70 y las sumas y saldos dan −63,60 al debe de la 41000001.';

  -- 3 · Una compra en negativo con su IVA.
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, created_by_name)
  values (a, emp, v_y, 4, '2026-11-12', 'X14d compra en negativo', 'manual', 'borrador', 'Prueba X14d') returning id into v_e;
  select id into v_iva from public.tax_rate where rate = 21 and treatment = 'taxed' and valid_to is null and name like 'IVA%' limit 1;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept, is_common, tax_rate_id, tax_base, vat_book, vat_deductible)
  select a, emp, v_e, x.p, c.id, x.d, x.h, 'X14d', true, case when x.p = 2 then v_iva end, case when x.p = 2 then -100 end,
         case when x.p = 2 then 'received' end, case when x.p = 2 then 'yes' end
    from (values (1, '62800000', -100, 0), (2, '47200021', -21, 0), (3, '41000001', 0, -121)) x(p, code, d, h)
    join public.company_account c on c.company_id = emp and c.code = x.code;
  if exists (select 1 from public.conta_motivos_para_validar(v_e) m) then
    raise exception 'PRUEBA X14d · 3: la compra en negativo tiene motivos para no validarse: %', (select string_agg(m::text, ' · ') from public.conta_motivos_para_validar(v_e) m);
  end if;
  perform public.journal_entry_validar(v_e, 'Prueba X14d');
  if (select status from public.journal_entry where id = v_e) <> 'validado' then raise exception 'PRUEBA X14d · 3: la compra en negativo no se valida.'; end if;
  if (select string_agg(b.tax_base || '/' || b.tax_amount, ' ') from public.vat_book_entry b where b.entry_id = v_e) is distinct from '-100.00/-21.00' then
    raise exception 'PRUEBA X14d · 3: el libro de IVA dice %.', (select string_agg(b.tax_base || '/' || b.tax_amount, ' ') from public.vat_book_entry b where b.entry_id = v_e);
  end if;
  raise notice 'PRUEBA X14d · 3: la compra en negativo con su IVA se valida sin motivos, y el libro de IVA la lleva con base −100 y cuota −21.';
end $$;
reset role;
set local statement_timeout = '120s';
create temp table _x14n (k text primary key, v text) on commit drop;
grant all on _x14n to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _x14n where _x14n.k = $1 $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- La empresa nueva, con solo 2026, y la carga inventada de 2024.
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; d jsonb; d7 text; s int := 0; x int;
begin
  -- Un CIF inventado al azar con su dígito de control (como cifInventado de las e2e): el de la cuenta tiene que ser único.
  d7 := lpad(floor(random() * 1e7)::bigint::text, 7, '0');
  for i in 1..7 loop
    x := substr(d7, i, 1)::int;
    if i % 2 = 1 then x := x * 2; s := s + x / 10 + x % 10; else s := s + x; end if;
  end loop;
  insert into public.company (account_id, legal_name, tax_id, tax_id_type, entity_kind, setup_step, setup_completed_at)
  values (v_acc, 'Prueba X14d inventada', 'B' || d7 || ((10 - s % 10) % 10)::text, 'nif_es', 'company', 'hecho', now()) returning id into c;
  insert into public.company_tax_profile (account_id, company_id, tax_territory, chart_kind, account_digits, tax_forms)
  values (v_acc, c, 'peninsula_baleares', 'pymes', 8, array['303']);
  insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31');
  d := jsonb_build_object('version', 1, 'programa', 'erp10', 'ficheros', '[]'::jsonb, 'largos', '[8]'::jsonb,
    'cuentas', jsonb_build_array(jsonb_build_object('codigo', '43000901', 'nombre', 'CLIENTE INVENTADO X14D'), jsonb_build_object('codigo', '70500000', 'nombre', 'Prestaciones de servicios')),
    'terceros', '[]'::jsonb,
    'asientos', jsonb_build_array(
      -- Uno normal, uno con una línea a cero y un abono en negativo (los dos lados), todo inventado; en céntimos.
      jsonb_build_object('clave', 'X14D-1', 'serie', '1', 'documento', '1', 'fecha', '2024-03-15', 'concepto', 'Inventado X14d normal', 'apuntesLeidos', 2,
        'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', '', 'concepto', 'Inventado', 'debe', 12100, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 12100))),
      jsonb_build_object('clave', 'X14D-2', 'serie', '1', 'documento', '2', 'fecha', '2024-04-15', 'concepto', 'Inventado X14d con cero', 'apuntesLeidos', 3,
        'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', '', 'concepto', 'Inventado', 'debe', 5000, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', 5000))),
      jsonb_build_object('clave', 'X14D-3', 'serie', '1', 'documento', '3', 'fecha', '2024-05-15', 'concepto', 'Inventado X14d abono en negativo', 'apuntesLeidos', 2,
        'apuntes', jsonb_build_array(jsonb_build_object('cuenta', '43000901', 'nombre', '', 'concepto', 'Inventado', 'debe', -3000, 'haber', 0),
                                     jsonb_build_object('cuenta', '70500000', 'nombre', '', 'concepto', 'Inventado', 'debe', 0, 'haber', -3000)))),
    'facturas', '[]'::jsonb, 'aprendido', '[]'::jsonb, 'pendientesNoExactos', '[]'::jsonb, 'raros', '[]'::jsonb, 'sumas', '[]'::jsonb, 'inmovilizado', null, 'frases', '[]'::jsonb);
  insert into _x14n values ('empresa', c), ('datos', d::text);
end $$;

-- 4 · Traer de ERP10 ---------------------------------------------------------------------------------------------------------
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; v_r public.import_run; v_mal text; v_cero text;
begin
  r := public.conta_traer_cargar(pg_temp.p('empresa')::uuid, '2024', pg_temp.p('datos')::jsonb, 'Prueba X14d');
  while coalesce((r->>'acabado')::boolean, true) is false loop r := public.conta_traer_seguir((r->>'carga')::uuid); end loop;
  select * into v_r from public.import_run where id = (r->>'carga')::uuid;
  if v_r.status <> 'en_prueba' then raise exception 'PRUEBA X14d · 4: no ha entrado en prueba: %', r; end if;
  if (v_r.counts->>'lineas_a_cero')::int is distinct from 1 then raise exception 'PRUEBA X14d · 4: no cuenta 1 línea a cero: %', v_r.counts; end if;
  select m->>'frase' into v_cero from jsonb_array_elements(v_r.detail->'mirar') m where m->>'que' = 'no_ha_entrado';
  if v_cero is distinct from 'No ha entrado una línea del asiento 2 del 15/04/2024 (cuenta 70500000): está a 0 en el debe y en el haber, no suma nada.' then
    raise exception 'PRUEBA X14d · 4: «lo que no ha entrado» dice «%».', v_cero;
  end if;
  if (select count(*) from public.journal_line l join public.journal_entry e on e.id = l.entry_id where e.import_run_id = v_r.id) <> 6 then
    raise exception 'PRUEBA X14d · 4: no son las 6 líneas que no están a cero.';
  end if;
  -- Las sumas de cada cuenta, las de lo leído, al céntimo (debe y haber, también los negativos).
  select string_agg(format('%s: %s/%s y lo leído %s/%s', x.cuenta, coalesce(s.debe, 0), coalesce(s.haber, 0), x.debe, x.haber), ' · ') into v_mal
    from (select ap->>'cuenta' cuenta, sum((ap->>'debe')::numeric) / 100 debe, sum((ap->>'haber')::numeric) / 100 haber
            from jsonb_array_elements(pg_temp.p('datos')::jsonb->'asientos') a, jsonb_array_elements(a->'apuntes') ap group by 1) x
    left join (select ca.code, sum(l.debit) debe, sum(l.credit) haber from public.journal_line l
                 join public.journal_entry e on e.id = l.entry_id join public.company_account ca on ca.id = l.company_account_id
                where e.import_run_id = v_r.id group by 1) s on s.code = x.cuenta
   where coalesce(s.debe, 0) <> x.debe or coalesce(s.haber, 0) <> x.haber;
  if v_mal is not null then raise exception 'PRUEBA X14d · 4: las sumas no son las de lo leído: %', v_mal; end if;
  if not exists (select 1 from public.journal_line l join public.journal_entry e on e.id = l.entry_id where e.import_run_id = v_r.id and l.debit = -30) then
    raise exception 'PRUEBA X14d · 4: el abono no ha entrado en negativo.';
  end if;
  perform public.conta_traer_dar_por_bueno(v_r.id, 'Prueba X14d');
  if (select status from public.import_run where id = v_r.id) <> 'dada_por_buena' then raise exception 'PRUEBA X14d · 4: no se ha dado por buena.'; end if;
  raise notice 'PRUEBA X14d · 4: la línea a cero no entra («%»), el abono entra en negativo, las sumas de cada cuenta son las de lo leído al céntimo, y se da por buena.', v_cero;
end $$;
reset role;

-- 5 · La vuelta atrás (sin negativos) -----------------------------------------------------------------------------------------
rollback to savepoint antes;
\i supabase/vuelta-atras/20261125T1132_x14d_negativos.down.sql
do $$ begin
  if pg_get_constraintdef((select oid from pg_constraint where conname = 'journal_line_debe_o_haber')) not like '%> (0)%'
     or (select count(*) from pg_constraint where conname in ('journal_line_debit_check', 'journal_line_credit_check')) <> 2 then
    raise exception 'PRUEBA X14d · 5: la vuelta atrás no deja las restricciones de antes.';
  end if;
  if strpos(pg_get_functiondef('public._conta_traer_seguir(uuid,timestamp with time zone)'::regprocedure), 'X14 · 2 · Una línea a 0') > 0
     or strpos(pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public.conta_asiento_modificar(uuid,jsonb,jsonb,text)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public.conta_cierre_validar(uuid,integer,text,text,text,text,integer,text)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public._s01p_nomina_retencion_poner(uuid,text,numeric)'::regprocedure), 'X14 · 2') > 0
     or strpos(pg_get_functiondef('public.conta_apunte_pago_modelo(uuid,integer,text,text)'::regprocedure), 'X14 · 2') > 0 then
    raise exception 'PRUEBA X14d · 5: la vuelta atrás no deja las seis funciones de antes.';
  end if;
  raise notice 'PRUEBA X14d · 5: la vuelta atrás deja las restricciones y las seis funciones de antes.';
  raise notice 'PRUEBA X14d: 5 de 5 bien.';
end $$;

rollback;
