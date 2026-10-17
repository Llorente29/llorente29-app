-- supabase/staging/sql/20261121_s01_analitica_prueba.sql
--
-- SOLO STAGING. La analítica del S01 (0130 y 0140), por sus caminos:
--   1. La 0130 (los ejes de cada empresa), si staging aún no la tiene.
--   2. Lo que siembra, por cuenta (regla 9): A (2 locales, 7 marcas) con «Local»
--      y «Marca» encendidos en sus empresas; D (sin locales ni marcas), sin filas.
--   3. COMO USUARIO de A (administrador): apaga y renombra un eje de su empresa;
--      no puede escribir uno en una empresa de B ni a nombre de otra cuenta; no
--      ve los de B.
--   4. La 0140 (cambia: conta_motivos_para_validar), la que irá a producción.
--      Staging no tiene la tanda «Esperan» (M01) ni, quizá, la de C: se aplican
--      aquí antes, dentro de la transacción, como en sus propias pruebas.
--      Un asiento de A con un apunte sin local y sin marcar como común:
--        · con «Local» encendido, conta_motivos_para_validar lo para con
--          «falta el local (o marcarlo como común)», como antes;
--        · con «Local» apagado, ya no lo para por eso;
--        · y un asiento que no cuadra sigue parando igual (lo demás no cambia).
--   5. Las vueltas atrás, de verdad y en orden inverso: con la de la 0140 el
--      local se vuelve a pedir aunque el eje esté apagado; con la de la 0130
--      no queda ni tabla ni función.
--
-- Cambia: conta_motivos_para_validar (0140, misma firma) y añade
-- conta_eje_analitico (0130). Todo acaba en ROLLBACK: staging no cambia.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 analítica: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- 1 · La 0130, si falta.
select to_regclass('public.conta_eje_analitico') is null as falta_0130 \gset
\if :falta_0130
\echo '>>> Staging aún no tiene la 0130 del S01: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261121T0130_s01_ejes_analiticos.sql
\endif

-- 2 · Lo que siembra, por cuenta.
do $$
declare n_a int; n_a_emp int; n_d int;
begin
  select count(*) into n_a_emp from public.company where account_id = 'c01a0000-0000-4000-8000-00000000000a';
  select count(*) into n_a from public.conta_eje_analitico
   where account_id = 'c01a0000-0000-4000-8000-00000000000a' and activo and eje in ('local', 'marca');
  select count(*) into n_d from public.conta_eje_analitico where account_id = 'c01d0000-0000-4000-8000-00000000000d';
  if n_a <> 2 * n_a_emp then
    raise exception 'PRUEBA S01 analítica 2: A tiene % empresas y debía tener «Local» y «Marca» encendidos en todas; hay % ejes encendidos.', n_a_emp, n_a;
  end if;
  if n_d <> 0 then raise exception 'PRUEBA S01 analítica 2: D no tiene locales ni marcas y tiene % ejes.', n_d; end if;
  raise notice 'S01 analítica 2: A con «Local» y «Marca» en sus % empresas · D sin ejes.', n_a_emp;
end $$;

-- 3 · Como usuario de A. La empresa de B se coge ANTES, como postgres: como A,
-- la RLS de company no la deja ver, y un insert … select de B metería 0 filas
-- sin error (el 17/10 eso hizo que la 3c saltara aunque la política aguantaba,
-- y que la 3d se saltara sin probar nada).
do $$
declare emp_b uuid;
begin
  select id into emp_b from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b' order by id limit 1;
  if emp_b is null then raise exception 'PRUEBA S01 analítica 3: la cuenta B no tiene ninguna empresa.'; end if;
  perform set_config('prueba_analitica.emp_b', emp_b::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
do $$
declare n int;
  a constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  emp_b constant uuid := current_setting('prueba_analitica.emp_b')::uuid;
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  update public.conta_eje_analitico set nombre = 'Proyecto', nombre_plural = 'Proyectos' where company_id = emp and eje = 'marca';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'PRUEBA S01 analítica 3a: A no ha podido renombrar su eje «marca» (% filas).', n; end if;
  if (select updated_by from public.conta_eje_analitico where company_id = emp and eje = 'marca') <> 'c01a0000-0000-4000-8000-0000000000a1' then
    raise exception 'PRUEBA S01 analítica 3a: el cambio no dice quién lo hizo.';
  end if;
  raise notice 'S01 analítica 3a: A renombra su eje y queda quién lo hizo.';
  if exists (select 1 from public.conta_eje_analitico where account_id = 'c01b0000-0000-4000-8000-00000000000b') then
    raise exception 'PRUEBA S01 analítica 3b: A ve los ejes de B.';
  end if;
  raise notice 'S01 analítica 3b: A no ve los ejes de B.';
  begin
    insert into public.conta_eje_analitico (account_id, company_id, eje, nombre) values (b, emp_b, 'local', 'Intruso');
    raise exception 'PRUEBA S01 analítica 3c: A ha podido escribir un eje en la cuenta B.';
  exception when insufficient_privilege then raise notice 'S01 analítica 3c: A no escribe en la cuenta B (42501).';
  end;
  begin
    -- La empresa de B con la cuenta de A: la empresa no es de esa cuenta.
    insert into public.conta_eje_analitico (account_id, company_id, eje, nombre) values (a, emp_b, 'local', 'Mezclado');
    raise exception 'PRUEBA S01 analítica 3d: entró un eje de una empresa de B con la cuenta de A.';
  exception when insufficient_privilege then raise notice 'S01 analítica 3d: una empresa de otra cuenta no entra (42501).';
  end;
end $$;
reset role;

-- 4 · La 0140. Antes, lo que staging no tiene (como en la prueba de la M01).
select not exists (select 1 from pg_proc where proname = 'tg_journal_entry_envio_por_aclarar' and pronamespace = 'public'::regnamespace) as falta_c06b \gset
\if :falta_c06b
\echo '>>> Staging aún no tiene la tanda de C: se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261116T0100_c06b_promociones_envios.sql
\endif
select to_regprocedure('public.conta_motivos_para_validar(uuid)') is null as falta_m01 \gset
\if :falta_m01
\echo '>>> Staging aún no tiene «Esperan» (M01): se aplica aquí, dentro de la transacción.'
\i supabase/migrations/20261117T0100_m01_motivos_para_validar.sql
\endif
\i supabase/migrations/20261121T0140_s01_regla5_eje_local.sql

-- Los asientos de la prueba, en borrador, en la empresa A (como postgres: es la preparación).
do $$
declare
  a   constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  loc constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  v_y uuid; c572 uuid; c700 uuid; e uuid; k text; haber numeric;
begin
  select id into v_y from public.fiscal_year where company_id = emp and code = '2026' and status = 'open';
  select id into c572 from public.company_account where company_id = emp and code = '57200001';
  select id into c700 from public.company_account where company_id = emp and code = '70000000';
  if v_y is null or c572 is null or c700 is null then
    raise exception 'PRUEBA S01 analítica 4: faltan el ejercicio 2026 abierto o las cuentas 57200001 y 70000000 de la empresa A.';
  end if;
  foreach k in array array['sin_local', 'no_cuadra'] loop
    haber := case k when 'no_cuadra' then 90.00 else 100.00 end;
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type)
    values (a, emp, v_y, 1, '2026-10-13', 'Prueba de la analítica · ' || k, 'manual') returning id into e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, is_common)
    values (a, emp, e, 1, c572, 100.00, 0, loc, false),
           (a, emp, e, 2, c700, 0, haber, case when k = 'no_cuadra' then loc end, false);
    perform set_config('prueba_analitica.' || k, e::text, true);
  end loop;
end $$;

-- Lo que dice la validación, como usuario de A: con «Local» encendido y apagado.
set local role authenticated;
do $$
declare v_on text; v_off text; v_cuadra_on text; v_cuadra_off text;
  emp constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  sin_local constant uuid := current_setting('prueba_analitica.sin_local')::uuid;
  no_cuadra constant uuid := current_setting('prueba_analitica.no_cuadra')::uuid;
begin
  select string_agg(motivo, ' | ' order by orden) into v_on from public.conta_motivos_para_validar(sin_local);
  select string_agg(motivo, ' | ' order by orden) into v_cuadra_on from public.conta_motivos_para_validar(no_cuadra);
  if coalesce(v_on, '') not like '%falta el local (o marcarlo como común)%' then
    raise exception 'PRUEBA S01 analítica 4a: con «Local» encendido, un apunte sin local tenía que parar; dice: %', coalesce(v_on, 'nada');
  end if;
  raise notice 'S01 analítica 4a: «Local» encendido: %', v_on;

  update public.conta_eje_analitico set activo = false where company_id = emp and eje = 'local';
  select string_agg(motivo, ' | ' order by orden) into v_off from public.conta_motivos_para_validar(sin_local);
  select string_agg(motivo, ' | ' order by orden) into v_cuadra_off from public.conta_motivos_para_validar(no_cuadra);
  if coalesce(v_off, '') like '%falta el local%' then
    raise exception 'PRUEBA S01 analítica 4b: con «Local» apagado se sigue pidiendo el local: %', v_off;
  end if;
  raise notice 'S01 analítica 4b: «Local» apagado: %', coalesce(v_off, 'nada que lo pare');
  if v_cuadra_on is distinct from v_cuadra_off or coalesce(v_cuadra_on, '') not like 'No cuadra:%' then
    raise exception 'PRUEBA S01 analítica 4c: el asiento que no cuadra tenía que parar igual con el eje encendido y apagado: «%» / «%».', v_cuadra_on, v_cuadra_off;
  end if;
  raise notice 'S01 analítica 4c: lo demás no cambia: %', v_cuadra_off;
end $$;
reset role;

-- 5 · Las vueltas atrás, en orden inverso.
\i supabase/vuelta-atras/20261121T0140_s01_regla5_eje_local.down.sql
do $$
declare v text;
begin
  -- El eje «local» sigue apagado (paso 4): con la de antes, el local se pide igual.
  select string_agg(motivo, ' | ' order by orden) into v from public.conta_motivos_para_validar(current_setting('prueba_analitica.sin_local')::uuid);
  if coalesce(v, '') not like '%falta el local (o marcarlo como común)%' then
    raise exception 'PRUEBA S01 analítica 5a: tras la vuelta atrás de la 0140 el local tenía que pedirse siempre; dice: %', coalesce(v, 'nada');
  end if;
  raise notice 'S01 analítica 5a: vuelta atrás de la 0140, el local se pide siempre.';
end $$;
\i supabase/vuelta-atras/20261121T0130_s01_ejes_analiticos.down.sql
do $$ begin
  if to_regclass('public.conta_eje_analitico') is not null or to_regprocedure('public.conta_eje_analitico_al_dia()') is not null then
    raise exception 'PRUEBA S01 analítica 5b: la vuelta atrás de la 0130 no lo ha quitado todo.';
  end if;
  raise notice 'S01 analítica 5b: vuelta atrás de la 0130, sin tabla y sin función.';
end $$;

rollback;
