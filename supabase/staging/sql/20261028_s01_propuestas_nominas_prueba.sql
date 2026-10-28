-- supabase/staging/sql/20261028_s01_propuestas_nominas_prueba.sql
--
-- SOLO STAGING. Prueba de la 0753 (la base de las propuestas sin botón) y de la
-- 0800 (las nóminas se proponen solas), con \i dentro de la transacción y
-- ROLLBACK: staging no cambia. En la empresa A, con nóminas inventadas de
-- octubre a diciembre (la de septiembre de la semilla C04 ya tiene su asiento),
-- por sus caminos: como el administrador (lo que llama el navegador), y al
-- llegar una nómina (el disparador, sin nadie).
--
--   1. Llega una sin tipo de retención de trabajo: no se propone, y queda en «Lo
--      que no he podido proponer» con su porqué en palabras y dónde se arregla.
--   2. Con él: se propone (640 · 642 al debe; 476 · 4751 (111) · 465 al haber),
--      propuesta y sin validar, del último día del mes; su «no he podido» se va.
--      Otra vez, nada nuevo: ya estaba.
--   3. Una nómina que llega se propone sola (el disparador).
--   4. Una que no cuadra llega: no se propone, entra igual, y queda dicho por qué.
--   5. Alguien sin cuenta no puede proponer.
--   6. Las vueltas atrás (0800 y 0753): no queda nada suyo.
--
-- Nombra lo que toca, para el analizador: conta_propuesta_pendiente,
-- conta_dia_abierto, _conta_proponer, _conta_no_propuesta,
-- conta_propuesta_nomina, conta_proponer_nominas, tg_conta_nomina_proponer,
-- payroll_summary, withholding_rate, journal_entry, journal_line.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 NÓMINAS: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '180s';
set local lock_timeout = '120s';
lock table public.accounts, public.company, public.company_account, public.bank_match in share row exclusive mode;
lock table public.conta_enlace_pago, public.treasury_account, public.journal_entry in access exclusive mode;

select to_regclass('public.conta_propuesta_pendiente') is not null as ya_esta_la_0753,
       to_regprocedure('public.conta_propuesta_nomina(uuid)') is not null as ya_esta_la_0800 \gset
\if :ya_esta_la_0753
\else
\i supabase/migrations/20261028T0753_s01_propuestas_solas_base.sql
\endif
\if :ya_esta_la_0800
\else
\i supabase/migrations/20261028T0800_s01_propuestas_nominas.sql
\endif

create or replace function pg_temp.lineas(p uuid) returns text language sql as $$
  select string_agg(ca.code || ' ' || coalesce(jl.debit, 0)::numeric(14,2) || '/' || coalesce(jl.credit, 0)::numeric(14,2), ' · ' order by jl.position)
    from public.journal_line jl join public.company_account ca on ca.id = jl.company_account_id where jl.entry_id = p
$$;
create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'),
  ('admin', 'c01a0000-0000-4000-8000-0000000000a1'), ('sept', 'c0400000-0000-4000-8000-000000000201');

-- La nómina de septiembre de la semilla C04 ya tiene su asiento validado: la
-- prueba usa nóminas suyas (inventadas, en ROLLBACK) de meses sin ninguna.
delete from public.withholding_rate where code = 'trabajo' and filed_in = '111';
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa');
begin
  if exists (select 1 from public.payroll_summary where company_id = e and period_month >= '2026-10-01') then
    raise exception 'PRUEBA S01 NÓMINAS · siembra: la empresa A ya tiene nóminas de octubre a diciembre; no se prueba encima.';
  end if;
  insert into _p select 'local', location_id::text from public.payroll_summary where id = (select v::uuid from _p where clave = 'sept');
end $$;

-- ── 1 · Llega la de diciembre sin tipo de retención de trabajo: no se propone, y se dice ──
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); a uuid := (select v::uuid from _p where clave = 'cuenta'); dic uuid;
begin
  insert into public.payroll_summary (account_id, company_id, period_month, location_id, gross, employer_ss, employee_ss, irpf, other_deductions, net, employees_count, created_by_name)
  values (a, e, '2026-12-01', (select v::uuid from _p where clave = 'local'), 4200.00, 1340.00, 268.80, 420.00, 0, 3511.20, 3, 'Prueba S01') returning id into dic;
  insert into _p values ('dic', dic);
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', (select v from _p where clave = 'admin'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb;
begin
  if exists (select 1 from public.journal_entry where company_id = e and source_type = 'payroll' and source_id = (select v::uuid from _p where clave = 'dic')) then
    raise exception 'PRUEBA S01 NÓMINAS · 1: sin tipo de trabajo, al llegar se propuso.';
  end if;
  x := public.conta_proponer_nominas(e, '2026-12-01', '2026-12-31', 'Prueba');
  if (x->>'propuestas')::int <> 0 or x->'sinPropuesta'->0->>'porque' <> 'Falta el tipo de retención de trabajo en Tablas › Retenciones.'
     or x->'sinPropuesta'->0->>'que' <> 'Nóminas de 12/2026' then
    raise exception 'PRUEBA S01 NÓMINAS · 1: sin tipo de trabajo dio %.', x;
  end if;
  if (select porque || ' · ' || donde from public.conta_propuesta_pendiente where company_id = e and origen = 'payroll' and origen_id = (select v from _p where clave = 'dic'))
     <> 'Falta el tipo de retención de trabajo en Tablas › Retenciones. · Contabilidad › Asientos' then
    raise exception 'PRUEBA S01 NÓMINAS · 1: el «no he podido» no quedó apuntado (o el administrador no lo lee).';
  end if;
  raise notice '1 · sin tipo de trabajo: «%», en «Lo que no he podido proponer»', x->'sinPropuesta'->0->>'porque';
end $$;
reset role;

-- ── 2 · Con él: se propone, sin validar ─────────────────────────────────────
insert into public.withholding_rate (code, name, rate, filed_in, valid_from, is_system)
values ('trabajo', 'Rendimientos del trabajo (prueba S01)', 15, '111', '2026-01-01', true);
set local role authenticated;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); x jsonb; je public.journal_entry;
begin
  x := public.conta_proponer_nominas(e, '2026-12-01', '2026-12-31', 'Prueba');
  if (x->>'propuestas')::int <> 1 or jsonb_array_length(x->'sinPropuesta') <> 0 then raise exception 'PRUEBA S01 NÓMINAS · 2: con el tipo dio %.', x; end if;
  select * into je from public.journal_entry where company_id = e and source_type = 'payroll' and source_id = (select v::uuid from _p where clave = 'dic');
  if je.status <> 'propuesto' or je.entry_date <> '2026-12-31' or je.series <> 9 or je.concept <> 'Nóminas de 12/2026' or je.confidence <> 'seguro' then
    raise exception 'PRUEBA S01 NÓMINAS · 2: el asiento es % del % (serie %, «%», %).', je.status, je.entry_date, je.series, je.concept, je.confidence;
  end if;
  if pg_temp.lineas(je.id) <> '64000000 4200.00/0.00 · 64200000 1340.00/0.00 · 47600000 0.00/1608.80 · 47510000 0.00/420.00 · 46500000 0.00/3511.20' then
    raise exception 'PRUEBA S01 NÓMINAS · 2: las líneas fueron «%».', pg_temp.lineas(je.id);
  end if;
  if (select withholding_model from public.journal_line where entry_id = je.id and withholding_rate_id is not null) is distinct from '111' then
    raise exception 'PRUEBA S01 NÓMINAS · 2: la retención no va al 111.';
  end if;
  if exists (select 1 from public.conta_propuesta_pendiente where company_id = e and origen = 'payroll') then
    raise exception 'PRUEBA S01 NÓMINAS · 2: el «no he podido» sigue ahí después de proponerla.';
  end if;
  x := public.conta_proponer_nominas(e, '2026-12-01', '2026-12-31', 'Prueba');
  if (x->>'propuestas')::int <> 0 or (x->>'yaEstaban')::int <> 1 then raise exception 'PRUEBA S01 NÓMINAS · 2: otra vez dio %.', x; end if;
  raise notice '2 · con el tipo de trabajo: %, propuesta (sin validar); otra vez, ya estaba', pg_temp.lineas(je.id);
end $$;
reset role;

-- ── 3 y 4 · Llegan nóminas (el disparador, sin nadie) ───────────────────────
set local role service_role;
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); a uuid := (select v::uuid from _p where clave = 'cuenta');
        l1 uuid := (select v::uuid from _p where clave = 'local'); oct uuid; nov uuid;
begin
  insert into public.payroll_summary (account_id, company_id, period_month, location_id, gross, employer_ss, employee_ss, irpf, other_deductions, net, employees_count, created_by_name)
  values (a, e, '2026-10-01', l1, 4300.00, 1370.00, 275.20, 430.00, 0, 3594.80, 3, 'Prueba S01') returning id into oct;
  if not exists (select 1 from public.journal_entry where company_id = e and source_type = 'payroll' and source_id = oct and status = 'propuesto') then
    raise exception 'PRUEBA S01 NÓMINAS · 3: la nómina de octubre llegó y no se propuso sola (%).',
      (select porque from public.conta_propuesta_pendiente where company_id = e and origen_id = oct::text);
  end if;
  insert into public.payroll_summary (account_id, company_id, period_month, location_id, gross, employer_ss, employee_ss, irpf, other_deductions, net, employees_count, created_by_name)
  values (a, e, '2026-11-01', l1, 4000.00, 1300.00, 250.00, 400.00, 0, 3000.00, 3, 'Prueba S01') returning id into nov;
  if exists (select 1 from public.journal_entry where company_id = e and source_type = 'payroll' and source_id = nov) then
    raise exception 'PRUEBA S01 NÓMINAS · 4: una nómina que no cuadra se propuso.';
  end if;
  if (select porque from public.conta_propuesta_pendiente where company_id = e and origen = 'payroll' and origen_id = nov::text)
     <> 'Bruto 4.000,00 € ≠ SS del trabajador + IRPF + otras + líquido: revisa el resumen de la gestoría.' then
    raise exception 'PRUEBA S01 NÓMINAS · 4: no quedó dicho por qué (%).', (select porque from public.conta_propuesta_pendiente where company_id = e and origen_id = nov::text);
  end if;
  raise notice '3 · la de octubre llega y se propone sola · 4 · la de noviembre no cuadra: entra, y se dice por qué';
end $$;
reset role;

-- ── 5 · Sin cuenta, no ──────────────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_proponer_nominas((select v::uuid from _p where clave = 'empresa'), '2026-09-01', '2026-12-31', 'Nadie');
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01 NÓMINAS · 5: alguien sin cuenta propone nóminas.'; end if;
  begin perform 1 from public.conta_propuesta_pendiente; exception when others then v_err := 'denegado'; end;
  raise notice '5 · sin cuenta, no se proponen nóminas («%»)', v_err;
end $$;
reset role;

-- ── 6 · Las vueltas atrás ───────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T0800_s01_propuestas_nominas.down.sql
\i supabase/vuelta-atras/20261028T0753_s01_propuestas_solas_base.down.sql
do $$ begin
  if to_regclass('public.conta_propuesta_pendiente') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
                 and proname in ('conta_dia_abierto', '_conta_proponer', '_conta_no_propuesta', 'conta_propuesta_nomina', 'conta_proponer_nominas', 'tg_conta_nomina_proponer'))
     or exists (select 1 from pg_trigger where tgname = 'conta_nomina_proponer') then
    raise exception 'PRUEBA S01 NÓMINAS · 6: las vueltas atrás dejan algo.';
  end if;
  raise notice '6 · las vueltas atrás: no queda nada de la 0800 ni de la 0753';
end $$;
rollback;
