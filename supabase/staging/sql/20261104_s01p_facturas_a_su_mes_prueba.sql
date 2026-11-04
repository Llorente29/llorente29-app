-- supabase/staging/sql/20261104_s01p_facturas_a_su_mes_prueba.sql
--
-- SOLO STAGING. Prueba del S01p · 4 · la factura recibida con su fecha (2210) y
-- las 22 de Foodint (2211, que en staging no hace nada). Todo en una
-- transacción con ROLLBACK, en la cuenta A. Nombra lo que cambia, para el
-- analizador: _conta_recibida_no_antes_de_entrar, _journal_entry_proponer.
--   1. Una factura de un mes abierto: su fecha.
--   2. Una de un mes cerrado por una persona con el trimestre sin presentar: su
--      fecha (el mes cerrado no frena).
--   3. Una de un trimestre con el 303 presentado: el primer día abierto, con su
--      aviso y su razón.
--   4. Lo que no es una factura recibida no se toca.
--   5. El camino entero de la 2211, con 3 facturas de mentira de A: se mueven
--      a su fecha y la vuelta atrás las devuelve con su número y su huella.
--   6. La vuelta atrás devuelve la regla de antes (V04: «nunca antes del día en
--      que entró») y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p facturas: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la prueba cambia la función (hace falta el dueño) y la llama como el dueño, igual que _journal_entry_proponer (security definer).

\i supabase/migrations/20261104T2210_s01p_fecha_de_la_factura.sql

create temp table _p (clave text primary key, v uuid) on commit drop;

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; f uuid; r jsonb; e jsonb; v3 text;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p facturas: no está la empresa de la cuenta A.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-05-10' between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  end if;
  select id into f from public.supplier_invoice where account_id = v_acc order by created_at limit 1;
  f := coalesce(f, gen_random_uuid());

  -- 1. Mes abierto: su fecha.
  e := jsonb_build_object('source_type', 'supplier_invoice', 'source_id', f, 'fecha', '2026-10-15');
  r := public._conta_recibida_no_antes_de_entrar(c, e);
  if r->>'fecha' <> '2026-10-15' or r ? 'aviso' then raise exception 'PRUEBA S01p facturas 1: un mes abierto mueve la fecha: %', r; end if;

  -- 2. Mes cerrado por una persona, trimestre sin presentar: su fecha.
  insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by_name)
  values (v_acc, c, y, '2026-08-01', 'manual', 'PRUEBA');
  r := public._conta_recibida_no_antes_de_entrar(c, e || jsonb_build_object('fecha', '2026-08-10'));
  if r->>'fecha' <> '2026-08-10' then raise exception 'PRUEBA S01p facturas 2: el mes cerrado frena: %', r; end if;

  -- 3. Trimestre con el 303 presentado: el primer día abierto.
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
  values (v_acc, c, '303', 2026, 'quarterly', '2T', '2026-07-20', 'filed', 'zero', 0, '2026-07-15 10:00+02', 'outside', 'PRUEBAS01P4');
  r := public._conta_recibida_no_antes_de_entrar(c, e || jsonb_build_object('fecha', '2026-05-10'));
  if (r->>'fecha')::date < date '2026-07-01' or coalesce(r->>'aviso', '') !~ 'ya está presentado' or jsonb_array_length(r->'razones') < 1 then
    raise exception 'PRUEBA S01p facturas 3: el trimestre presentado no la lleva al primer día abierto: %', r;
  end if;
  if (r->>'fecha')::date <> public.conta_primer_dia_iva_abierto(c, '2026-05-10') then raise exception 'PRUEBA S01p facturas 3: no es el primer día abierto: %', r; end if;
  v3 := r->>'fecha';

  -- 4. Lo que no es una factura recibida, igual.
  r := public._conta_recibida_no_antes_de_entrar(c, jsonb_build_object('source_type', 'manual', 'fecha', '2026-05-10'));
  if r->>'fecha' <> '2026-05-10' then raise exception 'PRUEBA S01p facturas 4: toca lo que no es una factura: %', r; end if;
  raise notice 'PRUEBA S01p facturas 1-4: bien (del 2T presentado, al %).', v3;
end $$;

-- 5. El camino entero de la 2211 (Julio, S01p·10: una prueba que no entra en el
--    camino de producción no vale). La 2211 sin Foodint solo crea sus funciones;
--    la prueba las llama con 3 facturas de mentira de A, del 10, 15 y 20/10,
--    asentadas el 02/11 y validadas, con un borrador del 303 del 4T, igual que las
--    22: se mueven a la fecha de su factura (validadas, al final de la serie 2,
--    la cadena entera, el debe y el IVA iguales, el 303 recalculado) y la vuelta
--    atrás las devuelve con su número y su huella.
\i supabase/migrations/20261104T2211_s01p_22_a_octubre.sql
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);
create temp table _m (n int primary key, factura uuid, asiento uuid, numero int, huella text) on commit drop;
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; s uuid; g uuid; p uuid; f uuid; e uuid; k int; r uuid; v jsonb;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select id into y from public.fiscal_year where company_id = c and date '2026-11-02' between starts_on and ends_on;
  -- Dos cuentas del plan de A para los apuntes (si la base no las tiene, de mentira).
  select id into g from public.company_account where company_id = c and code = '62900099';
  if g is null then insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
    values (v_acc, c, '62900099', 'PRUEBA S01p gasto', 'own', 'pymes', 'manual', '629') returning id into g; end if;
  select id into p from public.company_account where company_id = c and code = '41000099';
  if p is null then insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
    values (v_acc, c, '41000099', 'PRUEBA S01p acreedor', 'own', 'pymes', 'manual', '4100') returning id into p; end if;
  insert into public.supplier (account_id, name) values (v_acc, 'PRUEBA S01p proveedor') returning id into s;
  -- El borrador del 303 del 4T de A (si no lo tiene ya).
  select id into r from public.tax_return where company_id = c and form_code = '303' and fiscal_year = 2026 and period = '4T' and status = 'draft' and filed_at is null limit 1;
  if r is null then insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status)
    values (v_acc, c, '303', 2026, 'quarterly', '4T', '2027-01-30', 'draft') returning id into r; end if;
  insert into _p values ('303', r), ('empresa2', c);
  for k in 1..3 loop
    insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_date, grand_total, status, created_at)
    values (v_acc, c, s, date '2026-10-05' + k * 5, 10 * k, 'aprobada', timestamptz '2026-11-02 10:00+01') returning id into f;
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, confidence, reason)
    values (v_acc, c, y, 2, date '2026-11-02', 'PRUEBA S01p factura ' || k, 'supplier_invoice', f, 'propuesto', 'seguro', 'PRUEBA S01p') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
    values (v_acc, c, e, 1, g, 10 * k, 0, true), (v_acc, c, e, 2, p, 0, 10 * k, true);
    v := public.journal_entry_validar(e, 'PRUEBA');
    update public.supplier_invoice set journal_entry_id = e where id = f;
    insert into _m select k, f, e, (v->>'numero')::int, v->>'huella';
  end loop;
end $$;
do $$
declare c uuid := (select v from _p where clave = 'empresa2'); r jsonb; v_n int; v_max int;
begin
  select max(number) into v_max from public.journal_entry where company_id = c and series = 2 and fiscal_year_id = (select fiscal_year_id from public.journal_entry where id = (select m.asiento from _m m where m.n = 1));
  r := public._s01p_facturas_a_su_fecha(c, (select array_agg(m.asiento order by m.n) from _m m), (select v from _p where clave = '303'),
         'c01a0000-0000-4000-8000-0000000000a1', 'S01p·4 · PRUEBA: facturas de octubre asentadas en noviembre.');
  select count(*) into v_n from _m join public.supplier_invoice i on i.id = _m.factura join public.journal_entry e on e.id = i.journal_entry_id
   where e.status = 'validado' and e.entry_date = i.invoice_date and e.id <> _m.asiento and e.series = 2 and e.number > v_max - 3;
  if v_n <> 3 then raise exception 'PRUEBA S01p facturas 5: % de 3 con su asiento validado en la fecha de su factura, al final de la serie: %', n, r; end if;
  if exists (select 1 from public.journal_entry where id in (select asiento from _m)) then raise exception 'PRUEBA S01p facturas 5: los de antes siguen.'; end if;
  if public._conta_cadena_rota(c) <> 0 then raise exception 'PRUEBA S01p facturas 5: la cadena no cuadra.'; end if;
  if (r->>'movidos')::int <> 3 then raise exception 'PRUEBA S01p facturas 5: %', r; end if;
  -- La vuelta atrás de la 2211, con la función: los de antes con su número y su huella.
  r := public._s01p_facturas_a_su_fecha_deshacer(c, (select v from _p where clave = '303'));
  select count(*) into v_n from _m join public.journal_entry e on e.id = _m.asiento and e.number = _m.numero and e.hash = _m.huella and e.entry_date = date '2026-11-02'
    join public.supplier_invoice i on i.id = _m.factura and i.journal_entry_id = e.id;
  if v_n <> 3 then raise exception 'PRUEBA S01p facturas 5: la vuelta atrás devuelve % de 3 con su número y su huella: %', n, r; end if;
  if public._conta_cadena_rota(c) <> 0 then raise exception 'PRUEBA S01p facturas 5: la cadena no cuadra tras la vuelta atrás.'; end if;
  if to_regclass('public.conta_s01p4_303_antes') is not null then raise exception 'PRUEBA S01p facturas 5: queda la copia del 303.'; end if;
  raise notice 'PRUEBA S01p facturas 5: bien (3 movidas y devueltas).';
end $$;
\i supabase/vuelta-atras/20261104T2211_s01p_22_a_octubre.down.sql
do $$ begin
  if to_regprocedure('public._s01p_facturas_a_su_fecha(uuid,uuid[],uuid,uuid,text)') is not null then raise exception 'PRUEBA S01p facturas 5: la vuelta atrás deja la función.'; end if;
end $$;

-- 6. Vuelta atrás de la regla y otra vez delante.
\i supabase/vuelta-atras/20261104T2210_s01p_fecha_de_la_factura.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)'::regprocedure), 'S01p·4') > 0 then
    raise exception 'PRUEBA S01p facturas 6: la vuelta atrás no devuelve la regla V04.';
  end if;
end $$;
\i supabase/migrations/20261104T2210_s01p_fecha_de_la_factura.sql
do $$ begin
  if strpos(pg_get_functiondef('public._conta_recibida_no_antes_de_entrar(uuid,jsonb)'::regprocedure), 'S01p·4') = 0 then
    raise exception 'PRUEBA S01p facturas 6: otra vez delante no está.';
  end if;
  raise notice 'PRUEBA S01p facturas 5-6: bien.';
end $$;

rollback;
