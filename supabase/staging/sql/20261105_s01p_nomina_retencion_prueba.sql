-- supabase/staging/sql/20261105_s01p_nomina_retencion_prueba.sql
--
-- SOLO STAGING. Prueba de la retención de la nómina (0045). Todo en una
-- transacción con ROLLBACK, en la cuenta A, con cuentas de mentira si no las
-- tiene. El camino entero de una propuesta termina en VALIDAR (Julio, S01p·12;
-- regla 10). Nombra lo que cambia: _s01p_nomina_proponer,
-- _s01p_nomina_retencion_poner.
--   1. Propone la nómina de octubre de A con su retención en la 4751 (tipo
--      trabajo, base de IRPF, 111), la VALIDA con journal_entry_validar como el
--      administrador de A, y su retención entra en el 111 del 4T.
--   2. Una nómina propuesta sin retención (como la de Foodint): la retención se
--      pone en su línea, solo en esa, y entonces se VALIDA.
--   3. Sin base de IRPF no se propone nada.
--   4. La vuelta atrás devuelve la función de antes y quita la nueva.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p retención: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: las funciones las llama una tanda (el dueño); para validar, los «claims» del administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

\i supabase/migrations/20261105T0045_s01p_nomina_retencion.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; loc uuid; e uuid; e2 uuid; x record; v jsonb; r jsonb; v_err text;
  v_cuentas constant jsonb := jsonb_build_object('sueldos', '64000099', 'ss_empresa', '64200099', 'ss', '47600099', 'irpf', '47510099', 'pendiente', '46500099');
  v_cifras constant jsonb := jsonb_build_object('bruto', 100.00, 'ss_trabajador', 6.50, 'irpf', 2.00, 'liquido', 91.50, 'ss_empresa', 31.00, 'personas', 1, 'base_irpf', 100.00);
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-31' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31'); end if;
  select id into loc from public.locations where account_id = v_acc order by id limit 1;
  for x in select * from (values ('64000099', '640'), ('64200099', '642'), ('47600099', '476'), ('47510099', '4751'), ('46500099', '465')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA S01p ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;

  -- 1. Propone con su retención y se valida.
  e := public._s01p_nomina_proponer(c, date '2026-10-31', loc, v_cifras, v_cuentas, 'PRUEBA S01p nómina de octubre');
  if not exists (select 1 from public.journal_line jl join public.company_account a on a.id = jl.company_account_id join public.withholding_rate w on w.id = jl.withholding_rate_id
                  where jl.entry_id = e and a.code = '47510099' and w.code = 'trabajo' and jl.withholding_base = 100.00 and jl.withholding_model = '111') then
    raise exception 'PRUEBA S01p retención 1: la 4751 no lleva su tipo, su base y su modelo.';
  end if;
  v := public.journal_entry_validar(e, 'PRUEBA');
  if not exists (select 1 from public.journal_entry where id = e and status = 'validado') then raise exception 'PRUEBA S01p retención 1: no queda validado.'; end if;
  r := public.conta_impuesto_retenciones_diario(c, 2026, '4T');
  if strpos(r::text, e::text) = 0 then raise exception 'PRUEBA S01p retención 1: su retención no entra en el 111 del 4T: %', left(r::text, 400); end if;

  -- 2. Una propuesta sin retención (como la de Foodint): se pone y se valida.
  e2 := public._s01p_nomina_proponer(c, date '2026-11-30', loc, v_cifras, v_cuentas, 'PRUEBA S01p nómina sin retención');
  update public.journal_line set withholding_rate_id = null, withholding_base = null, withholding_model = null where entry_id = e2;
  begin
    perform public.journal_entry_validar(e2, 'PRUEBA');
    raise exception 'PRUEBA S01p retención 2: se valida una nómina sin retención (la regla no la para).';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~* 'retenci' then raise; end if;
  end;
  perform public._s01p_nomina_retencion_poner(e2, '47510099', 100.00);
  if (select count(*) from public.journal_line where entry_id = e2 and withholding_rate_id is not null) <> 1 then raise exception 'PRUEBA S01p retención 2: no es solo su línea.'; end if;
  v := public.journal_entry_validar(e2, 'PRUEBA');
  if not exists (select 1 from public.journal_entry where id = e2 and status = 'validado') then raise exception 'PRUEBA S01p retención 2: no queda validado.'; end if;

  -- 3. Sin base de IRPF, nada.
  begin
    perform public._s01p_nomina_proponer(c, date '2026-09-30', loc, v_cifras - 'base_irpf', v_cuentas, 'PRUEBA sin base');
    raise exception 'PRUEBA S01p retención 3: propone sin base de IRPF.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'falta la base de IRPF' then raise; end if;
  end;
  raise notice 'PRUEBA S01p retención 1-3: bien (validadas y en el 111 del 4T).';
end $$;

-- 4. La vuelta atrás.
\i supabase/vuelta-atras/20261105T0045_s01p_nomina_retencion.down.sql
do $$ begin
  if to_regprocedure('public._s01p_nomina_retencion_poner(uuid,text,numeric)') is not null then raise exception 'PRUEBA S01p retención 4: queda la función nueva.'; end if;
  if strpos(pg_get_functiondef('public._s01p_nomina_proponer(uuid,date,uuid,jsonb,jsonb,text)'::regprocedure), 'S01p·12') > 0 then raise exception 'PRUEBA S01p retención 4: no vuelve la función de antes.'; end if;
  raise notice 'PRUEBA S01p retención 4: bien.';
end $$;

rollback;
