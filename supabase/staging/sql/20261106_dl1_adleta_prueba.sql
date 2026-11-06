-- supabase/staging/sql/20261106_dl1_adleta_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · Adleta (2052). Todo en una transacción con
-- ROLLBACK, en la cuenta A, con cuentas de mentira si no las tiene. Recorre el
-- camino de producción (la función), no solo el «sin Foodint». Nombra lo que
-- añade: _dl1_venta_proponer.
--   1. Propone una autofactura: serie 1, la 430 por el total con su documento,
--      la 705 repartida por local (con su local, no común) y la 477 con su tipo,
--      su base y el libro de emitidas; cuadra.
--   2. Se valida con _dl1_validar, como la persona, y la 430 sube el total.
--   3. Uno a 01/01 contra la 113, en un mes cerrado por el corte (sin IVA): se
--      propone y se valida.
--   4. Otra vez el mismo concepto: no se duplica.
--   5. Un local que no es de la cuenta: para.
--   6. Uno que no cuadra: para.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 Adleta: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la función solo la llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona al validar.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record; v_admin uuid; v_tipo uuid;
  l1 uuid; l2 uuid; e1 uuid; e2 uuid; v_err text; v_n int; v_otro uuid;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA DL1 Adleta: la cuenta A no tiene empresa.'; end if;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  select id into l1 from public.locations where account_id = v_acc order by id limit 1;
  select id into l2 from public.locations where account_id = v_acc and id <> l1 order by id limit 1;
  if v_admin is null or l1 is null or l2 is null then raise exception 'PRUEBA DL1 Adleta: la cuenta A no tiene administrador o dos locales.'; end if;
  select id into v_otro from public.locations where account_id <> v_acc order by id limit 1;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-31' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31'); end if;
  for x in select * from (values ('43000098', '4300'), ('70500099', '705'), ('47700099', '477'), ('11300099', '113')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  select id into v_tipo from public.tax_rate where code = 'iva_reducido' and account_id is null and company_id is null order by valid_from desc limit 1;
  if not exists (select 1 from public.fiscal_period_lock where company_id = c and month = date '2026-01-01') then
    insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind)
    select v_acc, c, fy.id, date '2026-01-01', 'migrated' from public.fiscal_year fy where fy.company_id = c and date '2026-01-01' between fy.starts_on and fy.ends_on;
  end if;

  -- 1. Una autofactura.
  e1 := public._dl1_venta_proponer(c, date '2026-10-01', 1, 'PRUEBA Autofactura Adleta LF-0 · abril 1-15 · apuntada el 01/10', 'PRUEBA',
    jsonb_build_array(
      jsonb_build_object('cuenta', '43000098', 'debe', 110.00, 'documento', 'LF-0'),
      jsonb_build_object('cuenta', '70500099', 'haber', 60.00, 'local', l1),
      jsonb_build_object('cuenta', '70500099', 'haber', 40.00, 'local', l2),
      jsonb_build_object('cuenta', '47700099', 'haber', 10.00, 'iva', jsonb_build_object('tipo', v_tipo, 'base', 100.00))));
  if not exists (select 1 from public.journal_entry where id = e1 and status = 'propuesto' and series = 1 and entry_date = date '2026-10-01') then
    raise exception 'PRUEBA DL1 Adleta 1: no está propuesto, en la serie 1 y a 01/10.';
  end if;
  if (select count(*) from public.journal_line jl join public.company_account a on a.id = jl.company_account_id
       where jl.entry_id = e1 and ((a.code = '70500099' and jl.location_id in (l1, l2) and not jl.is_common)
                                   or (a.code = '43000098' and jl.document_ref = 'LF-0' and jl.debit = 110.00)
                                   or (a.code = '47700099' and jl.tax_rate_id = v_tipo and jl.tax_base = 100.00 and jl.vat_book = 'issued'))) <> 4 then
    raise exception 'PRUEBA DL1 Adleta 1: las líneas no son las esperadas (705 por local, 430 con su documento, 477 con su IVA).';
  end if;

  -- 3. Uno a 01/01 contra la 113, en el mes cerrado.
  e2 := public._dl1_venta_proponer(c, date '2026-01-01', 1, 'PRUEBA Autofactura Adleta · diciembre · contra la 113', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '43000098', 'debe', 50.00, 'documento', 'Adleta diciembre'),
                      jsonb_build_object('cuenta', '11300099', 'haber', 50.00)));

  -- 2. Validados como la persona.
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(
    jsonb_build_object('id', e1, 'importe', 110.00), jsonb_build_object('id', e2, 'importe', 50.00)));
  if v_n <> 2 or (select count(*) from public.journal_entry where id in (e1, e2) and status = 'validado' and validated_by = v_admin) <> 2 then
    raise exception 'PRUEBA DL1 Adleta 2: no se han validado los dos como la persona.';
  end if;
  if (select sum(jl.debit - jl.credit) from public.journal_line jl join public.journal_entry je on je.id = jl.entry_id join public.company_account a on a.id = jl.company_account_id
       where je.id in (e1, e2) and a.code = '43000098' and je.status = 'validado') <> 160.00 then
    raise exception 'PRUEBA DL1 Adleta 2: la 430 no sube 160,00.';
  end if;

  -- 4. Otra vez el mismo concepto.
  begin
    perform public._dl1_venta_proponer(c, date '2026-10-01', 1, 'PRUEBA Autofactura Adleta LF-0 · abril 1-15 · apuntada el 01/10', 'PRUEBA',
      jsonb_build_array(jsonb_build_object('cuenta', '43000098', 'debe', 1.00), jsonb_build_object('cuenta', '70500099', 'haber', 1.00, 'local', l1)));
    raise exception 'PRUEBA DL1 Adleta 4: se ha propuesto otro con el mismo concepto.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'ya hay un asiento vivo' then raise; end if;
  end;

  -- 5. Un local que no es de la cuenta.
  if v_otro is not null then
    begin
      perform public._dl1_venta_proponer(c, date '2026-10-02', 1, 'PRUEBA local ajeno', 'PRUEBA',
        jsonb_build_array(jsonb_build_object('cuenta', '43000098', 'debe', 1.00), jsonb_build_object('cuenta', '70500099', 'haber', 1.00, 'local', v_otro)));
      raise exception 'PRUEBA DL1 Adleta 5: ha aceptado un local de otra cuenta.';
    exception when others then
      get stacked diagnostics v_err = message_text;
      if v_err !~ 'no es de la cuenta' then raise; end if;
    end;
  end if;

  -- 6. No cuadra.
  begin
    perform public._dl1_venta_proponer(c, date '2026-10-02', 1, 'PRUEBA descuadrado', 'PRUEBA',
      jsonb_build_array(jsonb_build_object('cuenta', '43000098', 'debe', 2.00), jsonb_build_object('cuenta', '70500099', 'haber', 1.00, 'local', l1)));
    raise exception 'PRUEBA DL1 Adleta 6: se ha propuesto uno que no cuadra.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'no cuadra' then raise; end if;
  end;
end $$;

select 'PRUEBA DL1 Adleta: en verde' as resultado;
rollback;
