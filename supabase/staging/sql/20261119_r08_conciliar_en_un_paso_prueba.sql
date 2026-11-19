-- supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
--
-- SOLO STAGING. R08 · Bancos: conciliar en un paso, por sus CAMINOS (regla 10), en una
-- transacción que acaba en ROLLBACK: staging no cambia.
--   1945 · el saldo del banco es el cierre del último extracto de la cadena (varios el mismo
--          día: el último que llegó) y el de Sumied cuenta solo lo que está en el diario;
--          y su vuelta atrás.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA R08: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

\i supabase/migrations/20261119T1945_r08_saldo_del_banco.sql
\i supabase/migrations/20261119T1945_r08_saldo_del_banco.sql

create temp table _p (k text primary key, v text) on commit drop;
grant all on _p to authenticated;
create function pg_temp.p(k text) returns text language sql as $$ select v from _p where _p.k = $1 $$;

-- La persona de la cuenta del núcleo (semilla K02), con un banco propio (semilla E05).
select set_config('request.jwt.claims', json_build_object('sub', 'c0e20000-0000-4000-8000-0000000000e1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb;
begin
  r := public.e2e_e05_preparar('r08', '2026-11-12.1');
  insert into _p values ('e', r->>'empresa'), ('banco', r->>'banco'), ('c572', r->>'cuenta572');
end $$;
reset role;

-- 1 · Tres extractos el mismo día, que llegan uno detrás de otro: el saldo es el del último.
do $$
declare b uuid := pg_temp.p('banco')::uuid; x record;
begin
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
                                     opening_balance, closing_balance, movements_count, new_count, repeated_count, balanced, continuity, imported_at)
  select t.account_id, t.company_id, t.id, 'agregador:prueba', 'agregador:prueba', 'Prueba R08 · ' || n, date '2026-11-19', date '2026-11-19',
         100, 100 + n, 0, 0, 0, true, 'sigue', timestamptz '2026-11-19 08:00:00+01' + make_interval(hours => n)
    from public.treasury_account t cross join generate_series(1, 3) n where t.id = b;
  select * into x from public.bank_saldo_extracto(b, date '2026-11-30');
  if x.saldo <> 103 then raise exception 'PRUEBA R08 · 1: el saldo del banco sale % y es el del último que llegó, 103.', x.saldo; end if;
  raise notice '1 OK: tres extractos el 19/11; el saldo es el del último que llegó, % (llegó a las %).', x.saldo, to_char(x.llego at time zone 'Europe/Madrid', 'HH24:MI');
end $$;

\i supabase/vuelta-atras/20261119T1945_r08_saldo_del_banco.down.sql
do $$ begin
  if to_regprocedure('public.bank_saldo_extracto(uuid, date)') is not null or to_regprocedure('public.bank_saldo_diario(uuid, date, text)') is not null then
    raise exception 'PRUEBA R08 · vuelta atrás: no quita las funciones.';
  end if;
  raise notice 'Vuelta atrás de 1945 OK.';
end $$;

do $$ begin raise notice 'PRUEBA R08: todo bien.'; end $$;
rollback;
