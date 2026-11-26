-- supabase/staging/sql/20261126_k14b_un_banco_y_el_inicio_prueba.sql
--
-- SOLO STAGING. Prueba del K14b (20261126T1240_k14b_un_banco_y_el_inicio). Todo en
-- una transacción con ROLLBACK: staging no cambia. Lo que cambia: public.bank_cuenta_alta (nunca un segundo banco con
-- el mismo IBAN), public.bank_settings y public.fiscal_year (un disparador nuevo en cada una). Lo que añade: _bank_antes_del_inicio_recalcular y
-- _bank_juntar.
--
-- En la gestoría de ejemplo del núcleo (semillas K02, K04 y K05), con su «Banco principal», como el usuario del núcleo.
-- Todo inventado (T11):
--   1. Subir dos veces el mismo extracto: ni un banco ni un movimiento de más. Dar de alta un banco con el IBAN del
--      «Banco principal» no se puede, y dice de quién es (también por bank_cuenta_nueva, que no deja su subcuenta).
--   2. Poner el día de inicio (bank_ajustes_guardar): lo de antes pasa a «antes del inicio», lo propuesto vuelve a
--      «pendiente» sin su propuesta, lo casado no se toca. Quitarlo: vuelve. Y por los ejercicios (imported_until).
--   3. Juntar dos bancos (_bank_juntar): los movimientos y el extracto del que se va pasan al que queda, sin borrar
--      ninguno; sus enlaces se quitan y el banco se borra.
--   4. La vuelta atrás: bank_cuenta_alta como antes, sin disparadores ni funciones nuevas.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA K14b: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._bank_juntar(uuid,uuid)') is null or to_regprocedure('public._bank_antes_del_inicio_recalcular(uuid)') is null then
    raise exception 'PRUEBA K14b · 0: falta la 1240 delante.';
  end if;
end $$;
set local statement_timeout = '120s';
create temp table _k14b (k text primary key, v text) on commit drop;
grant all on _k14b to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _k14b where _k14b.k = $1 $$;

select set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
set local role authenticated;

-- 1 · El mismo extracto dos veces; un IBAN, un banco --------------------------------------------------------------------
create function pg_temp.movs() returns jsonb language sql as $f$
  select jsonb_agg(jsonb_build_object('fecha', f, 'importe', i, 'concepto_banco', c, 'concepto_limpio', c, 'huella', 'k14b-' || h, 'huella_suave', 'k14bs-' || h) order by h)
    from (values ('1', '2026-09-10', 50.00, 'PRUEBA K14b UNO'), ('2', '2026-10-20', -12.00, 'PRUEBA K14b DOS'), ('3', '2026-11-05', 80.00, 'PRUEBA K14b TRES')) t(h, f, i, c)
$f$;
do $$
declare r jsonb; v_bancos int; v_movs int; ok boolean := false; v_iban text; v_subs int;
begin
  select count(*) into v_bancos from public.treasury_account where company_id = 'c0e20000-0000-4000-8000-0000000000e3';
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'csv:diezbank', 'k14b.xlsx', repeat('d', 64), date '2026-09-10', date '2026-11-05',
                            null, null, 'Prueba K14b', null, pg_temp.movs());
  if (r->>'nuevos')::int <> 3 then raise exception 'PRUEBA K14b · 1: la primera vez (%)', r; end if;
  select count(*) into v_movs from public.bank_movement where company_id = 'c0e20000-0000-4000-8000-0000000000e3';
  r := public.bank_importar('c0e20000-0000-4000-8000-0000000000b0', 'fichero', 'csv:diezbank', 'k14b.xlsx', repeat('d', 64), date '2026-09-10', date '2026-11-05',
                            null, null, 'Prueba K14b', null, pg_temp.movs());
  if coalesce((r->>'nuevos')::int, 0) <> 0
     or (select count(*) from public.bank_movement where company_id = 'c0e20000-0000-4000-8000-0000000000e3') <> v_movs
     or (select count(*) from public.treasury_account where company_id = 'c0e20000-0000-4000-8000-0000000000e3') <> v_bancos then
    raise exception 'PRUEBA K14b · 1: la segunda vez ha metido algo (%)', r;
  end if;
  select iban into v_iban from public.treasury_account where id = 'c0e20000-0000-4000-8000-0000000000b0';
  begin
    perform public.bank_cuenta_alta('c0e20000-0000-4000-8000-0000000000e3', 'bank', '57200000', v_iban, null, null, true);
  exception when unique_violation then ok := sqlerrm = 'Ese IBAN ya es del banco «Banco principal»: el extracto va a ese, no se crea otro.';
  end;
  if not ok then raise exception 'PRUEBA K14b · 1: bank_cuenta_alta deja dar de alta el mismo IBAN'; end if;
  select count(*) into v_subs from public.company_account where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and code like '572%';
  ok := false;
  begin
    perform public.bank_cuenta_nueva('c0e20000-0000-4000-8000-0000000000e3', 'bank', '57200000', lower(v_iban), null, true, 'Persona de Prueba K14b');
  exception when unique_violation then ok := true;
  end;
  if not ok or (select count(*) from public.company_account where company_id = 'c0e20000-0000-4000-8000-0000000000e3' and code like '572%') <> v_subs
     or (select count(*) from public.treasury_account where company_id = 'c0e20000-0000-4000-8000-0000000000e3') <> v_bancos then
    raise exception 'PRUEBA K14b · 1: bank_cuenta_nueva deja el banco o su subcuenta';
  end if;
  raise notice 'PRUEBA K14b · 1: el mismo extracto dos veces: 3 movimientos y % bancos, igual que antes. El mismo IBAN no se da de alta (ni por bank_cuenta_nueva).', v_bancos;
end $$;

-- 2 · El día de inicio, recalculado al cambiar -------------------------------------------------------------------------
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; v_uno uuid; v_dos uuid; v_tres uuid;
begin
  select id into v_uno from public.bank_movement where fingerprint = 'k14b-1';
  select id into v_dos from public.bank_movement where fingerprint = 'k14b-2';
  select id into v_tres from public.bank_movement where fingerprint = 'k14b-3';
  insert into _k14b values ('uno', v_uno), ('dos', v_dos), ('tres', v_tres);
  -- Como quedan tras una pasada del agente sin día de inicio: uno propuesto, otro por aclarar.
  reset role;
  update public.bank_movement set status = 'propuesto', confidence = 'probable', reason = 'Prueba K14b', proposal = '{"x": 1}' where id = v_uno;
  update public.bank_movement set status = 'por_aclarar', confidence = 'duda', reason = 'Prueba K14b', proposal = '{"x": 2}' where id = v_dos;
  set local role authenticated;
  if exists (select 1 from public.bank_movement where id in (v_uno, v_dos, v_tres) and before_cutover) then raise exception 'PRUEBA K14b · 2: ya estaban antes del inicio'; end if;
  perform public.bank_ajustes_guardar(emp, 3::smallint, false, date '2026-11-01');
  if not exists (select 1 from public.bank_movement where id = v_uno and before_cutover and status = 'pendiente' and proposal is null and confidence is null and reason is null)
     or not exists (select 1 from public.bank_movement where id = v_dos and before_cutover and status = 'pendiente' and proposal is null)
     or not exists (select 1 from public.bank_movement where id = v_tres and not before_cutover) then
    raise exception 'PRUEBA K14b · 2: poner el día de inicio no recalcula lo de antes';
  end if;
  perform public.bank_ajustes_guardar(emp, 3::smallint, false, null);
  if exists (select 1 from public.bank_movement where id in (v_uno, v_dos, v_tres) and before_cutover) then raise exception 'PRUEBA K14b · 2: quitarlo no lo devuelve'; end if;
  -- Por los ejercicios (de donde sale el día de inicio si no hay ajuste): lo traído hasta el 30/09.
  reset role;
  update public.fiscal_year set origin = 'mixed', origin_program = 'ERP10', imported_until = date '2026-09-30' where company_id = emp and starts_on = date '2026-01-01';
  set local role authenticated;
  if not exists (select 1 from public.bank_movement where id = v_uno and before_cutover) or exists (select 1 from public.bank_movement where id in (v_dos, v_tres) and before_cutover) then
    raise exception 'PRUEBA K14b · 2: el día de inicio por los ejercicios (01/10) no recalcula';
  end if;
  raise notice 'PRUEBA K14b · 2: al poner el 01/11, lo de antes queda «antes del inicio» y vuelve a «pendiente» sin propuesta; al quitarlo, vuelve; por los ejercicios (01/10), igual.';
end $$;

-- 3 · Juntar dos bancos ---------------------------------------------------------------------------------------------------
reset role;
do $$
declare emp constant uuid := 'c0e20000-0000-4000-8000-0000000000e3'; v_otro uuid; v_j jsonb; v_antes int;
begin
  insert into public.treasury_account (account_id, company_id, kind, name, iban, pgc_hint, is_default, is_active)
  values ('c0e20000-0000-4000-8000-0000000000e0', emp, 'bank', 'Banco repetido K14b', 'ES0099990000000000000002', '572', false, true) returning id into v_otro;
  perform set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
  perform public.bank_importar(v_otro, 'fichero', 'csv:diezbank', 'k14b-otro.xlsx', repeat('f', 64), date '2026-11-10', date '2026-11-10',
                               null, null, 'Prueba K14b', null, '[{"fecha":"2026-11-10","importe":33.00,"concepto_banco":"PRUEBA K14b OTRO","concepto_limpio":"Prueba K14b otro","huella":"k14b-otro","huella_suave":"k14bs-otro"}]'::jsonb);
  select count(*) into v_antes from public.bank_movement where company_id = emp;
  v_j := public._bank_juntar('c0e20000-0000-4000-8000-0000000000b0', v_otro);
  if exists (select 1 from public.treasury_account where id = v_otro)
     or not exists (select 1 from public.bank_movement where fingerprint = 'k14b-otro' and treasury_account_id = 'c0e20000-0000-4000-8000-0000000000b0')
     or exists (select 1 from public.bank_statement where treasury_account_id = v_otro)
     or (select count(*) from public.bank_movement where company_id = emp) <> v_antes then
    raise exception 'PRUEBA K14b · 3: juntar (%)', v_j;
  end if;
  raise notice 'PRUEBA K14b · 3: juntados: %; ningún movimiento de menos (%).', v_j, v_antes;
end $$;

-- 4 · La vuelta atrás ----------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261126T1240_k14b_un_banco_y_el_inicio.down.sql
do $$
declare ok boolean := true;
begin
  if to_regprocedure('public._bank_juntar(uuid,uuid)') is not null or to_regprocedure('public._bank_antes_del_inicio_recalcular(uuid)') is not null
     or exists (select 1 from pg_trigger where tgname in ('trg_bank_settings_inicio_cambia', 'trg_fiscal_year_inicio_cambia')) then
    raise exception 'PRUEBA K14b · 4: la vuelta atrás deja algo';
  end if;
  perform set_config('request.jwt.claims', '{"sub":"c0e20000-0000-4000-8000-0000000000e1","role":"authenticated"}', true);
  begin
    perform public.bank_cuenta_alta('c0e20000-0000-4000-8000-0000000000e3', 'bank', 'Repetido otra vez', (select iban from public.treasury_account where id = 'c0e20000-0000-4000-8000-0000000000b0'), null, null, true);
  exception when unique_violation then ok := false;
  end;
  if not ok then raise exception 'PRUEBA K14b · 4: bank_cuenta_alta no ha vuelto a la de antes'; end if;
  raise notice 'PRUEBA K14b · 4: la vuelta atrás deja bank_cuenta_alta como antes y quita lo nuevo.';
end $$;

rollback;
