-- supabase/staging/sql/20261113_s01p_liquidacion_repetida_local_prueba.sql
--
-- SOLO STAGING. Prueba de la 1914 (S01p·21b: «Dejar solo esta» con apuntes sin local), con \i
-- dentro de la transacción y ROLLBACK: staging no cambia. En la cuenta A, con el eje «local»
-- encendido (como Foodint), un 303 del 2T presentado y dos liquidaciones traídas de Diez a 30/06
-- con los mismos apuntes, COMO LAS DE FOODINT: sin local y sin marcar como comunes. Y uno, el de
-- la 4750, con local, para ver que lo conserva.
--
--   1. Sin la 1914 (quitada con su vuelta atrás si ya estaba): «Dejar solo esta» falla con «falta el local (o marcarlo como
--      común)» y no deja nada, como le pasó a Julio con la 4/1016. Es lo que la prueba de la 1822
--      no veía, porque sembraba los apuntes ya marcados como comunes.
--   2. Con la 1914: «Dejar solo esta» hace el contraasiento validado del 01/10; los apuntes sin
--      local van como comunes, el que tiene local lo conserva, y la traída no cambia.
--   3. La vuelta atrás: conta_liquidacion_dejar_esta como estaba.
--
-- Nombra lo que toca, para el analizador: conta_liquidacion_dejar_esta, conta_motivos_para_validar,
-- conta_eje_analitico, journal_entry, journal_line, tax_return.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·21b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
set local lock_timeout = '30s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); para validar, los «claims» del administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

-- La 1822 (del #665) está en staging desde que se fusionó; en una base sin ella, se pasa aquí.
select to_regprocedure('public.conta_liquidacion_dejar_esta(uuid,uuid,text)') is not null as con_1822 \gset
\if :con_1822
\else
\i supabase/migrations/20261113T1822_s01p_liquidacion_repetida.sql
\endif
select strpos(pg_get_functiondef('public.conta_liquidacion_dejar_esta(uuid,uuid,text)'::regprocedure), 'S01p·21b') > 0 as ya_esta \gset

create temp table _p (clave text primary key, v uuid) on commit drop;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record; v_loc uuid;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p·21b: no está la empresa de la cuenta A.'; end if;
  select id into v_loc from public.locations where account_id = v_acc order by created_at, id limit 1;
  if v_loc is null then raise exception 'PRUEBA S01p·21b: la cuenta A no tiene locales.'; end if;
  -- El eje «local», apagado mientras se siembra lo traído (Diez lo trae validado); se enciende después.
  update public.conta_eje_analitico set activo = false where company_id = c and eje = 'local';
  select id into y from public.fiscal_year where company_id = c and date '2026-06-30' between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  end if;
  update public.fiscal_year set origin = 'mixed', origin_program = 'diez', history_imported_at = coalesce(history_imported_at, now()), imported_until = '2026-09-30', status = 'open' where id = y;
  delete from public.fiscal_period_lock where company_id = c and month = '2026-10-01';
  for x in select * from (values ('47200097', '472'), ('47700097', '477'), ('47500097', '4750'), ('47000097', '4700')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA S01p·21b ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  delete from public.tax_return where company_id = c and fiscal_year = 2026 and period = '2T' and form_code = '303';
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
  values (v_acc, c, '303', 2026, 'quarterly', '2T', '2026-07-20', 'filed', 'to_pay', 10, '2026-07-15 10:00+02', 'outside', 'PRUEBAS01P21B');
  insert into _p values ('empresa', c), ('ejercicio', y), ('local', v_loc),
    ('d303', (select id from public.tax_return where company_id = c and fiscal_year = 2026 and period = '2T' and form_code = '303'));
end $$;

-- Una liquidación traída de Diez como las de Foodint: sus apuntes SIN local y SIN marcar como
-- comunes; salvo el de la 4750, con local.
create function pg_temp.liquidacion(p_serie int) returns uuid language plpgsql as $$
declare e uuid; c uuid := (select v from _p where clave = 'empresa');
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, external_program)
  values ('c01a0000-0000-4000-8000-00000000000a', c, (select v from _p where clave = 'ejercicio'), p_serie, '2026-06-30',
          'PRUEBA S01p·21b Liquidación I.V.A. Trimestre 2', 'migrated', 'borrador', 'diez') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, location_id, is_common)
  select 'c01a0000-0000-4000-8000-00000000000a', c, e, v.pos, a.id, v.debe, v.haber,
         case when v.code = '47500097' then (select v from _p where clave = 'local') end, false
    from (values (1, '47700097', 21.00, 0.00), (2, '47200097', 0.00, 6.00), (3, '47200097', 0.00, 5.00), (4, '47500097', 0.00, 10.00)) v(pos, code, debe, haber)
    join public.company_account a on a.company_id = c and a.code = v.code;
  perform public.journal_entry_validar(e, 'PRUEBA Diez');
  return e;
end $$;

do $$
declare e1 uuid; e2 uuid;
begin
  e1 := pg_temp.liquidacion(4); e2 := pg_temp.liquidacion(9);
  if (select count(*) from public.journal_entry where id in (e1, e2) and status = 'validado') <> 2 then raise exception 'PRUEBA S01p·21b · siembra: las liquidaciones no quedan validadas.'; end if;
  if exists (select 1 from public.journal_line where entry_id in (e1, e2) and is_common) then raise exception 'PRUEBA S01p·21b · siembra: hay apuntes comunes.'; end if;
  insert into _p values ('buena', e1), ('repetida', e2);
  -- Ahora, el eje «local» encendido, como en Foodint: con él, la regla del local pide local o común.
  update public.conta_eje_analitico set activo = true where company_id = (select v from _p where clave = 'empresa') and eje = 'local';
  if not found then
    insert into public.conta_eje_analitico (account_id, company_id, eje, activo, nombre, nombre_plural)
    values ('c01a0000-0000-4000-8000-00000000000a', (select v from _p where clave = 'empresa'), 'local', true, 'Local', 'Locales');
  end if;
end $$;

-- 1. Sin la 1914: falla como en Foodint, y no deja nada. Corre SIEMPRE: si el workflow ya pasó la
-- 1914 (staging la aplica antes de esta prueba), se quita con su vuelta atrás y se vuelve a pasar.
\if :ya_esta
\i supabase/vuelta-atras/20261113T1914_s01p_liquidacion_repetida_local.down.sql
\endif
do $$
declare v_m text;
begin
  begin
    perform public.conta_liquidacion_dejar_esta((select v from _p where clave = 'd303'), (select v from _p where clave = 'buena'), 'PRUEBA D');
    raise exception 'PRUEBA S01p·21b · 1: sin la 1914 no falla: esta prueba no ve el fallo de Foodint.';
  exception when others then
    v_m := sqlerrm;
    if v_m !~ 'falta el local' then raise; end if;
  end;
  if exists (select 1 from public.journal_entry where reverses_entry_id = (select v from _p where clave = 'repetida'))
     or (select liquidation_entry_id from public.tax_return where id = (select v from _p where clave = 'd303')) is not null then
    raise exception 'PRUEBA S01p·21b · 1: el fallo dejó algo hecho.';
  end if;
  raise notice '1 · sin la 1914, falla como en Foodint y no deja nada: «%»', v_m;
end $$;
\i supabase/migrations/20261113T1914_s01p_liquidacion_repetida_local.sql

-- 2. Con la 1914.
do $$
declare r jsonb; ce public.journal_entry; n_comun int; n_local int; n_traida int;
begin
  r := public.conta_liquidacion_dejar_esta((select v from _p where clave = 'd303'), (select v from _p where clave = 'buena'), 'PRUEBA D');
  select * into ce from public.journal_entry where reverses_entry_id = (select v from _p where clave = 'repetida');
  if ce.id is null or ce.status <> 'validado' or ce.entry_date <> '2026-10-01' then raise exception 'PRUEBA S01p·21b · 2: el contraasiento queda %.', row_to_json(ce); end if;
  select count(*) filter (where is_common and location_id is null), count(*) filter (where not is_common and location_id = (select v from _p where clave = 'local'))
    into n_comun, n_local from public.journal_line where entry_id = ce.id;
  if n_comun <> 3 or n_local <> 1 then raise exception 'PRUEBA S01p·21b · 2: % comunes y % con su local (tenían que ser 3 y 1).', n_comun, n_local; end if;
  select count(*) into n_traida from public.journal_line where entry_id = (select v from _p where clave = 'repetida') and is_common;
  if n_traida <> 0 then raise exception 'PRUEBA S01p·21b · 2: la traída cambió (% apuntes comunes).', n_traida; end if;
  raise notice '2 · %  (3 apuntes como comunes, 1 con su local; la traída igual)', r->>'mensaje';
end $$;

-- 3. La vuelta atrás.
\i supabase/vuelta-atras/20261113T1914_s01p_liquidacion_repetida_local.down.sql
do $$ begin
  if strpos(pg_get_functiondef('public.conta_liquidacion_dejar_esta(uuid,uuid,text)'::regprocedure), 'S01p·21b') > 0 then
    raise exception 'PRUEBA S01p·21b · 3: conta_liquidacion_dejar_esta sigue cambiada.';
  end if;
  raise notice '3 · la vuelta atrás: conta_liquidacion_dejar_esta como estaba';
end $$;

rollback;
