-- supabase/staging/sql/20261115_sp_traspaso_mes_en_curso_prueba.sql
--
-- SOLO STAGING. Prueba de la 1954 (SP: traspasar a Diez el mes en curso), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la cuenta A, como su administrador.
--
--   1. Sin la 1954 (quitada con su vuelta atrás si el workflow ya la pasó): confirmar el mes en curso
--      falla con «El mes aún no ha terminado», como hoy en Foodint con noviembre.
--   2. Con la 1954: el mes en curso se confirma; el mes que viene, no («aún no ha empezado»).
--   3. Terminar el traspaso del mes en curso, con todo llegado y cuadrando, NO cierra el mes en Sumied y lo dice.
--   4. Un mes ya terminado sigue como antes: su motivo no es el del mes en curso.
--   5. La vuelta atrás: las dos funciones exactamente como estaban (misma huella).
--
-- Nombra lo que toca, para el analizador: conta_traspaso_confirmar, conta_traspaso_terminar,
-- conta_diez_traspaso, fiscal_period_lock, fiscal_year.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA SP: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '30s';
select set_config('request.jwt.claims', '{"sub":"c01a0000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);
select set_config('folvy.cuenta_activa', 'c01a0000-0000-4000-8000-00000000000a', true);

select strpos(pg_get_functiondef('public.conta_traspaso_confirmar(uuid,date)'::regprocedure), 'SP·traspaso (15/11)') > 0 as ya_esta \gset
\if :ya_esta
\i supabase/vuelta-atras/20261115T1954_sp_traspaso_mes_en_curso.down.sql
\endif

-- La empresa de A, su ejercicio abierto y ningún traspaso ni cierre de los meses de la prueba.
create temp table _p (clave text primary key, v uuid, t text) on commit drop;
grant select, insert on _p to authenticated;
do $$
declare v_acc constant uuid := 'c01a0000-0000-4000-8000-00000000000a'; c uuid; y uuid;
  v_mes date := date_trunc('month', (now() at time zone 'Europe/Madrid'))::date;
begin
  select id into c from public.company where account_id = v_acc order by created_at, id limit 1;
  if c is null then raise exception 'PRUEBA SP: a la cuenta A le falta la empresa.'; end if;
  select id into y from public.fiscal_year where company_id = c and v_mes between starts_on and ends_on;
  if y is null then
    insert into public.fiscal_year (account_id, company_id, code, starts_on, ends_on)
    values (v_acc, c, to_char(v_mes, 'YYYY'), date_trunc('year', v_mes)::date, (date_trunc('year', v_mes) + interval '1 year - 1 day')::date) returning id into y;
  end if;
  update public.fiscal_year set status = 'open' where id = y;
  delete from public.conta_diez_traspaso where company_id = c and mes in (v_mes, (v_mes - interval '1 month')::date, (v_mes + interval '1 month')::date);
  delete from public.fiscal_period_lock where company_id = c and month in (v_mes, (v_mes + interval '1 month')::date);
  insert into _p values ('empresa', c, null), ('mes', null, v_mes::text),
    ('huella_confirmar', null, md5(pg_get_functiondef('public.conta_traspaso_confirmar(uuid,date)'::regprocedure))),
    ('huella_terminar', null, md5(pg_get_functiondef('public.conta_traspaso_terminar(uuid,jsonb,boolean)'::regprocedure)));
end $$;

-- 1. Sin la 1954: el mes en curso no se confirma, como hoy.
set local role authenticated;
do $$ begin
  begin
    perform public.conta_traspaso_confirmar((select v from _p where clave = 'empresa'), (select t from _p where clave = 'mes')::date);
    raise exception 'PRUEBA SP · 1: sin la 1954 se deja confirmar el mes en curso: esta prueba no ve el caso de Foodint.';
  exception when sqlstate '23514' then
    if sqlerrm not like 'El mes aún no ha terminado%' then raise; end if;
    raise notice '1 · sin la 1954, falla como hoy: «%»', sqlerrm;
  end;
end $$;
reset role;
\i supabase/migrations/20261115T1954_sp_traspaso_mes_en_curso.sql

-- 2. Con la 1954: el mes en curso se confirma; el que viene, no.
set local role authenticated;
do $$
declare r jsonb; c uuid := (select v from _p where clave = 'empresa'); m date := (select t from _p where clave = 'mes')::date;
begin
  r := public.conta_traspaso_confirmar(c, m);
  if r->>'id' is null then raise exception 'PRUEBA SP · 2: el mes en curso no se ha confirmado (%).', r; end if;
  insert into _p values ('traspaso', (r->>'id')::uuid, null);
  raise notice '2 · el mes en curso se confirma: %', r;
  begin
    perform public.conta_traspaso_confirmar(c, (m + interval '1 month')::date);
    raise exception 'PRUEBA SP · 2: se deja confirmar el mes que viene.';
  exception when sqlstate '23514' then
    if sqlerrm not like 'Ese mes aún no ha empezado%' then raise; end if;
    raise notice '2 · el mes que viene, no: «%»', sqlerrm;
  end;
end $$;
reset role;

-- 3. Terminar el mes en curso, con todo llegado y cuadrando: no se cierra, y lo dice.
do $$
declare r jsonb; c uuid := (select v from _p where clave = 'empresa'); m date := (select t from _p where clave = 'mes')::date;
begin
  r := public.conta_traspaso_terminar((select v from _p where clave = 'traspaso'), '{}'::jsonb, true);
  if (r->>'mes_cerrado')::boolean then raise exception 'PRUEBA SP · 3: ha cerrado el mes en curso.'; end if;
  if r->>'motivo' not like 'No se cierra el mes: aún no ha terminado%' then raise exception 'PRUEBA SP · 3: el motivo es «%».', r->>'motivo'; end if;
  if exists (select 1 from public.fiscal_period_lock where company_id = c and month = m and reopened_at is null) then
    raise exception 'PRUEBA SP · 3: hay cierre del mes en curso.';
  end if;
  if (select estado from public.conta_diez_traspaso where id = (select v from _p where clave = 'traspaso')) <> 'terminado' then
    raise exception 'PRUEBA SP · 3: el traspaso no queda terminado.';
  end if;
  raise notice '3 · el mes en curso queda traspasado y abierto: «%»', r->>'motivo';
end $$;

-- 4. Un mes ya terminado sigue como antes: su motivo no es el del mes en curso.
do $$
declare r jsonb; c uuid := (select v from _p where clave = 'empresa'); m date := ((select t from _p where clave = 'mes')::date - interval '1 month')::date; i uuid;
begin
  insert into public.conta_diez_traspaso (account_id, company_id, mes, estado, confirmado_por, confirmado_por_nombre, confirmado_en, van)
  values ('c01a0000-0000-4000-8000-00000000000a', c, m, 'traspasando', 'c01a0000-0000-4000-8000-0000000000a1', 'prueba SP', now(), 0) returning id into i;
  r := public.conta_traspaso_terminar(i, '{}'::jsonb, true);
  if coalesce(r->>'motivo', '') like '%aún no ha terminado%' then raise exception 'PRUEBA SP · 4: el mes pasado se trata como en curso.'; end if;
  raise notice '4 · el mes pasado, como siempre: cerrado % · %', r->>'mes_cerrado', coalesce(r->>'motivo', '(sin motivo)');
end $$;

-- 5. La vuelta atrás: las dos como estaban.
\i supabase/vuelta-atras/20261115T1954_sp_traspaso_mes_en_curso.down.sql
do $$ begin
  if md5(pg_get_functiondef('public.conta_traspaso_confirmar(uuid,date)'::regprocedure)) <> (select t from _p where clave = 'huella_confirmar')
     or md5(pg_get_functiondef('public.conta_traspaso_terminar(uuid,jsonb,boolean)'::regprocedure)) <> (select t from _p where clave = 'huella_terminar') then
    raise exception 'PRUEBA SP · 5: la vuelta atrás no deja las funciones como estaban.';
  end if;
  raise notice '5 · la vuelta atrás deja las dos funciones como estaban (misma huella)';
end $$;

rollback;
