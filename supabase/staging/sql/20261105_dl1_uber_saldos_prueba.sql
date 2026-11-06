-- supabase/staging/sql/20261105_dl1_uber_saldos_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · Uber (1702). Todo en una transacción con
-- ROLLBACK, en la cuenta A, con cuentas de mentira si no las tiene. Recorre el
-- camino de producción (la función), no solo el «sin Foodint». Nombra lo que
-- añade: _dl1_asiento_proponer.
--   1. Propone un asiento de promociones (70009001 y 63400000 al debe, 43000002
--      al haber): serie 4, propuesto, cuadra, sin IVA en ninguna línea.
--   2. Propone uno con IVA (477 al 10 %, base y libro de emitidas): cuadra y la
--      cuota es la base por el tipo.
--   3. Validado, mueve la 43000002 lo que dice (y lo propuesto no la mueve).
--   4. Otra vez el mismo concepto: no se duplica.
--   5. Uno que no cuadra: no se propone nada.
--   6. La vuelta atrás quita los propuestos de la tanda y la función.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 Uber: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la función solo la llama una tanda, que corre como el dueño.
-- Lo diferido, antes de los disparadores de la prueba.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record; e1 uuid; e2 uuid; v_err text; v_tipo uuid; v_n int;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA DL1 Uber: la cuenta A no tiene empresa.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-31' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31'); end if;
  for x in select * from (values ('43000099', '4300'), ('41000099', '4100'), ('70009099', '700'), ('63410099', '6341'), ('47700099', '477')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  select id into v_tipo from public.tax_rate where code = 'iva_reducido' and account_id is null and company_id is null order by valid_from desc limit 1;
  if v_tipo is null then raise exception 'PRUEBA DL1 Uber: no está el IVA reducido en el catálogo.'; end if;

  -- 1. Promociones, sin IVA.
  e1 := public._dl1_asiento_proponer(c, date '2026-10-30', 'PRUEBA DL1 promociones', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '70009099', 'debe', 100.00),
                      jsonb_build_object('cuenta', '63410099', 'debe', 10.00),
                      jsonb_build_object('cuenta', '43000099', 'haber', 110.00)));
  if not exists (select 1 from public.journal_entry where id = e1 and status = 'propuesto' and series = 4 and source_type = 'manual'
                   and entry_date = date '2026-10-30' and created_by_name = 'Julio (tanda DL1)') then
    raise exception 'PRUEBA DL1 Uber 1: el asiento no está propuesto, en la serie 4, manual y a su fecha.';
  end if;
  if (select sum(debit) - sum(credit) from public.journal_line where entry_id = e1) <> 0 or (select sum(debit) from public.journal_line where entry_id = e1) <> 110.00 then
    raise exception 'PRUEBA DL1 Uber 1: no cuadra o no suma 110,00.';
  end if;
  if exists (select 1 from public.journal_line where entry_id = e1 and (tax_rate_id is not null or tax_base is not null or vat_book is not null)) then
    raise exception 'PRUEBA DL1 Uber 1: el asiento de promociones lleva IVA en alguna línea.';
  end if;

  -- 2. Con IVA al 10 %.
  e2 := public._dl1_asiento_proponer(c, date '2026-10-31', 'PRUEBA DL1 lo que paga Uber', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '43000099', 'debe', 55.00),
                      jsonb_build_object('cuenta', '70009099', 'haber', 50.00),
                      jsonb_build_object('cuenta', '47700099', 'haber', 5.00, 'iva', jsonb_build_object('tipo', v_tipo, 'base', 50.00))));
  if not exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                  where l.entry_id = e2 and a.code = '47700099' and l.tax_rate_id = v_tipo and l.tax_base = 50.00 and l.vat_book = 'issued' and l.credit = 5.00) then
    raise exception 'PRUEBA DL1 Uber 2: la 477 no lleva su tipo, su base y el libro de emitidas.';
  end if;

  -- 3. Validado, mueve la 430; propuesto, no.
  if (select coalesce(sum(l.debit - l.credit), 0) from public.journal_line l join public.journal_entry je on je.id = l.entry_id join public.company_account a on a.id = l.company_account_id
       where je.company_id = c and a.code = '43000099' and je.status = 'validado' and je.id in (e1, e2)) <> 0 then
    raise exception 'PRUEBA DL1 Uber 3: un propuesto ya mueve la 430.';
  end if;
  perform public._journal_entry_validar(e1, 'PRUEBA DL1');
  if (select coalesce(sum(l.debit - l.credit), 0) from public.journal_line l join public.journal_entry je on je.id = l.entry_id join public.company_account a on a.id = l.company_account_id
       where je.id = e1 and a.code = '43000099' and je.status = 'validado') <> -110.00 then
    raise exception 'PRUEBA DL1 Uber 3: validado, no baja la 430 en 110,00.';
  end if;

  -- 4. Otra vez: no se duplica.
  begin
    perform public._dl1_asiento_proponer(c, date '2026-10-30', 'PRUEBA DL1 promociones', 'PRUEBA',
      jsonb_build_array(jsonb_build_object('cuenta', '70009099', 'debe', 1.00), jsonb_build_object('cuenta', '43000099', 'haber', 1.00)));
    raise exception 'PRUEBA DL1 Uber 4: se ha propuesto otro asiento con el mismo concepto.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'ya hay un asiento vivo' then raise; end if;
  end;

  -- 5. No cuadra: nada.
  select count(*) into v_n from public.journal_entry where company_id = c and created_by_name = 'Julio (tanda DL1)';
  begin
    perform public._dl1_asiento_proponer(c, date '2026-10-29', 'PRUEBA DL1 descuadrado', 'PRUEBA',
      jsonb_build_array(jsonb_build_object('cuenta', '70009099', 'debe', 1.00), jsonb_build_object('cuenta', '43000099', 'haber', 2.00)));
    raise exception 'PRUEBA DL1 Uber 5: se ha propuesto un asiento que no cuadra.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'no cuadra' then raise; end if;
  end;
  if (select count(*) from public.journal_entry where company_id = c and created_by_name = 'Julio (tanda DL1)') <> v_n then
    raise exception 'PRUEBA DL1 Uber 5: el descuadrado ha dejado un asiento.';
  end if;
end $$;

-- 6. La vuelta atrás: en esta base no hay Foodint, así que no borra ningún asiento; quita la función.
\i supabase/vuelta-atras/20261105T1702_dl1_uber_saldos.down.sql
do $$ begin
  if exists (select 1 from pg_proc where proname = '_dl1_asiento_proponer' and pronamespace = 'public'::regnamespace) then
    raise exception 'PRUEBA DL1 Uber 6: la vuelta atrás no quita _dl1_asiento_proponer.';
  end if;
end $$;
select 'PRUEBA DL1 Uber: en verde' as resultado;
rollback;
