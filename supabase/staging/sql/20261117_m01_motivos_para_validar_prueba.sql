-- supabase/staging/sql/20261117_m01_motivos_para_validar_prueba.sql
--
-- SOLO STAGING. Prueba de 20261117T0100_m01_motivos_para_validar
-- (public.journal_entry_validar y public.tg_journal_entry_envio_por_aclarar, y
-- lo que añade: conta_motivos_para_validar y conta_esperan), en la empresa de la
-- cuenta A de pruebas. Las migraciones se aplican DENTRO de la transacción (\i)
-- y todo acaba en ROLLBACK: staging es compartido y no cambia.
--
-- Va DESPUÉS de la tanda de C (#210): si staging aún no tiene
-- 20261116T0100_c06b_promociones_envios, se aplica aquí primero (dentro de la
-- misma transacción), y «antes» es la versión de C.
--
-- Cada caso se valida como lo valida la pantalla, como usuario (el
-- administrador de la cuenta A), con la validación de ANTES y con la NUEVA:
--   1. Un asiento bien hecho: se valida antes y después, y no sale en «Esperan».
--   2. No cuadra (100,00 / 90,00): para con el mismo texto antes y después.
--   3. Un solo apunte: igual.
--   4. Un apunte sin local y sin marcar como común: igual («apunte 2 (…)»).
--   5. Fecha en un mes cerrado: igual (el cierre se crea aquí y se deshace).
-- Y en los cinco: el primer motivo de conta_motivos_para_validar es,
-- palabra por palabra, el texto con el que para la validación nueva (la regla
-- vive en un sitio); conta_esperan, como usuario, da del 2 al 5 con ese texto
-- y no da el 1; y el disparador del envío por aclarar sigue puesto y lee su
-- motivo de la función (los casos del envío los prueba la de C, que se vuelve
-- a pasar después de esta).
--
-- Lo de antes y lo de después se guarda en ajustes de la sesión
-- (prueba_motivos.*), que valen para cualquier rol.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA motivos: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- La tanda de C, si staging aún no la tiene (va antes que esta).
select not exists (select 1 from pg_proc where proname = 'tg_journal_entry_envio_por_aclarar' and pronamespace = 'public'::regnamespace) as falta_c06b \gset
\if :falta_c06b
\echo '>>> Staging aún no tiene la tanda de C: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261116T0100_c06b_promociones_envios.sql
\endif

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

-- Los asientos de los casos, en borrador, en la empresa A (como postgres: es
-- la preparación, no lo que se prueba). El mes cerrado del caso 5, también.
do $$
declare
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_y uuid; c572 uuid; c700 uuid; e uuid;
  r record;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026' and status = 'open';
  select id into c572 from public.company_account where company_id = emp and code = '57200001';
  select id into c700 from public.company_account where company_id = emp and code = '70000000';
  if v_y is null or c572 is null or c700 is null then
    raise exception 'PRUEBA motivos · 0: faltan el ejercicio 2026 abierto o las cuentas 57200001 y 70000000 de la empresa A en staging.';
  end if;
  if public.conta_mes_cerrado(emp, '2026-10-13') then
    raise exception 'PRUEBA motivos · 0: octubre de la empresa A está cerrado en staging: los casos 1 a 4 necesitan un mes abierto.';
  end if;
  insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by_name)
  select a, emp, v_y, '2026-03-01', 'manual', 'Prueba de los motivos'
   where not public.conta_mes_cerrado(emp, '2026-03-01');

  for r in select * from (values
      ('m1', date '2026-10-13', 100.00, 100.00, true),
      ('m2', date '2026-10-13', 100.00, 90.00, true),
      ('m3', date '2026-10-13', 100.00, null, true),
      ('m4', date '2026-10-13', 100.00, 100.00, false),
      ('m5', date '2026-03-10', 100.00, 100.00, true)) v(k, fecha, debe, haber, con_local)
  loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, emp, v_y, 1, r.fecha, 'Prueba de los motivos · ' || r.k, 'manual') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, is_common)
    values (a, emp, e, 1, c572, r.debe, 0, loc, false);
    if r.haber is not null then
      insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, is_common)
      values (a, emp, e, 2, c700, 0, r.haber, case when r.con_local then loc end, false);
    end if;
    perform set_config('prueba_motivos.' || r.k, e::text, true);
  end loop;
end $$;

-- Lo que dice cada caso con la validación de ANTES, como usuario. Cada
-- validación va en un subbloque que se deshace: aquí no queda nada validado.
set local role authenticated;
do $$
declare k text; v_msg text;
begin
  foreach k in array array['m1', 'm2', 'm3', 'm4', 'm5'] loop
    begin
      perform public.journal_entry_validar(current_setting('prueba_motivos.' || k)::uuid);
      raise exception using errcode = 'P0001', message = 'VALIDA';
    exception
      when check_violation then v_msg := sqlerrm;
      when raise_exception then if sqlerrm <> 'VALIDA' then raise; end if; v_msg := 'se valida';
    end;
    perform set_config('prueba_motivos.' || k || '_antes', v_msg, true);
  end loop;
end $$;
reset role;

-- La migración, la misma que irá a producción.
\i supabase/migrations/20261117T0100_m01_motivos_para_validar.sql

-- Lo mismo con la validación NUEVA, y lo que dicen las dos funciones nuevas, como usuario.
set local role authenticated;
do $$
declare k text; v_msg text; v_motivo text; v_esperan text;
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  foreach k in array array['m1', 'm2', 'm3', 'm4', 'm5'] loop
    begin
      perform public.journal_entry_validar(current_setting('prueba_motivos.' || k)::uuid);
      raise exception using errcode = 'P0001', message = 'VALIDA';
    exception
      when check_violation then v_msg := sqlerrm;
      when raise_exception then if sqlerrm <> 'VALIDA' then raise; end if; v_msg := 'se valida';
    end;
    select m.motivo into v_motivo from public.conta_motivos_para_validar(current_setting('prueba_motivos.' || k)::uuid) m order by m.orden limit 1;
    select string_agg(x.motivo, ' | ' order by x.orden) into v_esperan
      from public.conta_esperan(emp, '2026-01-01', '2026-12-31') x where x.entry_id = current_setting('prueba_motivos.' || k)::uuid;
    perform set_config('prueba_motivos.' || k || '_despues', v_msg, true);
    perform set_config('prueba_motivos.' || k || '_motivo', coalesce(v_motivo, 'ninguno'), true);
    perform set_config('prueba_motivos.' || k || '_esperan', coalesce(v_esperan, 'no sale'), true);
  end loop;
end $$;
reset role;

do $$
declare
  k text; antes text; despues text; motivo text; esperan text;
  g constant text := 'prueba_motivos.';
begin
  foreach k in array array['m1', 'm2', 'm3', 'm4', 'm5'] loop
    antes := current_setting(g || k || '_antes'); despues := current_setting(g || k || '_despues');
    motivo := current_setting(g || k || '_motivo'); esperan := current_setting(g || k || '_esperan');
    raise notice '%: antes «%» · ahora «%» · motivo «%» · Esperan «%»', k, antes, despues, motivo, esperan;
    if antes is distinct from despues then
      raise exception 'PRUEBA motivos · %: la validación ha cambiado lo que dice: antes «%», ahora «%».', k, antes, despues;
    end if;
  end loop;

  -- 1 · Bien hecho: se valida y no espera.
  if current_setting(g || 'm1_despues') <> 'se valida' or current_setting(g || 'm1_motivo') <> 'ninguno' or current_setting(g || 'm1_esperan') <> 'no sale' then
    raise exception 'PRUEBA motivos · 1: un asiento bien hecho tenía que validarse y no esperar.';
  end if;
  -- 2 a 5 · Paran, y su motivo y su línea de «Esperan» son el texto con el que paran.
  foreach k in array array['m2', 'm3', 'm4', 'm5'] loop
    despues := current_setting(g || k || '_despues');
    if despues = 'se valida' then raise exception 'PRUEBA motivos · %: tenía que parar y se valida.', k; end if;
    if current_setting(g || k || '_motivo') <> despues then
      raise exception 'PRUEBA motivos · %: el primer motivo «%» no es el texto con el que para «%».', k, current_setting(g || k || '_motivo'), despues;
    end if;
    if split_part(current_setting(g || k || '_esperan'), ' | ', 1) <> despues then
      raise exception 'PRUEBA motivos · %: «Esperan» dice «%» y la validación «%».', k, current_setting(g || k || '_esperan'), despues;
    end if;
  end loop;
  if current_setting(g || 'm2_despues') not like 'No cuadra: Debe 100.00 y Haber 90.00, diferencia 10.00.' then
    raise exception 'PRUEBA motivos · 2: «%».', current_setting(g || 'm2_despues');
  end if;
  if current_setting(g || 'm3_despues') <> 'Un asiento lleva al menos dos apuntes.' then
    raise exception 'PRUEBA motivos · 3: «%».', current_setting(g || 'm3_despues');
  end if;
  if current_setting(g || 'm4_despues') not like 'No se valida: apunte 2 (70000000): falta el local (o marcarlo como común).' then
    raise exception 'PRUEBA motivos · 4: «%».', current_setting(g || 'm4_despues');
  end if;
  if current_setting(g || 'm5_despues') not like 'El mes de 03/2026 está cerrado: la fecha abierta más cercana es el %' then
    raise exception 'PRUEBA motivos · 5: «%».', current_setting(g || 'm5_despues');
  end if;

  -- El disparador del envío por aclarar sigue puesto, y su función lee el motivo de conta_motivos_para_validar.
  if not exists (select 1 from pg_trigger where tgname = 'trg_journal_entry_envio_por_aclarar' and tgrelid = 'public.journal_entry'::regclass) then
    raise exception 'PRUEBA motivos: falta el disparador del envío por aclarar.';
  end if;
  if position('conta_motivos_para_validar' in pg_get_functiondef('public.tg_journal_entry_envio_por_aclarar()'::regprocedure)) = 0 then
    raise exception 'PRUEBA motivos: el disparador del envío por aclarar no lee su motivo de conta_motivos_para_validar.';
  end if;
  -- Una sola firma de cada una (create or replace no ha hecho sobrecarga).
  if (select count(*) from pg_proc where proname in ('journal_entry_validar', 'conta_motivos_para_validar', 'conta_esperan') and pronamespace = 'public'::regnamespace) <> 3 then
    raise exception 'PRUEBA motivos: hay más de una firma de journal_entry_validar, conta_motivos_para_validar o conta_esperan.';
  end if;

  raise notice 'PRUEBA motivos: la validación dice lo mismo que antes en los cinco casos; su texto sale de conta_motivos_para_validar y «Esperan» lo enseña igual.';
end $$;

\echo '>>> Prueba de los motivos para validar en verde. ROLLBACK: no queda nada.'
rollback;
