-- supabase/staging/sql/20261113_b01r23_noviembre_bancos_prueba.sql
--
-- SOLO STAGING. Prueba de la B01r23 · noviembre de Llorente29 (0155). Todo en una
-- transacción con ROLLBACK, en la cuenta A, con una cuenta de banco y movimientos
-- de mentira. Recorre el camino de producción (las funciones), no solo el «sin
-- Foodint». Nombra lo que añade: _b01r23_ignorar. (_dl1_casar y _dl1_validar ya
-- los probó la 1842.)
--   1. Sin Foodint, la migración no hace nada (la cuenta A sigue igual).
--   2. Aparta, como la persona, uno por aclarar y uno propuesto: quedan
--      ignorados con su motivo y su línea en el historial.
--   3. Otra vez el mismo: ya no está sin casar, para.
--   4. Un importe o una fecha que no cuadran: para y no aparta ninguno.
--   5. Un movimiento de otra empresa: para.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01r23: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set constraints all immediate;

create temp table prueba_antes on commit drop as
  select (select count(*) from public.journal_entry where account_id = 'c01a0000-0000-4000-8000-00000000000a') asientos,
         (select count(*) from public.bank_movement where account_id = 'c01a0000-0000-4000-8000-00000000000a' and status = 'ignorado') ignorados;
\i supabase/migrations/20261113T0155_b01r23_noviembre_bancos.sql

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; v_admin uuid; t uuid; v_st uuid; v_m1 uuid; v_m2 uuid; v_otro uuid;
  v_n int; v_err text; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  -- 1. Sin Foodint, nada.
  if (select count(*) from public.journal_entry where account_id = v_acc) <> (select asientos from prueba_antes)
     or (select count(*) from public.bank_movement where account_id = v_acc and status = 'ignorado') <> (select ignorados from prueba_antes) then
    raise exception 'PRUEBA B01r23 1: sin Foodint la migración ha tocado algo en la cuenta A.';
  end if;

  select t2.id, t2.company_id into t, c from public.treasury_account t2 where t2.account_id = v_acc order by t2.created_at, t2.id limit 1;
  select up.user_id into v_admin from public.user_profiles up where up.account_id = v_acc and up.role = 'admin' and up.active order by up.user_id limit 1;
  if t is null or v_admin is null then raise exception 'PRUEBA B01r23: a la cuenta A le falta una cuenta de banco o un administrador.'; end if;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, period_from, period_to, movements_count, new_count, repeated_count, continuity, unchecked_reason)
  values (v_acc, c, t, 'fichero', 'csv', v_hoy, v_hoy, 2, 2, 0, 'sin_saldo', 'PRUEBA') returning id into v_st;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, clean_concept, fingerprint, soft_fingerprint, status, reason)
  values (v_acc, c, t, v_st, v_hoy, v_hoy, -31.50, 'PRUEBA adeudo anulado', 'prueba-b01r23-' || gen_random_uuid(), 'prueba-b01r23-1', 'por_aclarar', 'PRUEBA')
  returning id into v_m1;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, clean_concept, fingerprint, soft_fingerprint, status, reason)
  values (v_acc, c, t, v_st, v_hoy, v_hoy, 0, 'PRUEBA comprobación de tarjeta', 'prueba-b01r23-' || gen_random_uuid(), 'prueba-b01r23-2', 'propuesto', 'PRUEBA')
  returning id into v_m2;

  -- 4 (antes que 2). Un importe que no cuadra: para y no aparta ninguno.
  begin
    perform public._b01r23_ignorar(c, v_admin, 'PRUEBA', jsonb_build_array(
      jsonb_build_object('id', v_m1, 'importe', -31.50, 'fecha', v_hoy), jsonb_build_object('id', v_m2, 'importe', 1, 'fecha', v_hoy)));
    raise exception 'PRUEBA B01r23 4: ha apartado con un importe que no cuadra.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'se esperaba' then raise; end if;
  end;
  if (select count(*) from public.bank_movement where id in (v_m1, v_m2) and status = 'ignorado') <> 0 then
    raise exception 'PRUEBA B01r23 4: después de parar, alguno ha quedado apartado.';
  end if;

  -- 2. Aparta uno por aclarar y uno propuesto, como la persona.
  v_n := public._b01r23_ignorar(c, v_admin, 'Anulado por el banco: no había saldo', jsonb_build_array(jsonb_build_object('id', v_m1, 'importe', -31.50, 'fecha', v_hoy)));
  v_n := v_n + public._b01r23_ignorar(c, v_admin, 'Comprobación de tarjeta', jsonb_build_array(jsonb_build_object('id', v_m2, 'importe', 0, 'fecha', v_hoy)));
  if v_n <> 2
     or (select ignored_reason from public.bank_movement where id = v_m1 and status = 'ignorado') is distinct from 'Anulado por el banco: no había saldo'
     or (select ignored_reason from public.bank_movement where id = v_m2 and status = 'ignorado') is distinct from 'Comprobación de tarjeta' then
    raise exception 'PRUEBA B01r23 2: no ha apartado los dos con su motivo.';
  end if;
  if (select count(*) from public.bank_activity_log where movement_id in (v_m1, v_m2) and action = 'ignorado' and by_who = 'persona') <> 2 then
    raise exception 'PRUEBA B01r23 2: falta la línea del historial de lo apartado.';
  end if;
  if coalesce(current_setting('request.jwt.claims', true), '') like '%' || v_admin::text || '%' then
    raise exception 'PRUEBA B01r23 2: al apartar se ha quedado puesto el usuario de la persona.';
  end if;

  -- 3. Otra vez el mismo: ya no está sin casar.
  begin
    perform public._b01r23_ignorar(c, v_admin, 'PRUEBA', jsonb_build_array(jsonb_build_object('id', v_m1, 'importe', -31.50, 'fecha', v_hoy)));
    raise exception 'PRUEBA B01r23 3: ha apartado dos veces el mismo movimiento.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'ya no está sin casar' then raise; end if;
  end;

  -- 5. Un movimiento de otra empresa.
  select id into v_otro from public.bank_movement where company_id <> c limit 1;
  begin
    perform public._b01r23_ignorar(c, v_admin, 'PRUEBA', jsonb_build_array(jsonb_build_object('id', coalesce(v_otro, gen_random_uuid()), 'importe', 0, 'fecha', v_hoy)));
    raise exception 'PRUEBA B01r23 5: ha aceptado un movimiento de otra empresa.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'no está en la empresa' then raise; end if;
  end;
end $$;

select 'PRUEBA B01r23 noviembre: en verde' as resultado;
rollback;
