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
--   5. La 2211 sin Foodint no toca nada.
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
create temp table _n (clave text primary key, n bigint) on commit drop;
insert into _n select 'asientos', count(*) from public.journal_entry;
insert into _n select 'lineas_303', count(*) from public.tax_return_line;

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

-- 5. Las 22 de Foodint: sin Foodint, nada.
\i supabase/migrations/20261104T2211_s01p_22_a_octubre.sql
\i supabase/vuelta-atras/20261104T2211_s01p_22_a_octubre.down.sql
do $$ begin
  if (select n from _n where clave = 'asientos') <> (select count(*) from public.journal_entry)
     or (select n from _n where clave = 'lineas_303') <> (select count(*) from public.tax_return_line)
     or to_regclass('public.conta_s01p4_303_antes') is not null then
    raise exception 'PRUEBA S01p facturas 5: sin Foodint, la 2211 o su vuelta atrás han tocado algo.';
  end if;
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
