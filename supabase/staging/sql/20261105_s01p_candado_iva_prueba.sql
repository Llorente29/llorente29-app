-- supabase/staging/sql/20261105_s01p_candado_iva_prueba.sql
--
-- SOLO STAGING. Prueba del S01p·13 (0830): el candado, solo para lo que lleva
-- IVA. Todo en una transacción con ROLLBACK, en la empresa de la cuenta A, con
-- cuentas de mentira si no las tiene. Nombra lo que cambia, para el analizador:
-- conta_motivos_para_validar, _tg_s01p_trimestre_presentado,
-- tg_journal_entry_no_antes_del_corte, _tg_s01p_mes_cambio,
-- conta_traspaso_lista, conta_mes_cambio, journal_entry, journal_line.
--
-- La cuenta de mentira: el ejercicio 2026 traído de Diez hasta el 30/09
-- (imported_until), julio cerrado por el corte («migrated»), y el 303 y el 111
-- del 3T presentados. El camino entero termina en VALIDAR (regla 10).
--   1. Un pago de caja de julio, sin IVA (629 contra 570), se crea, SE VALIDA y
--      queda en conta_mes_cambio (validado, quién, por qué estaba cerrado).
--   2. Una factura recibida de julio sigue parada, diciendo por qué.
--   3. Un apunte a la 472 en julio, parado. Y en marzo (traído, sin 303 en
--      Sumied) se puede escribir de borrador pero no se valida: el motivo dice
--      «lleva IVA (línea 2, 47200099)».
--   4. Uno a la 4751 con el 111 del 3T presentado, parado.
--   5. Un asiento traído de Diez no se puede cambiar, ni borrar, ni anular; y
--      no se marca como «apuntado tarde».
--   6. El traspaso a Diez de octubre recoge el pago de julio; el de septiembre
--      (un mes antes de marcarse), no.
--   7. Lo automático de antes del corte (banco) sigue parado.
--   8. La vuelta atrás deja las cinco funciones con su huella de producción y
--      quita lo nuevo; y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·13: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); para validar y anular, los «claims» del administrador de A.
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

\i supabase/migrations/20261105T0830_s01p_candado_iva.sql

create temp table _p (clave text primary key, v uuid) on commit drop;
grant all on _p to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid; x record;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p·13: no está la empresa de la cuenta A.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-07-15' between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  end if;
  -- Traído hasta el 30/09, como Foodint (sin falta de histórico).
  update public.fiscal_year set origin = 'mixed', origin_program = 'diez', history_imported_at = coalesce(history_imported_at, now()), imported_until = '2026-09-30', status = 'open' where id = y;
  for x in select * from (values ('57000099', '570'), ('62900099', '629'), ('47200099', '472'), ('47510099', '4751')) v(code, t) loop
    if not exists (select 1 from public.company_account where company_id = c and code = x.code) then
      insert into public.company_account (account_id, company_id, code, name, kind, plan, source, template_code)
      values (v_acc, c, x.code, 'PRUEBA S01p·13 ' || x.t, 'own', 'pymes', 'manual', x.t);
    end if;
  end loop;
  delete from public.fiscal_period_lock where company_id = c and month in ('2026-03-01', '2026-07-01');
  insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by_name)
  values (v_acc, c, y, '2026-07-01', 'migrated', 'PRUEBA'), (v_acc, c, y, '2026-03-01', 'migrated', 'PRUEBA');
  delete from public.tax_return where company_id = c and fiscal_year = 2026 and period in ('1T', '3T') and form_code in ('303', '111', '115');
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
  values (v_acc, c, '303', 2026, 'quarterly', '3T', '2026-10-20', 'filed', 'zero', 0, '2026-10-15 10:00+02', 'outside', 'PRUEBAS01P13A'),
         (v_acc, c, '111', 2026, 'quarterly', '3T', '2026-10-20', 'filed', 'zero', 0, '2026-10-15 10:00+02', 'outside', 'PRUEBAS01P13B');
  insert into _p values ('empresa', c), ('ejercicio', y);
end $$;

-- Un asiento y sus apuntes, para la prueba.
create function pg_temp.asiento(p_dia date, p_tipo text default 'manual', p_estado text default 'borrador') returns uuid language sql as $$
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, external_program)
  values ('c01a0000-0000-4000-8000-00000000000a', (select v from _p where clave = 'empresa'), (select v from _p where clave = 'ejercicio'),
          2, p_dia, 'PRUEBA S01p·13 ' || p_tipo, p_tipo, p_estado, case when p_tipo = 'migrated' then 'diez' end)
  returning id
$$;
create function pg_temp.apunte(p_e uuid, p_pos int, p_cuenta text, p_debe numeric, p_haber numeric) returns void language sql as $$
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  select 'c01a0000-0000-4000-8000-00000000000a', a.company_id, p_e, p_pos, a.id, p_debe, p_haber, true
    from public.company_account a where a.company_id = (select v from _p where clave = 'empresa') and a.code = p_cuenta
$$;

-- 1 · El pago de caja de julio, sin IVA: se crea, se valida y queda marcado.
do $$
declare e uuid; n int; r record;
begin
  e := pg_temp.asiento('2026-07-15');
  perform pg_temp.apunte(e, 1, '62900099', 10.00, 0);
  perform pg_temp.apunte(e, 2, '57000099', 0, 10.00);
  if (select count(*) from public.journal_line where entry_id = e) <> 2 then raise exception 'PRUEBA S01p·13 · 1: faltan cuentas para el asiento.'; end if;
  perform public.journal_entry_validar(e, 'PRUEBA D');
  if not exists (select 1 from public.journal_entry where id = e and status = 'validado') then raise exception 'PRUEBA S01p·13 · 1: el pago de caja de julio no queda validado.'; end if;
  select count(*), max(que) que, max(motivo) motivo, max(importe) importe, bool_and(hecho_por_nombre is not null and hecho_at is not null) quien
    into r from public.conta_mes_cambio where entry_id = e;
  if r.count <> 1 or r.que <> 'validado' or r.motivo <> 'migrated' or r.importe <> 10.00 or not r.quien then
    raise exception 'PRUEBA S01p·13 · 1: no queda marcado como toca (% · % · % · % · %).', r.count, r.que, r.motivo, r.importe, r.quien;
  end if;
  insert into _p values ('pago_julio', e);
  raise notice 'PRUEBA S01p·13 · 1 en verde: el pago de caja del 15/07 se crea, se valida y queda en conta_mes_cambio (validado, migrated, 10,00, con quién y cuándo).';
end $$;

-- 2 · La factura recibida de julio, parada.
do $$
declare v_err text;
begin
  begin
    perform pg_temp.asiento('2026-07-15', 'supplier_invoice');
    raise exception 'PRUEBA S01p·13 · 2: entra una factura recibida de julio.';
  exception when sqlstate '23514' then v_err := sqlerrm;
  end;
  if v_err !~ 'IVA del 3T de 2026 ya está presentado' then raise exception 'PRUEBA S01p·13 · 2: el mensaje no dice por qué: «%».', v_err; end if;
  raise notice 'PRUEBA S01p·13 · 2 en verde: la factura recibida de julio sigue parada («%»).', v_err;
end $$;

-- 3 · La 472 en julio, parada; en marzo, se escribe pero no se valida.
do $$
declare e uuid; v_err text; m text;
begin
  e := pg_temp.asiento('2026-07-20');
  begin
    perform pg_temp.apunte(e, 1, '47200099', 2.10, 0);
    raise exception 'PRUEBA S01p·13 · 3: entra un apunte a la 472 en julio.';
  exception when sqlstate '23514' then v_err := sqlerrm;
  end;
  if v_err !~ 'IVA del 3T de 2026 ya está presentado' then raise exception 'PRUEBA S01p·13 · 3: dice «%».', v_err; end if;
  e := pg_temp.asiento('2026-03-20');
  perform pg_temp.apunte(e, 1, '62900099', 10.00, 0);
  perform pg_temp.apunte(e, 2, '47200099', 2.10, 0);
  perform pg_temp.apunte(e, 3, '57000099', 0, 12.10);
  select string_agg(motivo, ' | ') into m from public.conta_motivos_para_validar(e) where codigo = 'periodo_cerrado';
  if m is distinct from 'No se puede: el mes de 03/2026 está cerrado (hasta el 30/09/2026 lo lleva Diez) y este asiento lleva IVA (línea 2, 47200099).' then
    raise exception 'PRUEBA S01p·13 · 3: en marzo el motivo es «%».', m;
  end if;
  begin
    perform public.journal_entry_validar(e, 'PRUEBA D');
    raise exception 'PRUEBA S01p·13 · 3: se valida un asiento con IVA en marzo, traído.';
  exception when others then
    get stacked diagnostics v_err = message_text;
    if v_err !~ 'lleva IVA \(línea 2, 47200099\)' then raise; end if;
  end;
  raise notice 'PRUEBA S01p·13 · 3 en verde: la 472 de julio no entra (IVA del 3T presentado); la de marzo no se valida («%»).', m;
end $$;

-- 4 · La 4751 con el 111 del 3T presentado, parada.
do $$
declare e uuid; v_err text; v_hint text;
begin
  e := pg_temp.asiento('2026-08-05');
  begin
    perform pg_temp.apunte(e, 1, '47510099', 30.00, 0);
    raise exception 'PRUEBA S01p·13 · 4: entra un apunte a la 4751 con el 111 del 3T presentado.';
  exception when sqlstate '23514' then get stacked diagnostics v_err = message_text, v_hint = pg_exception_hint;
  end;
  if v_hint <> 'retenciones_presentadas' or v_err <> 'No se puede: el 111 del 3T de 2026 ya está presentado y este apunte lleva retención (línea 1, 47510099).' then
    raise exception 'PRUEBA S01p·13 · 4: dice «%» (%).', v_err, v_hint;
  end if;
  -- En octubre (4T, sin presentar) sí entra.
  e := pg_temp.asiento('2026-10-05');
  perform pg_temp.apunte(e, 1, '47510099', 30.00, 0);
  raise notice 'PRUEBA S01p·13 · 4 en verde: «%»; en el 4T, entra.', v_err;
end $$;

-- 5 · Lo traído de Diez no se cambia, ni se borra, ni se anula.
do $$
declare e uuid; v_err text; ok int := 0;
begin
  e := pg_temp.asiento('2026-07-10', 'migrated', 'borrador');
  perform pg_temp.apunte(e, 1, '62900099', 5.00, 0);
  perform pg_temp.apunte(e, 2, '57000099', 0, 5.00);
  perform public.journal_entry_validar(e, 'PRUEBA Diez');
  if not exists (select 1 from public.journal_entry where id = e and status = 'validado') then raise exception 'PRUEBA S01p·13 · 5: el traído no queda validado para la prueba.'; end if;
  begin update public.journal_entry set concept = 'cambiado' where id = e; exception when sqlstate '42501' then ok := ok + 1; end;
  begin delete from public.journal_entry where id = e; exception when sqlstate '42501' then ok := ok + 1; end;
  begin perform public.journal_entry_anular(e, 'PRUEBA anular lo traído'); exception when sqlstate '42501' then get stacked diagnostics v_err = message_text; ok := ok + 1; end;
  if ok <> 3 then raise exception 'PRUEBA S01p·13 · 5: lo traído de Diez se deja tocar (% de 3 paradas).', ok; end if;
  if v_err !~ 'traído de Diez: no se anula' then raise exception 'PRUEBA S01p·13 · 5: al anular dice «%».', v_err; end if;
  if exists (select 1 from public.conta_mes_cambio where entry_id = e) then raise exception 'PRUEBA S01p·13 · 5: lo traído se marca como apuntado tarde.'; end if;
  if (select status from public.journal_entry where id = e) <> 'validado' then raise exception 'PRUEBA S01p·13 · 5: el traído ha cambiado.'; end if;
  raise notice 'PRUEBA S01p·13 · 5 en verde: lo traído no se cambia, ni se borra, ni se anula («%»), y no se marca.', v_err;
end $$;

-- 6 · El traspaso a Diez recoge el pago de julio en el de octubre.
do $$
declare c uuid := (select v from _p where clave = 'empresa'); e uuid := (select v from _p where clave = 'pago_julio'); m date;
begin
  m := date_trunc('month', now() at time zone 'Europe/Madrid')::date - 1;   -- el mes de antes de marcarse
  m := date_trunc('month', m)::date;
  if not exists (select 1 from public.conta_traspaso_lista(c, m) where entry_id = e) then
    raise exception 'PRUEBA S01p·13 · 6: el traspaso de % no recoge el pago de julio.', to_char(m, 'MM/YYYY');
  end if;
  if exists (select 1 from public.conta_traspaso_lista(c, (m - interval '1 month')::date) where entry_id = e) then
    raise exception 'PRUEBA S01p·13 · 6: un traspaso más viejo (%) también lo recoge.', to_char(m - interval '1 month', 'MM/YYYY');
  end if;
  if not exists (select 1 from public.conta_traspaso_lista(c, '2026-07-01') where entry_id = e) then
    raise exception 'PRUEBA S01p·13 · 6: el de julio deja de recogerlo.';
  end if;
  raise notice 'PRUEBA S01p·13 · 6 en verde: el traspaso de % recoge el pago del 15/07; el de antes, no.', to_char(m, 'MM/YYYY');
end $$;

-- 7 · Lo automático de antes del corte sigue parado.
do $$
declare v_err text;
begin
  begin
    perform pg_temp.asiento('2026-08-12', 'bank');
    raise exception 'PRUEBA S01p·13 · 7: entra un asiento de banco de antes del corte.';
  exception when sqlstate '23514' then v_err := sqlerrm;
  end;
  if v_err !~ 'antes del corte' then raise exception 'PRUEBA S01p·13 · 7: dice «%».', v_err; end if;
  raise notice 'PRUEBA S01p·13 · 7 en verde: «%».', v_err;
end $$;

-- 8 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261105T0830_s01p_candado_iva.down.sql
do $$
declare x record;
begin
  for x in select * from (values
      ('public.conta_motivos_para_validar(uuid)', '3f7ee5dbee6904c7c5cf892696f71c3f'),
      ('public._tg_s01p_trimestre_presentado()', '55e51012f267dcc8272745c5056a6c8d'),
      ('public.tg_journal_entry_no_antes_del_corte()', '1c3ac9212eec9ccf852f12dc94750e5b'),
      ('public._tg_s01p_mes_cambio()', 'be37fb162280724fd6c7c6ef980f2042'),
      ('public.conta_traspaso_lista(uuid,date)', 'a6681e3f801fcceb1653acf59e66539d')) v(f, h) loop
    if md5(pg_get_functiondef(x.f::regprocedure)) <> x.h then raise exception 'PRUEBA S01p·13 · 8: % no vuelve a su huella de producción.', x.f; end if;
  end loop;
  if to_regprocedure('public._conta_periodo_admite(uuid)') is not null
     or exists (select 1 from pg_trigger where tgname in ('trg_journal_line_0_retencion_presentada', 'trg_journal_entry_0_traido_no_se_anula')) then
    raise exception 'PRUEBA S01p·13 · 8: queda algo de lo nuevo.';
  end if;
  if exists (select 1 from information_schema.columns where table_name = 'conta_mes_cambio' and column_name = 'motivo')
     or (select is_nullable from information_schema.columns where table_name = 'conta_mes_cambio' and column_name = 'lock_id') <> 'NO' then
    raise exception 'PRUEBA S01p·13 · 8: conta_mes_cambio no vuelve a como estaba.';
  end if;
  raise notice 'PRUEBA S01p·13 · 8 en verde: las cinco funciones vuelven a su huella de producción y lo nuevo se va.';
end $$;
\i supabase/migrations/20261105T0830_s01p_candado_iva.sql
do $$ begin
  if to_regprocedure('public._conta_periodo_admite(uuid)') is null then raise exception 'PRUEBA S01p·13 · 8: no vuelve delante.'; end if;
  raise notice 'PRUEBA S01p·13 · 8: y otra vez delante, bien.';
end $$;

rollback;
