-- supabase/staging/sql/20261026_pc01_sin_delete_sin_where_prueba.sql
--
-- SOLO STAGING. Prueba de la 0642 (cambia en caliente _conta_liquidacion_cobros,
-- _compras_fin_de_mes y recost_sales_for_product), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la cuenta A (empresa Taberna de
-- Prueba Norte), con un canal y una liquidación inventados.
--
-- LO QUE ESTA PRUEBA NO PUEDE HACER, y es un hallazgo (regla 10): cargar
-- safeupdate. La app llega por PostgREST, que conecta como authenticator, y a
-- ese rol se le precarga al conectar. Una sesión de postgres en Supabase no es
-- superusuario y no lo puede cargar: «load 'safeupdate'» da «access to library
-- "safeupdate" is not allowed» (run 585) y no está en $libdir/plugins (run
-- 586). El fallo CON safeupdate, por el camino de la app, lo reproduce la e2e
-- de Bancos (b01): hoy falla con «bank_casar: DELETE requires a WHERE clause»,
-- y sale en verde cuando la 0642 llegue a staging desde main.
--
-- Lo que sí mide, con la MISMA consulta que encontró las cinco en producción
-- (regla 31: la misma vara a los dos lados):
--   0. Lo de antes: las tres con el md5 de producción, y en ellas las cinco
--      sentencias DELETE sin WHERE (3 + 1 + 1).
--   1. Con la 0642: cero sentencias sin WHERE en las tres, y en toda la base.
--   2. Los caminos siguen haciendo lo mismo (regla 10): marcar cobrada una
--      liquidación sin pedidos (su disparador llama a _conta_liquidacion_cobros)
--      la deja «a_revisar»; compras_fin_de_mes y recost_sales_for_product, como
--      el usuario, responden.
--   3. Una sola firma de cada una (regla 2: sin sobrecargas).
--   4. La vuelta atrás: el md5 del principio, y las cinco otra vez.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 SIN WHERE: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- Las sentencias DELETE o UPDATE sin WHERE de las funciones de public: la
-- consulta que las encontró en producción el 26/10 (sin comentarios ni cadenas,
-- y sin contar el WHERE de una subconsulta). p_nombres null: todas.
create function pg_temp._sw_sin_where(p_nombres text[]) returns table (funcion text, sentencia text) language sql as $f$
  with recursive f as (
    select p.proname::text n, regexp_replace(regexp_replace(regexp_replace(p.prosrc, '--[^\n]*', '', 'g'), '/\*.*?\*/', '', 'g'), '''([^'']|'''')*''', '''_''', 'g') src
      from pg_proc p where p.pronamespace = 'public'::regnamespace and (p_nombres is null or p.proname = any (p_nombres))
  ), s as (
    select n, m[1] st from f, regexp_matches(src, '\m((?:delete\s+from|update)\s[^;]*)', 'gi') m
  ), q(n, st, limpio, i) as (
    select n, st, st, 0 from s where st !~* '^update\s+(set|skip|nowait|of|on|or|to)\M'
    union all
    select n, st, regexp_replace(limpio, '\([^()]*\)', ' ', 'g'), i + 1 from q where i < 12 and limpio ~ '\('
  ), fin as (
    select distinct on (n, st) n, st, limpio from q order by n, st, i desc
  )
  select n, left(regexp_replace(st, '\s+', ' ', 'g'), 120) from fin where limpio !~* '\mwhere\M' and n !~ '^postgis_'
$f$;

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261026T0642_pc01_sin_delete_sin_where.down.sql

create temp table _s (clave text primary key, v text) on commit drop;
grant select on _s to authenticated;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1');

do $$
declare v_mal text; v_n int; v_lista text;
begin
  select string_agg(format('%s %s', x.n, coalesce(p.h, 'no está')), ', ') into v_mal
    from (values ('_conta_liquidacion_cobros', '14c4932147645cb4aa3fb67ab686c322'), ('_compras_fin_de_mes', 'dc7b79cf386598cc35bcab45b2b4a965'),
                 ('recost_sales_for_product', 'e117089ed611dcba6ac02c74689a7869')) x(n, esperado)
    left join (select proname, md5(prosrc) h from pg_proc where pronamespace = 'public'::regnamespace) p on p.proname = x.n
   where p.h is distinct from x.esperado;
  if v_mal is not null then raise exception 'PRUEBA PC01 SIN WHERE · 0: no es lo de producción: %.', v_mal; end if;
  select count(*), string_agg(funcion || ': ' || sentencia, ' · ' order by funcion, sentencia) into v_n, v_lista
    from pg_temp._sw_sin_where(array['_conta_liquidacion_cobros', '_compras_fin_de_mes', 'recost_sales_for_product']);
  if v_n <> 5 then raise exception 'PRUEBA PC01 SIN WHERE · 0: tenían que salir las 5 de producción, y salen % (%).', v_n, v_lista; end if;
  raise notice '0 · lo de antes: las tres con el md5 de producción, y sus 5 sentencias sin WHERE: %', v_lista;
end $$;

-- ── 1 · Con la 0642, ninguna ────────────────────────────────────────────────
\i supabase/migrations/20261026T0642_pc01_sin_delete_sin_where.sql

do $$
declare v_n int; v_todas text;
begin
  select count(*) into v_n from pg_temp._sw_sin_where(array['_conta_liquidacion_cobros', '_compras_fin_de_mes', 'recost_sales_for_product']);
  if v_n <> 0 then raise exception 'PRUEBA PC01 SIN WHERE · 1: con la 0642 aún quedan % sin WHERE.', v_n; end if;
  select string_agg(funcion || ': ' || sentencia, ' · ') into v_todas from pg_temp._sw_sin_where(null);
  if v_todas is not null then raise exception 'PRUEBA PC01 SIN WHERE · 1: en la base quedan sentencias sin WHERE: %.', v_todas; end if;
  raise notice '1 · con la 0642: ninguna sentencia sin WHERE en las tres, ni en ninguna otra función de public';
end $$;

-- ── 2 · Los caminos siguen haciendo lo mismo ────────────────────────────────
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); c uuid; cs uuid; v_estado text;
begin
  insert into public.sales_channel (account_id, name, slug) values (a, 'Plataforma sin where', 'pc01-sin-where') returning id into c;
  insert into public.channel_settlement (account_id, channel_id, period_from, period_to, net_payout, source, import_key)
  values (a, c, '2026-10-05', '2026-10-11', 20.00, 'manual', 'pc01-sin-where-prueba') returning id into cs;
  -- Marcarla cobrada dispara pc01_liquidacion_cobrada → _conta_liquidacion_cobros.
  update public.channel_settlement set collected_on = date '2026-10-12', collected_amount = 20.00 where id = cs;
  select invoice_match_status into v_estado from public.channel_settlement where id = cs;
  if v_estado is distinct from 'a_revisar' then
    raise exception 'PRUEBA PC01 SIN WHERE · 2: la liquidación sin pedidos tenía que quedar «a_revisar», y quedó %.', coalesce(v_estado, 'sin estado');
  end if;
  raise notice '2 · marcar cobrada una liquidación sin pedidos: queda «%», como antes', v_estado;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_fin int; v_recost record;
begin
  select count(*) into v_fin from public.compras_fin_de_mes((select v::uuid from _s where clave = 'empresa'), date '2026-10-01');
  select * into v_recost from public.recost_sales_for_product((select v::uuid from _s where clave = 'cuenta'), 'Producto sin where', 30, true);
  if v_recost.aplicado is distinct from false then raise exception 'PRUEBA PC01 SIN WHERE · 2: recost_sales_for_product en simulación tenía que decir aplicado=false.'; end if;
  raise notice '2 · como el usuario: compras_fin_de_mes responde (% filas); recost_sales_for_product en simulación, % ventas, aplicado %', v_fin, v_recost.ventas_afectadas, v_recost.aplicado;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 3 · Una sola firma de cada una ──────────────────────────────────────────
do $$
declare v_mal text;
begin
  select string_agg(format('%s (%s)', proname, n), ', ') into v_mal from (
    select proname, count(*) n from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('_conta_liquidacion_cobros', '_compras_fin_de_mes', 'recost_sales_for_product') group by proname) x
   where n <> 1;
  if v_mal is not null then raise exception 'PRUEBA PC01 SIN WHERE · 3: sobrecargas: %.', v_mal; end if;
  raise notice '3 · una sola firma de cada una';
end $$;

-- ── 4 · La vuelta atrás ─────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261026T0642_pc01_sin_delete_sin_where.down.sql

do $$
declare v_mal text; v_n int;
begin
  select string_agg(format('%s %s', x.n, coalesce(p.h, 'no está')), ', ') into v_mal
    from (values ('_conta_liquidacion_cobros', '14c4932147645cb4aa3fb67ab686c322'), ('_compras_fin_de_mes', 'dc7b79cf386598cc35bcab45b2b4a965'),
                 ('recost_sales_for_product', 'e117089ed611dcba6ac02c74689a7869')) x(n, esperado)
    left join (select proname, md5(prosrc) h from pg_proc where pronamespace = 'public'::regnamespace) p on p.proname = x.n
   where p.h is distinct from x.esperado;
  if v_mal is not null then raise exception 'PRUEBA PC01 SIN WHERE · 4: la vuelta atrás no deja lo de producción: %.', v_mal; end if;
  select count(*) into v_n from pg_temp._sw_sin_where(array['_conta_liquidacion_cobros', '_compras_fin_de_mes', 'recost_sales_for_product']);
  if v_n <> 5 then raise exception 'PRUEBA PC01 SIN WHERE · 4: con la vuelta atrás tenían que volver las 5, y salen %.', v_n; end if;
  raise notice '4 · la vuelta atrás: las tres con el md5 del principio, y las 5 sentencias sin WHERE otra vez';
end $$;

rollback;
