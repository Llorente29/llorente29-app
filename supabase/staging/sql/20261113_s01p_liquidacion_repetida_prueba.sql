-- supabase/staging/sql/20261113_s01p_liquidacion_repetida_prueba.sql
--
-- SOLO STAGING. Prueba de la 1822 (S01p·21: una liquidación de IVA apuntada dos veces en un
-- trimestre presentado), con \i dentro de la transacción y ROLLBACK: staging no cambia. En la
-- cuenta A, con el ejercicio 2026 traído hasta el 30/09 (como Foodint), un 303 del 2T presentado
-- y dos liquidaciones traídas de Diez a 30/06 con los mismos apuntes (como 4/1194 y 9/3).
--
--   1. conta_liquidaciones_repetidas las saca a las dos, sin enlazar.
--   2. Antes: el contraasiento de una de ellas, sin registrar como repetida, lo para la regla 5
--      (472 y 477 sin tipo ni libro): la 1822 no abre la regla para nada más.
--   3. «Dejar solo esta» con la primera: el 303 queda enlazado con ella (y contabilizado); la otra
--      queda registrada y sin efecto con su contraasiento VALIDADO, del 01/10 (el primer día
--      abierto), sin tipo ni libro; la traída sigue validada, como la trajo Diez. Y lo dice.
--   4. Otra vez: no hace un segundo contraasiento.
--   5. conta_impuesto_303_contabilizar dice «ya estaba»: no hace una tercera.
--   6. El contraasiento no cuenta como IVA del 4T: el cálculo, la contabilización y el bloque de
--      IVA del cierre lo dejan fuera.
--   7. Sin cuenta, no.
--   8. La vuelta atrás: las cuatro funciones como estaban, fuera las dos nuevas.
--
-- Nombra lo que toca, para el analizador: conta_motivos_para_validar, conta_impuesto_303_calcular,
-- conta_impuesto_303_contabilizar, conta_cierre_bloque_iva, conta_liquidacion_repetida,
-- conta_liquidaciones_repetidas, conta_liquidacion_dejar_esta, journal_entry, tax_return.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·21: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
set local lock_timeout = '30s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); para validar, los «claims» del administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

select to_regprocedure('public.conta_liquidacion_dejar_esta(uuid,uuid,text)') is not null as ya_esta \gset
\if :ya_esta
\else
\i supabase/migrations/20261113T1822_s01p_liquidacion_repetida.sql
\endif

create temp table _p (clave text primary key, v uuid) on commit drop;
grant all on _p to authenticated, anon;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p·21: no está la empresa de la cuenta A.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-06-30' between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  end if;
  update public.fiscal_year set origin = 'mixed', origin_program = 'diez', history_imported_at = coalesce(history_imported_at, now()), imported_until = '2026-09-30', status = 'open' where id = y;
  delete from public.fiscal_period_lock where company_id = c and month = '2026-10-01';
  for x in select * from (values ('47200098', '472'), ('47700098', '477'), ('47500098', '4750'), ('47000098', '4700')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA S01p·21 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  delete from public.tax_return where company_id = c and fiscal_year = 2026 and period = '2T' and form_code = '303';
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
  values (v_acc, c, '303', 2026, 'quarterly', '2T', '2026-07-20', 'filed', 'to_pay', 10, '2026-07-15 10:00+02', 'outside', 'PRUEBAS01P21A')
  returning id into x;
  insert into _p values ('empresa', c), ('ejercicio', y), ('d303', (select id from public.tax_return where company_id = c and fiscal_year = 2026 and period = '2T' and form_code = '303'));
end $$;

create function pg_temp.liquidacion(p_serie int) returns uuid language plpgsql as $$
declare e uuid; c uuid := (select v from _p where clave = 'empresa');
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, external_program)
  values ('c01a0000-0000-4000-8000-00000000000a', c, (select v from _p where clave = 'ejercicio'), p_serie, '2026-06-30',
          'PRUEBA S01p·21 Liquidación I.V.A. Trimestre 2', 'migrated', 'borrador', 'diez') returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  select 'c01a0000-0000-4000-8000-00000000000a', c, e, v.pos, a.id, v.debe, v.haber, true
    from (values (1, '47700098', 21.00, 0.00), (2, '47200098', 0.00, 11.00), (3, '47500098', 0.00, 10.00)) v(pos, code, debe, haber)
    join public.company_account a on a.company_id = c and a.code = v.code;
  perform public.journal_entry_validar(e, 'PRUEBA Diez');
  return e;
end $$;

do $$
declare e1 uuid; e2 uuid;
begin
  e1 := pg_temp.liquidacion(4); e2 := pg_temp.liquidacion(9);
  if (select count(*) from public.journal_entry where id in (e1, e2) and status = 'validado') <> 2 then raise exception 'PRUEBA S01p·21 · siembra: las liquidaciones no quedan validadas.'; end if;
  insert into _p values ('buena', e1), ('repetida', e2);
end $$;

-- 1. Las dos, sin enlazar.
do $$
declare n int; m int;
begin
  select count(*), count(*) filter (where enlazada or repetida) into n, m from public.conta_liquidaciones_repetidas((select v from _p where clave = 'd303'));
  if n <> 2 or m <> 0 then raise exception 'PRUEBA S01p·21 · 1: salen % (con algo hecho %).', n, m; end if;
  raise notice '1 · las dos liquidaciones repetidas del 2T, sin enlazar';
end $$;

-- 2. Sin registrar como repetida, su contraasiento lo para la regla 5.
do $$
declare e uuid; c uuid := (select v from _p where clave = 'empresa'); v_m text;
begin
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status, reverses_entry_id)
  values ('c01a0000-0000-4000-8000-00000000000a', c, (select v from _p where clave = 'ejercicio'), 9, '2026-10-01', 'PRUEBA S01p·21 contraasiento suelto', 'reversal',
          (select v from _p where clave = 'repetida'), 'borrador', (select v from _p where clave = 'repetida')) returning id into e;
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  select account_id, company_id, e, position, company_account_id, credit, debit, true from public.journal_line where entry_id = (select v from _p where clave = 'repetida');
  select string_agg(codigo, ',') into v_m from public.conta_motivos_para_validar(e);
  if coalesce(v_m, '') !~ 'apuntes' then raise exception 'PRUEBA S01p·21 · 2: el contraasiento suelto pasa la regla 5 (%).', v_m; end if;
  delete from public.journal_line where entry_id = e; delete from public.journal_entry where id = e;
  raise notice '2 · sin registrar, su contraasiento lo para la regla 5 (%)', v_m;
end $$;

-- 3. «Dejar solo esta».
do $$
declare r jsonb; t public.tax_return; k public.conta_liquidacion_repetida; ce public.journal_entry;
begin
  r := public.conta_liquidacion_dejar_esta((select v from _p where clave = 'd303'), (select v from _p where clave = 'buena'), 'PRUEBA D');
  select * into t from public.tax_return where id = (select v from _p where clave = 'd303');
  if t.liquidation_entry_id <> (select v from _p where clave = 'buena') or t.status <> 'booked' then raise exception 'PRUEBA S01p·21 · 3: el 303 queda % · %.', t.liquidation_entry_id, t.status; end if;
  select * into k from public.conta_liquidacion_repetida where repetida_entry_id = (select v from _p where clave = 'repetida');
  select * into ce from public.journal_entry where id = k.contraasiento_id;
  if ce.id is null or ce.status <> 'validado' or ce.entry_date <> '2026-10-01' or ce.source_type <> 'reversal' or ce.reverses_entry_id <> (select v from _p where clave = 'repetida') then
    raise exception 'PRUEBA S01p·21 · 3: el contraasiento queda %.', row_to_json(ce);
  end if;
  if exists (select 1 from public.journal_line where entry_id = ce.id and (tax_rate_id is not null or vat_book is not null)) then raise exception 'PRUEBA S01p·21 · 3: el contraasiento lleva tipo o libro.'; end if;
  if (select status from public.journal_entry where id = (select v from _p where clave = 'repetida')) <> 'validado' then raise exception 'PRUEBA S01p·21 · 3: la traída cambia de estado.'; end if;
  if r->>'mensaje' !~ ('^Se deja la liquidación 4/\d+: la 9/\d+ queda sin efecto con el contraasiento 9/' || ce.number || ' del 01/10/2026\. Ningún libro de IVA cambia\.$') then
    raise exception 'PRUEBA S01p·21 · 3: dice «%».', r->>'mensaje';
  end if;
  insert into _p values ('contra', ce.id);
  raise notice '3 · %', r->>'mensaje';
end $$;

-- 4 y 5. Otra vez, nada nuevo; y el 303 no hace una tercera.
do $$
declare r jsonb; n int;
begin
  r := public.conta_liquidacion_dejar_esta((select v from _p where clave = 'd303'), (select v from _p where clave = 'buena'), 'PRUEBA D');
  select count(*) into n from public.journal_entry where reverses_entry_id = (select v from _p where clave = 'repetida');
  if n <> 1 or r->>'mensaje' !~ 'ya estaban sin efecto' then raise exception 'PRUEBA S01p·21 · 4: % contraasientos; dice «%».', n, r->>'mensaje'; end if;
  r := public.conta_impuesto_303_contabilizar((select v from _p where clave = 'd303'));
  if not coalesce((r->>'existente')::boolean, false) or r->>'asiento' <> (select v from _p where clave = 'buena')::text then raise exception 'PRUEBA S01p·21 · 5: contabilizar dice %.', r; end if;
  raise notice '4 · otra vez, ningún contraasiento más; 5 · el 303: «%»', r->>'mensaje';
end $$;

-- 6. El contraasiento no cuenta como IVA del periodo en que cae.
do $$
declare f text;
begin
  foreach f in array array['public.conta_impuesto_303_calcular(uuid,integer,text)', 'public.conta_impuesto_303_contabilizar(uuid)', 'public.conta_cierre_bloque_iva(uuid,date)'] loop
    if strpos(pg_get_functiondef(f::regprocedure), 'public.conta_liquidacion_repetida rr where rr.repetida_entry_id') = 0 then raise exception 'PRUEBA S01p·21 · 6: % lo cuenta.', f; end if;
  end loop;
  raise notice '6 · el cálculo, la contabilización y el bloque de IVA del cierre lo dejan fuera';
end $$;

-- 7. Sin cuenta, no.
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
begin
  begin perform public.conta_liquidaciones_repetidas((select v from _p where clave = 'd303')); raise exception 'PRUEBA S01p·21 · 7: sin cuenta lista.';
  exception when insufficient_privilege then null; end;
  begin perform public.conta_liquidacion_dejar_esta((select v from _p where clave = 'd303'), (select v from _p where clave = 'buena'), null); raise exception 'PRUEBA S01p·21 · 7: sin cuenta deja.';
  exception when insufficient_privilege then raise notice '7 · sin cuenta, no («%»)', sqlerrm; end;
end $$;
reset role;
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

-- 8. La vuelta atrás (la tabla tiene una fila: se queda).
\i supabase/vuelta-atras/20261113T1822_s01p_liquidacion_repetida.down.sql
do $$
declare f text;
begin
  foreach f in array array['public.conta_motivos_para_validar(uuid)', 'public.conta_impuesto_303_calcular(uuid,integer,text)', 'public.conta_impuesto_303_contabilizar(uuid)', 'public.conta_cierre_bloque_iva(uuid,date)'] loop
    if strpos(pg_get_functiondef(f::regprocedure), 'conta_liquidacion_repetida') > 0 then raise exception 'PRUEBA S01p·21 · 8: % sigue cambiada.', f; end if;
  end loop;
  if to_regprocedure('public.conta_liquidacion_dejar_esta(uuid,uuid,text)') is not null or to_regprocedure('public.conta_liquidaciones_repetidas(uuid)') is not null then
    raise exception 'PRUEBA S01p·21 · 8: quedan las funciones nuevas.';
  end if;
  raise notice '8 · la vuelta atrás: las cuatro como estaban y fuera las dos nuevas';
end $$;

rollback;
