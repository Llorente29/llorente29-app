-- ============================================================================
-- PRUEBA (staging) · B01 · Respuesta 22 (0027): el nivel de cada propuesta.
-- Todo en una transacción con ROLLBACK. Datos INVENTADOS (IBAN del banco 9999,
-- T11), en la cuenta D, sembrados por el dueño; lo demás COMO USUARIO (el
-- administrador de D con su sesión, y alguien de otra cuenta).
--
--   0. Sin la 0027 (vuelta atrás delante) no hay nada; con ella, las columnas,
--      la tabla y las dos funciones, y quién puede llamar a qué. El interruptor
--      de las empresas que ya tienen ajustes sale apagado (NULL).
--   1. El administrador de D apunta un veredicto («la cambió») de un movimiento
--      suyo y lo ve; alguien de otra cuenta no puede apuntarlo ni lo ve.
--   2. bank_historial_validado se lee como el administrador de D.
--   3. La vuelta atrás lo quita todo; la 0027 otra vez lo pone.
-- La racha («3 seguidas sin corrección») se probó contra la población REAL de
-- Foodint en solo lectura (186 validaciones, 17 corregidas, 61 contrapartes:
-- contexto.json de la tanda) y en tests/unit/modules/conta/nivelB01r22.test.ts.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA B01·22: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;

create temp table _r (clave text primary key, v text) on commit drop;
grant all on _r to authenticated;
insert into _r values ('cuenta', 'c01d0000-0000-4000-8000-00000000000d'), ('empresa', 'c01d0000-0000-4000-8000-0000000000d2'),
  ('admin', 'c01d0000-0000-4000-8000-0000000000d1'), ('otra', 'c01b0000-0000-4000-8000-0000000000b1');

-- 0 · Sin la 0027, y con ella.
\i supabase/vuelta-atras/20261113T0027_b01r22_niveles.down.sql
do $$ begin
  if to_regclass('public.bank_nivel_veredicto') is not null or to_regprocedure('public.bank_historial_validado(uuid,date)') is not null
     or exists (select 1 from information_schema.columns where table_name = 'bank_settings' and column_name in ('seguro_solo', 'seguro_limite')) then
    raise exception 'PRUEBA B01·22 · 0: la vuelta atrás no lo quita todo.';
  end if;
end $$;
\i supabase/migrations/20261113T0027_b01r22_niveles.sql
do $$
declare f text;
begin
  foreach f in array array['public.bank_historial_validado(uuid,date)', 'public.bank_nivel_veredicto_apuntar(uuid,uuid,text,text,boolean,jsonb,jsonb,text)'] loop
    if has_function_privilege('anon', f, 'execute') then raise exception 'PRUEBA B01·22 · 0: anon puede llamar a %.', f; end if;
    if not has_function_privilege('authenticated', f, 'execute') then raise exception 'PRUEBA B01·22 · 0: authenticated no puede llamar a %.', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.bank_nivel_veredicto', 'insert') and exists (
       select 1 from pg_policies where tablename = 'bank_nivel_veredicto' and cmd in ('INSERT', 'ALL')) then
    raise exception 'PRUEBA B01·22 · 0: la tabla del veredicto se puede escribir sin pasar por su función.';
  end if;
  if exists (select 1 from public.bank_settings where seguro_solo is not null or seguro_limite is not null) then
    raise exception 'PRUEBA B01·22 · 0: el interruptor no sale apagado.';
  end if;
end $$;

-- La siembra (como el dueño): un banco y un movimiento de D.
do $$
declare a uuid := (select v::uuid from _r where clave = 'cuenta'); e uuid := (select v::uuid from _r where clave = 'empresa'); t uuid; s uuid; m uuid;
begin
  insert into public.treasury_account (account_id, company_id, kind, name, iban)
  values (a, e, 'bank', 'B01·22 · banco de prueba', 'ES0899990000000000002200') returning id into t;
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
     opening_balance, closing_balance, movements_count, new_count, repeated_count, possible_repeated_count, balanced, unchecked_reason, continuity, continuity_gap)
  values (a, e, t, 'fichero', 'norma43', 'b01r22.n43', date '2026-11-10', date '2026-11-10', 0, -80, 1, 1, 0, 0, true, null, 'primero', null)
  returning id into s;
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount, bank_concept, fingerprint, soft_fingerprint, status, reason)
  values (a, e, t, s, date '2026-11-10', date '2026-11-10', -80.00, 'ADEUDO RECIBO SUMINISTROS B01R22', 'b01r22-1', 'b01r22-s1', 'propuesto', 'Prueba B01·22')
  returning id into m;
  insert into _r values ('m', m::text);
end $$;

-- 1 · El administrador de D apunta y ve; otra cuenta, no.
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare id uuid;
begin
  id := public.bank_nivel_veredicto_apuntar((select v::uuid from _r where clave = 'm'), null, 'confirmado', 'Seguro · confirmado 3 veces', false,
    '{"tipo": "cuenta", "lineas": [{"cuenta": "62800000", "importe": 80}]}'::jsonb, '{"tipo": "cuenta", "lineas": [{"cuenta": "62900000", "importe": 80}]}'::jsonb, '2026-11-12.1');
  if id is null then raise exception 'PRUEBA B01·22 · 1: no ha apuntado el veredicto.'; end if;
  if (select count(*) from public.bank_nivel_veredicto where movement_id = (select v::uuid from _r where clave = 'm') and not tal_cual and nivel = 'confirmado') <> 1 then
    raise exception 'PRUEBA B01·22 · 1: el administrador no ve su veredicto.';
  end if;
  begin
    insert into public.bank_nivel_veredicto (account_id, company_id, nivel, etiqueta, tal_cual)
    values ((select v::uuid from _r where clave = 'cuenta'), (select v::uuid from _r where clave = 'empresa'), 'nose', 'No lo sé', true);
    raise exception 'PRUEBA B01·22 · 1: se ha podido escribir en la tabla sin su función.';
  exception when insufficient_privilege then null;
  end;
  -- 2 · La historia se lee.
  perform count(*) from public.bank_historial_validado((select v::uuid from _r where clave = 'empresa'), date '2025-01-01');
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _r where clave = 'otra'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.bank_nivel_veredicto_apuntar((select v::uuid from _r where clave = 'm'), null, 'nose', 'No lo sé', true, null, null, null);
    raise exception 'PRUEBA B01·22 · 1: alguien de otra cuenta ha podido apuntar un veredicto de D.';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.bank_nivel_veredicto) then raise exception 'PRUEBA B01·22 · 1: alguien de otra cuenta ve los veredictos de D.'; end if;
end $$;
reset role;

-- 3 · La vuelta atrás lo quita todo; la 0027 otra vez lo pone.
\i supabase/vuelta-atras/20261113T0027_b01r22_niveles.down.sql
do $$ begin
  if to_regclass('public.bank_nivel_veredicto') is not null or to_regprocedure('public.bank_nivel_veredicto_apuntar(uuid,uuid,text,text,boolean,jsonb,jsonb,text)') is not null then
    raise exception 'PRUEBA B01·22 · 3: la vuelta atrás no lo quita todo.';
  end if;
end $$;
\i supabase/migrations/20261113T0027_b01r22_niveles.sql
do $$ begin
  if to_regprocedure('public.bank_historial_validado(uuid,date)') is null then raise exception 'PRUEBA B01·22 · 3: la 0027 otra vez no deja las funciones.'; end if;
end $$;

select 'PRUEBA B01·22 · El nivel de cada propuesta: todo en verde' as resultado;
rollback;
