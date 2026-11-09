-- supabase/staging/sql/20261109_gd_volver_a_empezar_prueba.sql
--
-- SOLO STAGING. La 1731 del GD («Volver a empezar», la parte de Sumied), por
-- sus caminos, sobre la «Gestoría Demo» de staging (la 0110, sin
-- administrador), con un uso inventado:
--   1. Sin administrador, no vacía nada y lo dice (42501).
--   2. Con administrador y su contabilidad: un cliente, una liquidación de
--      GoCardless y su ingreso en el banco, CASADO (con su asiento). Volver a
--      empezar lo vacía todo: cliente, liquidación, extracto, movimiento,
--      casado y asiento.
--   3. Se queda la configuración: las empresas, el plan con sus enlaces, el
--      ejercicio, las series, la cuenta del banco (en la 57200000 y terminada
--      en 56), los ajustes y el administrador.
--   4. Otra cuenta no cambia (la misma huella antes y después).
--   5. Repetir no falla y no deja nada; en una cuenta que no es demo, no (42501).
--   6. La vuelta atrás quita las funciones.
-- Todo acaba en ROLLBACK. Datos inventados (T11).
-- sin usuario: la llama la plataforma; dentro actúa como el administrador de
-- la cuenta, y eso es lo que se prueba.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GD: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
set local lock_timeout = '120s';

\i supabase/migrations/20261109T0110_gd_cuenta_demo.sql
\i supabase/migrations/20261109T1300_gd_contabilidad_demo.sql
\i supabase/migrations/20261109T1530_gd_banco_demo.sql
\i supabase/migrations/20261109T1707_gd_ingresos_gocardless.sql
\i supabase/migrations/20261109T1731_gd_volver_a_empezar.sql

-- 1 · Sin administrador.
do $$ begin
  begin
    perform public.demo_gestoria_volver_a_empezar('de000000-0000-4000-8000-0000000000a0');
    raise exception 'GD · 1: sin administrador tenía que negarse.';
  exception when insufficient_privilege then raise notice 'GD · 1: sin administrador, no vacía nada y lo dice. OK';
  end;
end $$;

-- Un administrador (un usuario de prueba de staging), su contabilidad y un uso inventado.
insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
select id, 'de000000-0000-4000-8000-0000000000a0', 'admin', true, 'Administración GD (prueba)', now(), now() from auth.users where email = 'p01.laura@p01-prueba.test';
do $$
declare adm uuid; v jsonb; mov uuid;
begin
  select user_id into adm from public.user_profiles where account_id = 'de000000-0000-4000-8000-0000000000a0' and role = 'admin' and active limit 1;
  if adm is null then raise exception 'PRUEBA GD: no está el usuario de prueba p01.laura en staging.'; end if;
  perform public.demo_gestoria_contabilidad_sembrar('de000000-0000-4000-8000-0000000000a0');
  insert into public.party (account_id, name, tax_id, source) values ('de000000-0000-4000-8000-0000000000a0', 'Cliente de Prueba GD, S.L.', 'B00000000', 'manual');
  insert into public.conta_gc_payout (company_id, gc_id, account_id, estado, llegada, importe, comision, moneda, referencia) values
    ('de000000-0000-4000-8000-0000000000a9', 'PO-PRUEBA-VE', 'de000000-0000-4000-8000-0000000000a0', 'paid', (now() at time zone 'Europe/Madrid')::date - 1, 99.99, 0.80, 'EUR', 'PRUEBA-GD-VE');
  perform public.demo_gestoria_ingresos_gocardless('de000000-0000-4000-8000-0000000000a0');
  select id into mov from public.bank_movement where company_id = 'de000000-0000-4000-8000-0000000000a9' and amount = 99.99;
  perform set_config('request.jwt.claims', json_build_object('sub', adm, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', adm::text || ':de000000-0000-4000-8000-0000000000a0', true);
  v := public.conta_abono_gocardless_casar(mov, 'PO-PRUEBA-VE', 'seguro', 'Prueba GD.', 'folvy');
  perform set_config('request.jwt.claims', '', true);
  perform set_config('folvy.cuenta_activa', '', true);
  if v->>'asiento' is null then raise exception 'PRUEBA GD: el uso inventado no tiene asiento: %', v; end if;
end $$;

create temp table _c (que text, n text) on commit drop;
create temp view _config as
select concat_ws(' · ',
  (select count(*) from public.company where account_id = 'de000000-0000-4000-8000-0000000000a0'),
  (select count(*) from public.company_account where account_id = 'de000000-0000-4000-8000-0000000000a0'),
  (select count(*) from public.company_account_link where account_id = 'de000000-0000-4000-8000-0000000000a0'),
  (select count(*) from public.fiscal_year where account_id = 'de000000-0000-4000-8000-0000000000a0'),
  (select count(*) from public.invoice_series where account_id = 'de000000-0000-4000-8000-0000000000a0'),
  (select count(*) from public.conta_gestoria_ajustes where account_id = 'de000000-0000-4000-8000-0000000000a0'),
  (select count(*) from public.user_profiles where account_id = 'de000000-0000-4000-8000-0000000000a0'),
  (select string_agg(right(iban, 2), ',' order by iban) from public.treasury_account where account_id = 'de000000-0000-4000-8000-0000000000a0')) n;
create temp view _otra as
select md5(concat_ws('|',
  (select count(*) from public.party where account_id = 'c01a0000-0000-4000-8000-00000000000a'),
  (select count(*) from public.company_account where account_id = 'c01a0000-0000-4000-8000-00000000000a'),
  (select count(*) from public.bank_movement where account_id = 'c01a0000-0000-4000-8000-00000000000a'),
  (select count(*) from public.journal_entry where account_id = 'c01a0000-0000-4000-8000-00000000000a'))) n;
insert into _c select 'config', n from _config;
insert into _c select 'otra', n from _otra;

-- 2 · Volver a empezar lo vacía todo.
do $$
declare v jsonb; n int;
begin
  v := public.demo_gestoria_volver_a_empezar('de000000-0000-4000-8000-0000000000a0');
  raise notice 'GD · 2: %', v->>'frase';
  select (select count(*) from public.party where account_id = 'de000000-0000-4000-8000-0000000000a0')
       + (select count(*) from public.conta_gc_payout where account_id = 'de000000-0000-4000-8000-0000000000a0')
       + (select count(*) from public.bank_statement where account_id = 'de000000-0000-4000-8000-0000000000a0')
       + (select count(*) from public.bank_movement where account_id = 'de000000-0000-4000-8000-0000000000a0')
       + (select count(*) from public.bank_match where account_id = 'de000000-0000-4000-8000-0000000000a0')
       + (select count(*) from public.journal_entry where account_id = 'de000000-0000-4000-8000-0000000000a0') into n;
  if n <> 0 then raise exception 'GD · 2: quedan % filas del uso (cliente, liquidación, banco, casado o asiento).', n; end if;
  raise notice 'GD · 2: vacía el cliente, la liquidación, el extracto, el movimiento, el casado y el asiento. OK';
end $$;

-- 3 y 4 · La configuración se queda; la otra cuenta no cambia.
do $$ begin
  if (select n from _config) <> (select n from _c where que = 'config') then
    raise exception 'GD · 3: la configuración ha cambiado: % → %', (select n from _c where que = 'config'), (select n from _config);
  end if;
  if (select public._bank_cuenta_572(id) from public.treasury_account where company_id = 'de000000-0000-4000-8000-0000000000a9' and kind = 'bank' and is_default) <> '57200000' then
    raise exception 'GD · 3: el banco de la sociedad ya no es la 57200000.';
  end if;
  raise notice 'GD · 3: se queda la configuración (%). OK', (select n from _config);
  if (select n from _otra) <> (select n from _c where que = 'otra') then raise exception 'GD · 4: ha cambiado otra cuenta.'; end if;
  raise notice 'GD · 4: la otra cuenta no cambia. OK';
end $$;

-- 5 · Repetir; y en una cuenta que no es demo, no.
do $$ declare v jsonb; begin
  v := public.demo_gestoria_volver_a_empezar('de000000-0000-4000-8000-0000000000a0');
  if (select n from _config) <> (select n from _c where que = 'config') then raise exception 'GD · 5: repetir ha cambiado la configuración.'; end if;
  begin
    perform public.demo_gestoria_volver_a_empezar('c01a0000-0000-4000-8000-00000000000a');
    raise exception 'GD · 5: en una cuenta que no es demo tenía que negarse.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'GD · 5: repetir no falla (%), y en una cuenta que no es demo, no. OK', v->>'frase';
end $$;

-- 6 · La vuelta atrás.
\i supabase/vuelta-atras/20261109T1731_gd_volver_a_empezar.down.sql
do $$ begin
  if to_regprocedure('public.demo_gestoria_volver_a_empezar(uuid)') is not null or to_regprocedure('public._gd_se_queda()') is not null then
    raise exception 'GD · 6: las funciones siguen.';
  end if;
  raise notice 'GD · 6: la vuelta atrás quita las funciones. OK';
end $$;

rollback;
