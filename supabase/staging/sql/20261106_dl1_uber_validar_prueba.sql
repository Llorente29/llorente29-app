-- supabase/staging/sql/20261106_dl1_uber_validar_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · validar por tanda (1750). Todo en una
-- transacción con ROLLBACK, en la cuenta A, con cuentas de mentira si no las
-- tiene. Recorre el camino de producción (la función), no solo el «sin
-- Foodint». Nombra lo que añade: _dl1_validar.
--   1. Valida dos asientos propuestos, uno en un mes cerrado por el corte con
--      el programa de antes (sin IVA: el candado del #484 lo deja pasar), como
--      la persona: validated_by es su usuario y validated_by_name, su nombre;
--      cada uno con su número de serie.
--   2. Otra vez los mismos: ya no están propuestos, para.
--   3. Un importe que no es el esperado: para y no valida ninguno.
--   4. Uno que no se puede validar (lleva IVA en el mes cerrado): para y no
--      deja validado ninguno de la lista.
--   5. Un asiento de otra empresa: para.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 validar: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: la función solo la llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record; v_admin uuid; v_tipo uuid;
  e1 uuid; e2 uuid; e3 uuid; v_err text; v_n int; v_mes date;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA DL1 validar: la cuenta A no tiene empresa.'; end if;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  if v_admin is null then raise exception 'PRUEBA DL1 validar: la cuenta A no tiene administrador.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-10-31' between starts_on and ends_on;
  if y is null then insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31'); end if;
  for x in select * from (values ('43000099', '4300'), ('70009099', '700'), ('63410099', '6341'), ('47700099', '477')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA DL1 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  select id into v_tipo from public.tax_rate where code = 'iva_reducido' and account_id is null and company_id is null order by valid_from desc limit 1;

  -- Un mes cerrado por el corte con el programa de antes, como enero a septiembre en Foodint.
  v_mes := date '2026-03-01';
  if not exists (select 1 from public.fiscal_period_lock where company_id = c and month = v_mes) then
    insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind)
    select v_acc, c, fy.id, v_mes, 'migrated' from public.fiscal_year fy where fy.company_id = c and v_mes between fy.starts_on and fy.ends_on;
  end if;

  e1 := public._dl1_asiento_proponer(c, date '2026-03-31', 'PRUEBA DL1 validar · marzo', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '70009099', 'debe', 100.00), jsonb_build_object('cuenta', '63410099', 'debe', 10.00),
                      jsonb_build_object('cuenta', '43000099', 'haber', 110.00)));
  e2 := public._dl1_asiento_proponer(c, date '2026-10-31', 'PRUEBA DL1 validar · octubre', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '70009099', 'debe', 20.00), jsonb_build_object('cuenta', '43000099', 'haber', 20.00)));

  -- 3. Un importe que no es el esperado: para y no valida ninguno.
  begin
    perform public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(
      jsonb_build_object('id', e1, 'importe', 110.00), jsonb_build_object('id', e2, 'importe', 21.00)));
    raise exception 'PRUEBA DL1 validar 3: ha validado con un importe que no es el esperado.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'se esperaba' then raise; end if;
  end;
  if exists (select 1 from public.journal_entry where id in (e1, e2) and status <> 'propuesto') then
    raise exception 'PRUEBA DL1 validar 3: con un importe mal ha dejado alguno validado.';
  end if;

  -- 5. Un asiento de otra empresa: para.
  begin
    perform public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'importe', 1)));
    raise exception 'PRUEBA DL1 validar 5: ha aceptado un asiento que no es de la empresa.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'no está en la empresa' then raise; end if;
  end;

  -- 1. Los dos, como la persona.
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(
    jsonb_build_object('id', e2, 'importe', 20.00), jsonb_build_object('id', e1, 'importe', 110.00)));
  if v_n <> 2 then raise exception 'PRUEBA DL1 validar 1: dice % validados y eran 2.', v_n; end if;
  if (select count(*) from public.journal_entry where id in (e1, e2) and status = 'validado' and number is not null and hash is not null and hash <> 'pendiente'
        and validated_by = v_admin and validated_by_name = 'Persona de prueba') <> 2 then
    raise exception 'PRUEBA DL1 validar 1: no están los dos validados, con número y huella, a nombre de la persona.';
  end if;
  if (select number from public.journal_entry where id = e1) > (select number from public.journal_entry where id = e2) then
    raise exception 'PRUEBA DL1 validar 1: no se han validado por fecha (marzo antes que octubre).';
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') like '%' || v_admin::text || '%' then
    raise exception 'PRUEBA DL1 validar 1: al acabar se ha quedado puesto el usuario de la persona.';
  end if;

  -- 2. Otra vez: ya no están propuestos.
  begin
    perform public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', e1, 'importe', 110.00)));
    raise exception 'PRUEBA DL1 validar 2: ha vuelto a validar uno ya validado.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'ya no está propuesto' then raise; end if;
  end;

  -- 4. Uno con IVA en el mes cerrado (no se puede validar) junto a uno bueno: para y no deja ninguno validado.
  e3 := public._dl1_asiento_proponer(c, date '2026-10-30', 'PRUEBA DL1 validar · bueno', 'PRUEBA',
    jsonb_build_array(jsonb_build_object('cuenta', '70009099', 'debe', 5.00), jsonb_build_object('cuenta', '43000099', 'haber', 5.00)));
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason, created_by_name)
  select v_acc, c, fy.id, 4, date '2026-03-30', 'PRUEBA DL1 validar · con IVA en marzo', 'manual', 'propuesto', 'seguro', 'PRUEBA', 'PRUEBA'
    from public.fiscal_year fy where fy.company_id = c and date '2026-03-30' between fy.starts_on and fy.ends_on
  returning id into e1;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common, tax_rate_id, tax_base, vat_book, tax_documents)
  select v_acc, c, e1, 1, a.id, 11.00, 0, true, null::uuid, null::numeric, null::text, 1 from public.company_account a where a.company_id = c and a.code = '43000099'
  union all
  select v_acc, c, e1, 2, a.id, 0, 10.00, true, null, null, null, 1 from public.company_account a where a.company_id = c and a.code = '70009099'
  union all
  select v_acc, c, e1, 3, a.id, 0, 1.00, true, v_tipo, 10.00, 'issued', 1 from public.company_account a where a.company_id = c and a.code = '47700099';
  begin
    perform public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(
      jsonb_build_object('id', e3, 'importe', 5.00), jsonb_build_object('id', e1, 'importe', 11.00)));
    raise exception 'PRUEBA DL1 validar 4: ha validado un asiento con IVA en un mes cerrado.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'lleva IVA' then raise; end if;
  end;
  if exists (select 1 from public.journal_entry where id in (e1, e3) and status <> 'propuesto') then
    raise exception 'PRUEBA DL1 validar 4: al parar ha dejado alguno de la lista validado.';
  end if;
end $$;

select 'PRUEBA DL1 validar: en verde' as resultado;
rollback;
