-- supabase/staging/sql/20261104_s01p_candado_prueba.sql
--
-- SOLO STAGING. Prueba del S01p·2 (1120 y 1121). Todo en una transacción con
-- ROLLBACK, en la empresa de la cuenta A. Nombra lo que toca, para el
-- analizador: company, conta_empresa_dias_guardar, conta_mes_cerrado,
-- conta_mes_cambio, conta_mes_cambios, journal_entry, conta_primer_dia_abierto,
-- tax_return, vat_reopening, fiscal_period_lock.
--   1. Los dos días de la empresa: se guardan, y lo que no vale se rechaza diciendo por qué.
--   2. Un mes cerrado por una persona admite lo que llega después y lo apunta
--      (validado y anulado, con su importe y su nombre); uno del corte con Diez, no.
--   3. El trimestre con el 303 presentado no admite nada: rechaza al crear y al
--      cambiar la fecha, también sin IVA; la liquidación del 303 sí entra; y
--      reabierto para corregir, entra. El primer día abierto salta el trimestre,
--      también para quien valida (sin permiso de más).
--   4. Otra vez las dos: nada cambia.
--   5. La vuelta atrás deja las dos funciones con su huella de producción y
--      quita lo añadido; y otra vez delante.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01p·2 candado: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
-- sin usuario: la tanda la aplica el dueño de las funciones (como el workflow); lo que mira quién es (guardar los días, los cambios del mes) se pide con los claims del administrador de A.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);

\i supabase/migrations/20261104T1120_s01p_candado.sql
\i supabase/migrations/20261104T1121_s01p_dias_foodint.sql

create temp table _p (clave text primary key, v uuid) on commit drop;
grant all on _p to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA S01p·2: no está la empresa de la cuenta A.'; end if;
  select id into y from public.fiscal_year where company_id = c and date '2026-05-10' between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on) values (v_acc, c, '2026', '2026-01-01', '2026-12-31') returning id into y;
  end if;
  insert into _p values ('empresa', c), ('ejercicio', y);
end $$;

-- Un asiento suelto, sin IVA, para la prueba.
create function pg_temp.asiento(p_dia date, p_tipo text default 'manual', p_origen uuid default null, p_estado text default 'borrador') returns uuid language sql as $$
  insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id, status)
  values ('c01a0000-0000-4000-8000-00000000000a', (select v from _p where clave = 'empresa'), (select v from _p where clave = 'ejercicio'),
          2, p_dia, 'PRUEBA S01p candado', p_tipo, p_origen, p_estado)
  returning id
$$;

-- 1 · Los dos días.
do $$
declare c uuid := (select v from _p where clave = 'empresa'); r jsonb; v_err text;
begin
  r := public.conta_empresa_dias_guardar(c, 7::smallint, '{6,5,5}'::smallint[]);
  if (select month_close_day from public.company where id = c) <> 7
     or (select payroll_pay_days from public.company where id = c) <> '{5,6}'::smallint[]
     or r->>'mensaje' <> 'Cada mes se cierra el día 7 del siguiente. La nómina se paga el 5 y el 6 del mes siguiente.' then
    raise exception 'PRUEBA S01p·2 · 1: los días no se guardan como se piden (%).', r;
  end if;
  begin
    perform public.conta_empresa_dias_guardar(c, 29::smallint, null);
    raise exception 'PRUEBA S01p·2 · 1: el día 29 de cierre no se rechaza.';
  exception when sqlstate '22023' then v_err := sqlerrm;
  end;
  if v_err <> 'El día de cierre va del 1 al 28 del mes siguiente.' then raise exception 'PRUEBA S01p·2 · 1: dice «%».', v_err; end if;
  r := public.conta_empresa_dias_guardar(c, null, null);
  if r->>'mensaje' <> 'Sin día de cierre. Sin días de pago de la nómina.' then raise exception 'PRUEBA S01p·2 · 1: vacíos dice %.', r; end if;
  raise notice 'PRUEBA S01p·2 · 1 en verde: los dos días se guardan (7; 5 y 6), el 29 se rechaza diciendo por qué y se pueden dejar vacíos.';
end $$;

-- 2 · El mes cerrado por una persona se marca; el del corte, no admite nada.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c uuid := (select v from _p where clave = 'empresa'); y uuid := (select v from _p where clave = 'ejercicio');
  e uuid; n int; v_que text;
begin
  insert into public.fiscal_period_lock (account_id, company_id, fiscal_year_id, month, kind, locked_by_name)
  values (v_acc, c, y, '2026-08-01', 'manual', 'PRUEBA'), (v_acc, c, y, '2026-03-01', 'migrated', 'PRUEBA');
  if public.conta_mes_cerrado(c, '2026-08-10') then raise exception 'PRUEBA S01p·2 · 2: un mes cerrado por una persona sigue bloqueando.'; end if;
  if not public.conta_mes_cerrado(c, '2026-03-10') then raise exception 'PRUEBA S01p·2 · 2: el mes del corte con Diez ya no bloquea.'; end if;

  -- Un traspaso de 12,34 € entre dos bancos de A (sin gasto, ingreso ni IVA), validado y anulado como en la pantalla.
  e := pg_temp.asiento('2026-08-10');
  insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, is_common)
  select v_acc, c, e, x.n, a.id, x.d, x.h, true
    from (values (1, 12.34, 0::numeric), (2, 0::numeric, 12.34)) x(n, d, h)
    join lateral (select id from public.company_account
                   where company_id = c and kind <> 'template' and status is distinct from 'cerrada' and code ~ '^572'
                   order by code offset x.n - 1 limit 1) a on true;
  if (select count(*) from public.journal_line where entry_id = e) <> 2 then raise exception 'PRUEBA S01p·2 · 2: A no tiene dos 572 para el asiento de la prueba.'; end if;
  perform public.journal_entry_validar(e, 'Prueba S01p');
  perform public.journal_entry_anular(e, 'Prueba S01p: anular después del cierre', '2026-09-15', 'Prueba S01p');
  select count(*), string_agg(que || ':' || importe, ',' order by hecho_at, que) into n, v_que
    from public.conta_mes_cambios(c, '2026-08-01') where entry_id = e;
  if n <> 2 or v_que not in ('validado:12.34,anulado:12.34', 'anulado:12.34,validado:12.34') then
    raise exception 'PRUEBA S01p·2 · 2: lo apuntado después del cierre de agosto no queda escrito como toca (% · %).', n, v_que;
  end if;
  if exists (select 1 from public.conta_mes_cambio where entry_id = e and hecho_por_nombre is null) then
    raise exception 'PRUEBA S01p·2 · 2: un cambio sin quién.';
  end if;
  -- En un mes abierto no se apunta nada.
  -- El contraasiento de la anulación es del 15/09, un mes abierto: no se apunta.
  if exists (select 1 from public.conta_mes_cambio c2 join public.journal_entry r on r.id = c2.entry_id where r.reverses_entry_id = e) then raise exception 'PRUEBA S01p·2 · 2: un mes abierto apunta cambios.'; end if;
  raise notice 'PRUEBA S01p·2 · 2 en verde: agosto cerrado admite y apunta (%); marzo, del corte, sigue sin admitir nada; un mes abierto no apunta.', v_que;
end $$;

-- 3 · El trimestre presentado no admite nada.
do $$
declare
  v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  c uuid := (select v from _p where clave = 'empresa');
  r uuid; e uuid; v_err text; v_hint text; d date;
begin
  insert into public.tax_return (account_id, company_id, form_code, fiscal_year, cadence, period, due_date, status, result_kind, amount, filed_at, filed_via, aeat_csv)
  values (v_acc, c, '303', 2026, 'quarterly', '2T', '2026-07-20', 'filed', 'zero', 0, '2026-07-15 10:00+02', 'outside', 'PRUEBAS01P2T')
  returning id into r;

  begin
    perform pg_temp.asiento('2026-05-10');
    raise exception 'PRUEBA S01p·2 · 3: entra un asiento sin IVA con fecha del 2T presentado.';
  exception when sqlstate '23514' then get stacked diagnostics v_err = message_text, v_hint = pg_exception_hint;
  end;
  if v_hint <> 'iva_presentado' or v_err not like 'El IVA del 2T de 2026 ya está presentado (15/07). No se puede cambiar.%' then
    raise exception 'PRUEBA S01p·2 · 3: al crear, dice «%» (%).', v_err, v_hint;
  end if;

  e := pg_temp.asiento('2026-07-10');
  begin
    update public.journal_entry set entry_date = '2026-06-30' where id = e;
    raise exception 'PRUEBA S01p·2 · 3: un asiento cambia su fecha al 2T presentado.';
  exception when sqlstate '23514' then null;
  end;

  -- La liquidación del propio 303 sí entra.
  perform pg_temp.asiento('2026-06-30', 'vat_settlement', r);

  -- El primer día abierto salta el trimestre, también para quien valida.
  set local role authenticated;
  d := public.conta_primer_dia_abierto(c, '2026-05-10');
  reset role;
  if d is distinct from date '2026-07-01' then raise exception 'PRUEBA S01p·2 · 3: el primer día abierto desde el 10/05 es % y tenía que ser el 01/07.', d; end if;

  -- Reabierto para corregir, entra.
  insert into public.vat_reopening (account_id, company_id, fiscal_year, period, original_return_id, new_return_id, kind, reason)
  values (v_acc, c, 2026, '2T', r, r, 'complementary', 'PRUEBA S01p: corregir el 2T');
  perform pg_temp.asiento('2026-05-10');
  raise notice 'PRUEBA S01p·2 · 3 en verde: el 2T presentado rechaza al crear y al cambiar la fecha («%»); su liquidación entra; el primer día abierto es el 01/07; reabierto, entra.', left(v_err, 70);
end $$;

-- 4 · Otra vez: nada.
create temp table _huella (que text primary key, h text) on commit drop;
insert into _huella values
  ('mes', md5(pg_get_functiondef('public.conta_mes_cerrado(uuid,date)'::regprocedure))),
  ('dia', md5(pg_get_functiondef('public.conta_primer_dia_abierto(uuid,date)'::regprocedure))),
  ('cambios', (select count(*)::text from public.conta_mes_cambio));
\i supabase/migrations/20261104T1120_s01p_candado.sql
\i supabase/migrations/20261104T1121_s01p_dias_foodint.sql
do $$ begin
  if (select h from _huella where que = 'mes') <> md5(pg_get_functiondef('public.conta_mes_cerrado(uuid,date)'::regprocedure))
     or (select h from _huella where que = 'dia') <> md5(pg_get_functiondef('public.conta_primer_dia_abierto(uuid,date)'::regprocedure))
     or (select h from _huella where que = 'cambios') <> (select count(*)::text from public.conta_mes_cambio) then
    raise exception 'PRUEBA S01p·2 · 4: pasarlas otra vez cambió algo.';
  end if;
  raise notice 'PRUEBA S01p·2 · 4 en verde: otra vez, nada cambia.';
end $$;

-- 5 · La vuelta atrás, y otra vez delante.
\i supabase/vuelta-atras/20261104T1121_s01p_dias_foodint.down.sql
\i supabase/vuelta-atras/20261104T1120_s01p_candado.down.sql
do $$ begin
  -- Las huellas de producción del 04/11 (iguales en staging antes de la 1120).
  if md5(pg_get_functiondef('public.conta_mes_cerrado(uuid,date)'::regprocedure)) <> '163d4d286cf462a392ee33c785d79901'
     or md5(pg_get_functiondef('public.conta_primer_dia_abierto(uuid,date)'::regprocedure)) <> 'ce7736a584144c60fa9b51f3208f8f0a' then
    raise exception 'PRUEBA S01p·2 · 5: la vuelta atrás no deja las dos funciones como en producción.';
  end if;
  if to_regclass('public.conta_mes_cambio') is not null
     or exists (select 1 from pg_trigger where tgname in ('s01p_mes_cambio', 'trg_journal_entry_0_trimestre_presentado'))
     or exists (select 1 from information_schema.columns where table_name = 'company' and column_name in ('month_close_day', 'payroll_pay_days')) then
    raise exception 'PRUEBA S01p·2 · 5: la vuelta atrás deja algo de lo añadido.';
  end if;
  raise notice 'PRUEBA S01p·2 · 5 en verde: la vuelta atrás, con las huellas de producción y sin nada de lo añadido.';
end $$;
\i supabase/migrations/20261104T1120_s01p_candado.sql
\i supabase/migrations/20261104T1121_s01p_dias_foodint.sql
do $$ begin
  if to_regclass('public.conta_mes_cambio') is null then raise exception 'PRUEBA S01p·2 · 5: otra vez delante, no está.'; end if;
  raise notice 'PRUEBA S01p·2 · 5 en verde: y otra vez delante.';
end $$;

rollback;
