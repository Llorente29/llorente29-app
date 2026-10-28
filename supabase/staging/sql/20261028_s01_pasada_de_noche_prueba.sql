-- supabase/staging/sql/20261028_s01_pasada_de_noche_prueba.sql
--
-- SOLO STAGING. Prueba de la 1025 (la pasada de las 03:40), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la empresa A, con las propuestas
-- de ventas que ya tiene staging (medido el 28/10: 1 «seguro» del 25/09 y 2
-- «probable»), por su camino: como el cron (sin nadie).
--
--   1. Con «Validar solos los Seguros de ventas» apagado: pasa por los cinco
--      orígenes, sin fallos, y no valida nada.
--   2. Encendido: valida la «seguro» sin «Mira esto», y solo esa; una «seguro»
--      con «Mira esto» y las «probable» se quedan propuestas.
--   3. Otra vez: nada nuevo (ni propuesto ni validado).
--   4. Alguien de otra cuenta no puede pasarla, y sin cuenta tampoco.
--   5. El cron: a las 01:40 y 02:40 UTC; fuera de las 3 de Madrid, el
--      procedimiento no hace nada.
--   6. La vuelta atrás: no queda nada de la 1025.
--
-- Nombra lo que toca, para el analizador: conta_propuestas_de_noche,
-- conta_propuestas_de_noche_todas, conta_proponer_nominas,
-- conta_proponer_recibidos, conta_proponer_pagados_despues,
-- conta_proponer_socios, conta_proponer_plataformas, _journal_entry_validar,
-- company_tax_profile, journal_entry.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA S01 NOCHE: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';
set local lock_timeout = '120s';
lock table public.accounts, public.company, public.company_account, public.bank_match in share row exclusive mode;
lock table public.conta_enlace_pago, public.treasury_account, public.journal_entry in access exclusive mode;

select to_regclass('public.conta_propuesta_pendiente') is not null as ya_0753,
       to_regprocedure('public.conta_proponer_nominas(uuid,date,date,text)') is not null as ya_0800,
       to_regprocedure('public.conta_proponer_recibidos(uuid,date,date,text)') is not null as ya_0830,
       to_regprocedure('public.conta_proponer_pagados_despues(uuid,text)') is not null as ya_0849,
       to_regprocedure('public.conta_proponer_socios(uuid,date,date,text)') is not null as ya_0905,
       to_regprocedure('public.conta_proponer_plataformas(uuid,date,date,text)') is not null as ya_0929,
       to_regprocedure('public.conta_propuestas_de_noche(uuid)') is not null as ya_1025 \gset
\if :ya_0753
\else
\i supabase/migrations/20261028T0753_s01_propuestas_solas_base.sql
\endif
\if :ya_0800
\else
\i supabase/migrations/20261028T0800_s01_propuestas_nominas.sql
\endif
\if :ya_0830
\else
\i supabase/migrations/20261028T0830_s01_propuestas_recibido.sql
\endif
\if :ya_0849
\else
\i supabase/migrations/20261028T0849_s01_propuestas_pagado_despues.sql
\endif
\if :ya_0905
\else
\i supabase/migrations/20261028T0905_s01_propuestas_socio.sql
\endif
\if :ya_0929
\else
\i supabase/migrations/20261028T0929_s01_propuestas_plataforma.sql
\endif
\if :ya_1025
\else
\i supabase/migrations/20261028T1025_s01_pasada_de_noche.sql
\endif

create temp table _p (clave text primary key, v text) on commit drop;
grant select, insert, update on _p to authenticated, anon, service_role;
insert into _p values ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'), ('cuenta', 'c01a0000-0000-4000-8000-00000000000a');

-- La población, medida antes: las propuestas de ventas de la empresa A.
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); v_seguro uuid; v_mira uuid;
begin
  select id into v_seguro from public.journal_entry
   where company_id = e and source_type = 'sales_day' and status = 'propuesto' and confidence = 'seguro'
     and not exists (select 1 from jsonb_array_elements(coalesce(reasons, '[]'::jsonb)) z where z->>'decision' = 'Mira esto')
   order by entry_date, id limit 1;
  if v_seguro is null then raise exception 'PRUEBA S01 NOCHE: staging ya no tiene ninguna propuesta de ventas «seguro» en la empresa A; la prueba no mediría nada.'; end if;
  -- Una «probable» pasa a «seguro» con «Mira esto»: tiene que quedarse propuesta.
  select id into v_mira from public.journal_entry
   where company_id = e and source_type = 'sales_day' and status = 'propuesto' and confidence = 'probable' order by entry_date, id limit 1;
  if v_mira is null then raise exception 'PRUEBA S01 NOCHE: staging ya no tiene ninguna «probable» en la empresa A.'; end if;
  update public.journal_entry set confidence = 'seguro',
         reasons = coalesce(reasons, '[]'::jsonb) || jsonb_build_array(jsonb_build_object('decision', 'Mira esto', 'porque', 'Prueba S01: una seguro con algo que mirar.'))
   where id = v_mira;
  insert into _p values ('seguro', v_seguro), ('mira', v_mira),
    ('propuestas_antes', (select count(*) from public.journal_entry where company_id = e and status = 'propuesto')::text);
  raise notice 'población: la «seguro» % y la «seguro con Mira esto» %; % propuestos en la empresa', v_seguro, v_mira, (select v from _p where clave = 'propuestas_antes');
end $$;

-- ── 1 · Apagado: los cinco orígenes, sin validar nada ───────────────────────
select set_config('request.jwt.claims', '', true);
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb;
begin
  update public.company_tax_profile set journal_autovalidate_sales_day = false where company_id = e;
  r := public.conta_propuestas_de_noche(e);
  if not (r ? 'nominas' and r ? 'recibido' and r ? 'pagado' and r ? 'socio' and r ? 'plataforma') then
    raise exception 'PRUEBA S01 NOCHE · 1: no ha pasado por los cinco orígenes: %', r;
  end if;
  if jsonb_array_length(r->'fallos') > 0 then raise exception 'PRUEBA S01 NOCHE · 1: fallos: %', r->'fallos'; end if;
  if (r->>'validadasSolas')::int <> 0 or (select status from public.journal_entry where id = (select v::uuid from _p where clave = 'seguro')) <> 'propuesto' then
    raise exception 'PRUEBA S01 NOCHE · 1: apagado, ha validado algo: %', r;
  end if;
  insert into _p values ('propuestas_1', (select count(*) from public.journal_entry where company_id = e and status = 'propuesto')::text);
  raise notice '1 · apagado: desde % hasta %, los cinco orígenes (nóminas %, recibido %, pagado %, socio %, plataforma %), 0 validadas',
    r->>'desde', r->>'hasta', r->'nominas'->'propuestas', r->'recibido'->'propuestas', r->'pagado'->'propuestas', r->'socio'->'propuestas', r->'plataforma'->'propuestas';
end $$;

-- ── 2 · Encendido: solo la «seguro» sin «Mira esto» ─────────────────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; v_esperadas int;
begin
  update public.company_tax_profile set journal_autovalidate_sales_day = true where company_id = e;
  select count(*) into v_esperadas from public.journal_entry x
   where x.company_id = e and x.source_type = 'sales_day' and x.status = 'propuesto' and x.confidence = 'seguro'
     and x.entry_date >= public.conta_primer_dia_abierto(e, public.conta_hoy() - 120)
     and not exists (select 1 from jsonb_array_elements(coalesce(x.reasons, '[]'::jsonb)) z where z->>'decision' = 'Mira esto');
  r := public.conta_propuestas_de_noche(e);
  if jsonb_array_length(r->'fallos') > 0 then raise exception 'PRUEBA S01 NOCHE · 2: fallos: %', r->'fallos'; end if;
  if (select status from public.journal_entry where id = (select v::uuid from _p where clave = 'seguro')) <> 'validado' then
    raise exception 'PRUEBA S01 NOCHE · 2: la «seguro» no se ha validado: %', r;
  end if;
  if (select validated_by_name from public.journal_entry where id = (select v::uuid from _p where clave = 'seguro')) <> 'Folvy (validación automática de ventas)' then
    raise exception 'PRUEBA S01 NOCHE · 2: la firma no es la de la validación automática.';
  end if;
  if (select status from public.journal_entry where id = (select v::uuid from _p where clave = 'mira')) <> 'propuesto' then
    raise exception 'PRUEBA S01 NOCHE · 2: ha validado una con «Mira esto».';
  end if;
  if exists (select 1 from public.journal_entry where company_id = e and source_type = 'sales_day' and confidence = 'probable' and status = 'validado'
              and validated_by_name = 'Folvy (validación automática de ventas)') then
    raise exception 'PRUEBA S01 NOCHE · 2: ha validado una «probable».';
  end if;
  if (r->>'validadasSolas')::int <> v_esperadas then
    raise exception 'PRUEBA S01 NOCHE · 2: validadas % y se esperaban %', r->>'validadasSolas', v_esperadas;
  end if;
  raise notice '2 · encendido: % validada(s) sola(s), la de «Mira esto» y las «probable», propuestas', r->>'validadasSolas';
end $$;

-- ── 3 · Otra vez: nada nuevo ────────────────────────────────────────────────
do $$
declare e uuid := (select v::uuid from _p where clave = 'empresa'); r jsonb; v_antes int;
begin
  select count(*) into v_antes from public.journal_entry where company_id = e;
  r := public.conta_propuestas_de_noche(e);
  if (r->>'validadasSolas')::int <> 0 or (select count(*) from public.journal_entry where company_id = e) <> v_antes
     or jsonb_array_length(r->'fallos') > 0 then
    raise exception 'PRUEBA S01 NOCHE · 3: la segunda pasada ha hecho algo: %', r;
  end if;
  raise notice '3 · otra vez: nada nuevo (% asientos en la empresa, los mismos)', v_antes;
end $$;

-- ── 4 · Ni de otra cuenta ni sin cuenta ─────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000ff', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_err text;
begin
  begin perform public.conta_propuestas_de_noche((select v::uuid from _p where clave = 'empresa'));
  exception when others then v_err := sqlstate; end;
  if v_err is distinct from '42501' then raise exception 'PRUEBA S01 NOCHE · 4: alguien de otra cuenta la pasa (%).', v_err; end if;
  raise notice '4a · de otra cuenta, no (42501)';
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;
do $$
declare v_err text;
begin
  begin perform public.conta_propuestas_de_noche((select v::uuid from _p where clave = 'empresa'));
  exception when others then v_err := sqlerrm; end;
  if v_err is null then raise exception 'PRUEBA S01 NOCHE · 4: sin cuenta la pasa.'; end if;
  raise notice '4b · sin cuenta, no («%»)', v_err;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 5 · El cron y la guarda de la hora ──────────────────────────────────────
do $$
declare v_sched text;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    select schedule into v_sched from cron.job where jobname = 'conta-propuestas-de-noche';
    if v_sched is distinct from '40 1,2 * * *' then raise exception 'PRUEBA S01 NOCHE · 5: el cron es «%».', v_sched; end if;
    raise notice '5a · el cron: «%» (01:40 y 02:40 UTC)', v_sched;
  else
    raise notice '5a · sin pg_cron en esta base: el cron no se pone (lo dice la migración)';
  end if;
end $$;
-- Fuera de las 3 de Madrid, el procedimiento vuelve sin hacer nada (no confirma
-- nada: se puede llamar dentro de esta transacción). A las 3, no se llama aquí.
select extract(hour from (now() at time zone 'Europe/Madrid')) <> 3 as fuera_de_hora \gset
\if :fuera_de_hora
insert into _p select 'asientos_antes', count(*)::text from public.journal_entry;
call public.conta_propuestas_de_noche_todas();
do $$ begin
  if (select count(*) from public.journal_entry)::text <> (select v from _p where clave = 'asientos_antes') then
    raise exception 'PRUEBA S01 NOCHE · 5: fuera de hora, el procedimiento ha hecho algo.';
  end if;
  raise notice '5b · fuera de las 3 de Madrid, el procedimiento no hace nada';
end $$;
\else
\echo '5b · son las 3 de Madrid: no se llama al procedimiento dentro de la prueba'
\endif

-- ── 6 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261028T1025_s01_pasada_de_noche.down.sql
do $$ begin
  if to_regprocedure('public.conta_propuestas_de_noche(uuid)') is not null
     or exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'conta_propuestas_de_noche_todas')
     or (exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'conta-propuestas-de-noche')) then
    raise exception 'PRUEBA S01 NOCHE · 6: la vuelta atrás deja algo.';
  end if;
  raise notice '6 · la vuelta atrás: no queda nada de la 1025';
end $$;
rollback;
