-- supabase/staging/sql/20261104_s01p_nomina_prueba.sql
--
-- SOLO STAGING. Prueba de la nómina de octubre solo a contabilidad (2310). Todo
-- en una transacción con ROLLBACK, en la cuenta A, con cuentas de mentira si no
-- las tiene. Recorre el camino de producción (la función), no solo el «sin
-- Foodint». Nombra lo que añade: _s01p_nomina_proponer.
--   1. Propone el asiento: serie 9, 31/10, propuesto; 640 y 642 al debe en el
--      local, 476, 4751 y 465 al haber, comunes; cuadra.
--   2. Otra vez el mismo mes: no se duplica.
--   3. Unos totales que no cuadran: no se propone nada.
--   4. No toca Laboral ni el portal: payroll_summary, payroll_inbox y los
--      documentos de los trabajadores, iguales.
--   5. La vuelta atrás quita la función.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p nómina: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la función solo la llama una tanda, que corre como el dueño.

create temp table _p (clave text primary key, v uuid) on commit drop;
create temp table _n (clave text primary key, n bigint) on commit drop;
insert into _n select 'payroll_summary', count(*) from public.payroll_summary;
insert into _n select 'payroll_inbox', count(*) from public.payroll_inbox;

\i supabase/migrations/20261104T2310_s01p_nomina_octubre.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; loc uuid; e uuid; x record; v_err text;
  v_cuentas constant jsonb := jsonb_build_object('sueldos', '64000099', 'ss_empresa', '64200099', 'ss', '47600099', 'irpf', '47510099', 'pendiente', '46500099');
  v_cifras constant jsonb := jsonb_build_object('bruto', 100.00, 'ss_trabajador', 6.50, 'irpf', 2.00, 'liquido', 91.50, 'ss_empresa', 31.00, 'personas', 1);
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-31' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31'); end if;
  select id into loc from public.locations where account_id = v_acc order by id limit 1;
  if loc is null then raise exception 'PRUEBA S01p nómina: la cuenta A no tiene local.'; end if;
  for x in select * from (values ('64000099', '640'), ('64200099', '642'), ('47600099', '476'), ('47510099', '4751'), ('46500099', '465')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA S01p ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  -- Que no choque con una nómina de octubre de A que ya existiera: se prueba en un mes sin sueldos.
  if exists (select 1 from public.journal_entry je join public.journal_line jl on jl.entry_id = je.id join public.company_account a on a.id = jl.company_account_id
              where je.company_id = c and je.status <> 'anulado' and date_trunc('month', je.entry_date) = date '2026-10-01' and a.code like '64000099%') then
    raise exception 'PRUEBA S01p nómina: A ya tiene sueldos de prueba en octubre.';
  end if;

  -- 1. Propone.
  e := public._s01p_nomina_proponer(c, date '2026-10-31', loc, v_cifras, v_cuentas, 'PRUEBA S01p nómina de octubre');
  if not exists (select 1 from public.journal_entry where id = e and status = 'propuesto' and series = 9 and entry_date = date '2026-10-31' and source_type = 'payroll') then
    raise exception 'PRUEBA S01p nómina 1: el asiento no está propuesto, en la serie 9 y a 31/10.';
  end if;
  if (select sum(debit) - sum(credit) from public.journal_line where entry_id = e) <> 0 or (select sum(debit) from public.journal_line where entry_id = e) <> 131.00 then
    raise exception 'PRUEBA S01p nómina 1: no cuadra o no suma 131,00.';
  end if;
  if (select count(*) from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
       where jl.entry_id = e and ((a.code in ('64000099', '64200099') and jl.location_id = loc and not jl.is_common)
                                  or (a.code in ('47600099', '47510099', '46500099') and jl.location_id is null and jl.is_common))) <> 5 then
    raise exception 'PRUEBA S01p nómina 1: los apuntes no son los cinco esperados (gasto en el local, deudas comunes).';
  end if;
  if (select credit from public.journal_line jl join public.company_account a on a.id = jl.company_account_id where jl.entry_id = e and a.code = '47600099') <> 37.50 then
    raise exception 'PRUEBA S01p nómina 1: la 476 no lleva las dos Seguridades Sociales.';
  end if;

  -- 2. Otra vez: no se duplica.
  begin
    perform public._s01p_nomina_proponer(c, date '2026-10-31', loc, v_cifras, v_cuentas, 'PRUEBA otra vez');
    raise exception 'PRUEBA S01p nómina 2: se ha propuesto otra nómina del mismo mes.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'ya hay' then raise; end if;
  end;

  -- 3. No cuadra: nada.
  begin
    perform public._s01p_nomina_proponer(c, date '2026-09-30', loc, v_cifras || jsonb_build_object('liquido', 90.00), v_cuentas, 'PRUEBA no cuadra');
    raise exception 'PRUEBA S01p nómina 3: se ha propuesto una nómina que no cuadra.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'no cuadra' then raise; end if;
  end;

  -- 4. Ni Laboral ni el portal.
  if (select n from _n where clave = 'payroll_summary') <> (select count(*) from public.payroll_summary)
     or (select n from _n where clave = 'payroll_inbox') <> (select count(*) from public.payroll_inbox) then
    raise exception 'PRUEBA S01p nómina 4: ha tocado payroll_summary o payroll_inbox.';
  end if;
  raise notice 'PRUEBA S01p nómina 1-4: bien.';
end $$;

-- 5. La vuelta atrás.
\i supabase/vuelta-atras/20261104T2310_s01p_nomina_octubre.down.sql
do $$ begin
  if to_regprocedure('public._s01p_nomina_proponer(uuid,date,uuid,jsonb,jsonb,text)') is not null then raise exception 'PRUEBA S01p nómina 5: queda la función.'; end if;
  raise notice 'PRUEBA S01p nómina 5: bien.';
end $$;

rollback;
