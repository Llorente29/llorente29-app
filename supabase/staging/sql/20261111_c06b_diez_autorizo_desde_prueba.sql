-- supabase/staging/sql/20261111_c06b_diez_autorizo_desde_prueba.sql
--
-- SOLO STAGING. Prueba de 20261111T0730 (C06b, respuesta 8, tarea 1): la
-- columna «desde» de public.conta_diez_autorizo y su CHECK. Todo en una
-- transacción con ROLLBACK: no cambia staging.
--
-- Por sus caminos, como los escribe el servidor (las autorizaciones solo las
-- escribe una tanda; los usuarios ni las leen):
--   0. La columna existe, es fecha y admite vacío; el CHECK está.
--   1. Empresa con «desde»: entra.
--   2. Asiento con «desde»: no entra (el asiento ya dice cuál).
--   3. Empresa sin «desde» y asiento sin «desde» (lo de hoy): entran.
--   4. Una sola autorización de empresa por base, con o sin fecha.
--   5. Un usuario sigue sin leerla.
-- Base inventada C0099 (no es C0001 ni la de pruebas): no se habla con Diez.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA C06b desde: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  v_emp uuid; v_entry uuid; v_falla text;
begin
  -- 0
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_diez_autorizo'
                  and column_name = 'desde' and data_type = 'date' and is_nullable = 'YES') then
    raise exception 'PRUEBA C06b desde · 0: falta la columna desde (date, admite vacío).';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.conta_diez_autorizo'::regclass and conname = 'conta_diez_autorizo_desde_check') then
    raise exception 'PRUEBA C06b desde · 0: falta conta_diez_autorizo_desde_check.';
  end if;
  raise notice 'PRUEBA C06b desde · 0: columna y CHECK: ok.';

  select id into v_emp from public.company where account_id = v_acc order by created_at limit 1;
  select id into v_entry from public.journal_entry where account_id = v_acc and company_id = v_emp order by created_at limit 1;
  if v_entry is null then raise exception 'PRUEBA C06b desde: la empresa de A no tiene asientos; la prueba no mediría el 2.'; end if;
  delete from public.conta_diez_autorizo where company_id = v_emp and nombre_bd = 'C0099';

  -- 1
  insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo, desde)
  values (v_acc, v_emp, 'empresa', null, 'C0099', 'Prueba C06b', 'Empresa desde el 01/10 (prueba)', '2026-10-01');
  raise notice 'PRUEBA C06b desde · 1: empresa desde 2026-10-01: entra.';

  -- 2
  begin
    insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo, desde)
    values (v_acc, v_emp, 'asiento', v_entry, 'C0099', 'Prueba C06b', 'Asiento con fecha (prueba)', '2026-10-01');
    v_falla := null;
  exception when check_violation then v_falla := sqlerrm; end;
  if v_falla is null or v_falla not like '%conta_diez_autorizo_desde_check%' then
    raise exception 'PRUEBA C06b desde · 2: un asiento con «desde» dio «%» (espero el CHECK).', coalesce(v_falla, 'entra');
  end if;
  raise notice 'PRUEBA C06b desde · 2: asiento con «desde» no entra (%).', left(v_falla, 100);

  -- 3
  insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo)
  values (v_acc, v_emp, 'asiento', v_entry, 'C0099', 'Prueba C06b', 'Asiento sin fecha (prueba)');
  delete from public.conta_diez_autorizo where company_id = v_emp and nombre_bd = 'C0099' and alcance = 'empresa';
  insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo)
  values (v_acc, v_emp, 'empresa', null, 'C0099', 'Prueba C06b', 'Empresa sin fecha (prueba)');
  raise notice 'PRUEBA C06b desde · 3: lo de hoy (asiento sin fecha, empresa sin fecha) sigue entrando.';

  -- 4
  begin
    insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo, desde)
    values (v_acc, v_emp, 'empresa', null, 'C0099', 'Prueba C06b', 'Otra de empresa (prueba)', '2026-11-01');
    v_falla := null;
  exception when unique_violation then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA C06b desde · 4: han entrado dos autorizaciones de empresa para la misma base.'; end if;
  raise notice 'PRUEBA C06b desde · 4: una sola de empresa por base (%).', left(v_falla, 90);
  perform set_config('prueba.emp', v_emp::text, true);
end $$;

-- 5
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_falla text;
begin
  begin perform count(*) from public.conta_diez_autorizo; v_falla := null;
  exception when insufficient_privilege then v_falla := sqlerrm; end;
  if v_falla is null then raise exception 'PRUEBA C06b desde · 5: un usuario lee conta_diez_autorizo.'; end if;
  raise notice 'PRUEBA C06b desde · 5: un usuario no la lee (%).', left(v_falla, 80);
end $$;
reset role;

rollback;
