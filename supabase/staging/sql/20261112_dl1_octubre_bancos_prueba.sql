-- supabase/staging/sql/20261112_dl1_octubre_bancos_prueba.sql
--
-- SOLO STAGING. Prueba de la DL1 · octubre de Llorente29 (1842). Todo en una
-- transacción con ROLLBACK, en la cuenta A, con una cuenta de banco, un extracto
-- y cuentas de mentira si no los tiene. Recorre el camino de producción (las
-- funciones), no solo el «sin Foodint». Nombra lo que añade: _dl1_casar.
--   1. Sin Foodint, la migración no hace nada (la cuenta A sigue igual).
--   2. Un movimiento del banco se casa como la persona («Apuntar sin factura»,
--      destino cuenta): queda casado y su asiento, propuesto con el banco por su
--      importe; se valida con _dl1_validar.
--   3. Otra vez el mismo movimiento: no se casa dos veces.
--   4. Un movimiento de otra empresa: para.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DL1 octubre: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
-- sin usuario: las funciones solo las llama una tanda, que corre como el dueño; dentro se pone el usuario de la persona al casar y validar.
set constraints all immediate;

\i supabase/migrations/20261105T1702_dl1_uber_saldos.sql
\i supabase/migrations/20261106T1750_dl1_uber_validar.sql
\i supabase/migrations/20261106T2052_dl1_adleta_autofacturas.sql
\i supabase/migrations/20261112T1451_dl1_cloudtown_enero.sql
create temp table prueba_antes on commit drop as select count(*) n from public.journal_entry where account_id = 'c01a0000-0000-4000-8000-00000000000a';
\i supabase/migrations/20261112T1842_dl1_octubre_bancos.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; v_admin uuid; t uuid; v_572 uuid; v_629 uuid;
  v_st uuid; v_m uuid; v_otro uuid; v_r jsonb; v_e uuid; v_n int; v_err text; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  -- 1. Sin Foodint, nada.
  if (select count(*) from public.journal_entry where account_id = v_acc) <> (select n from prueba_antes) then
    raise exception 'PRUEBA DL1 octubre 1: sin Foodint la migración ha apuntado algo en la cuenta A.';
  end if;

  select t2.id, t2.company_id into t, c from public.treasury_account t2 where t2.account_id = v_acc order by t2.created_at, t2.id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  if t is null or v_admin is null then raise exception 'PRUEBA DL1 octubre: a la cuenta A le falta una cuenta de banco o un administrador.'; end if;
  select id into y from public.fiscal_year where company_id = c and v_hoy between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, c, extract(year from v_hoy)::text, date_trunc('year', v_hoy)::date, (date_trunc('year', v_hoy) + interval '1 year - 1 day')::date);
  end if;
  if public._bank_cuenta_572(t) is null then
    select id into v_572 from public.company_account where company_id = c and code = '57200098';
    if v_572 is null then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, '57200098', 'PRUEBA DL1 Banco', 'own', 'pymes', 'manual', '572') returning id into v_572;
    end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_acc, c, v_572, 'bank_account', t::text, 'principal', 'manual');
  end if;
  select id into v_629 from public.company_account where company_id = c and code = '62900098';
  if v_629 is null then
    insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
    values (v_acc, c, '62900098', 'PRUEBA DL1 Otros servicios', 'own', 'pymes', 'manual', '629') returning id into v_629;
  end if;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, period_from, period_to, movements_count, new_count, repeated_count, continuity, unchecked_reason)
  values (v_acc, c, t, 'fichero', 'csv', v_hoy, v_hoy, 1, 1, 0, 'sin_saldo', 'PRUEBA') returning id into v_st;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, clean_concept, fingerprint, soft_fingerprint, status, reason)
  values (v_acc, c, t, v_st, v_hoy, v_hoy, -12.34, 'PRUEBA pago con tarjeta', 'prueba-dl1-' || gen_random_uuid(), 'prueba-dl1', 'por_aclarar', 'PRUEBA')
  returning id into v_m;

  -- 2. Casar como la persona y validar.
  v_r := public._dl1_casar(c, v_admin, 'Persona de prueba', v_m,
    jsonb_build_object('tipo', 'cuenta', 'concepto', 'Sin justificante · PRUEBA', 'lineas', jsonb_build_array(jsonb_build_object('cuenta', '62900098', 'importe', 12.34))),
    'PRUEBA sin justificante');
  v_e := (v_r->>'asiento')::uuid;
  if (select status from public.bank_movement where id = v_m) <> 'casado' or (select status from public.journal_entry where id = v_e) <> 'propuesto'
     or not exists (select 1 from public.journal_line where entry_id = v_e and company_account_id = v_629 and debit = 12.34) then
    raise exception 'PRUEBA DL1 octubre 2: el movimiento no está casado o su asiento no está propuesto con la 629 por 12,34.';
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') like '%' || v_admin::text || '%' then
    raise exception 'PRUEBA DL1 octubre 2: al casar se ha quedado puesto el usuario de la persona.';
  end if;
  v_n := public._dl1_validar(c, v_admin, 'Persona de prueba', jsonb_build_array(jsonb_build_object('id', v_e, 'importe', 12.34)));
  if v_n <> 1 or (select status from public.journal_entry where id = v_e) <> 'validado' then
    raise exception 'PRUEBA DL1 octubre 2: el asiento del casado no se ha validado.';
  end if;

  -- 3. Otra vez el mismo movimiento.
  begin
    perform public._dl1_casar(c, v_admin, 'Persona de prueba', v_m,
      jsonb_build_object('tipo', 'cuenta', 'lineas', jsonb_build_array(jsonb_build_object('cuenta', '62900098', 'importe', 12.34))), 'PRUEBA');
    raise exception 'PRUEBA DL1 octubre 3: se ha casado dos veces el mismo movimiento.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'ya está casado|una sola vez' then raise; end if;
  end;

  -- 4. Un movimiento que no es de la empresa.
  select id into v_otro from public.bank_movement where company_id <> c limit 1;
  begin
    perform public._dl1_casar(c, v_admin, 'Persona de prueba', coalesce(v_otro, gen_random_uuid()),
      jsonb_build_object('tipo', 'cuenta', 'lineas', '[]'::jsonb), 'PRUEBA');
    raise exception 'PRUEBA DL1 octubre 4: ha aceptado un movimiento de otra empresa.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'no es de la empresa' then raise; end if;
  end;
end $$;

select 'PRUEBA DL1 octubre: en verde' as resultado;
rollback;
