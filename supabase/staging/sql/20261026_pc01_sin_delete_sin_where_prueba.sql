-- supabase/staging/sql/20261026_pc01_sin_delete_sin_where_prueba.sql
--
-- SOLO STAGING. Prueba de la 0642 (cambia en caliente _conta_liquidacion_cobros,
-- _compras_fin_de_mes y recost_sales_for_product), con \i dentro de la
-- transacción y ROLLBACK: staging no cambia. En la cuenta A (empresa Taberna de
-- Prueba Norte), con un canal y una liquidación inventados.
--
-- La app llama por PostgREST, y el rol authenticator carga safeupdate al
-- conectar. Aquí se carga igual, con «load 'safeupdate'»: a partir de ahí toda
-- la sesión va como la de la app, con cualquier rol (safeupdate mira la
-- sentencia, no quién la lanza).
--
--   0. Lo de antes: la vuelta atrás deja las tres con el md5 de producción (el
--      ensayo pasa la 0642 delante de esta prueba).
--   1. HOY FALLA, como en la app: marcar cobrada una liquidación (su
--      disparador llama a _conta_liquidacion_cobros), el fin de mes de Compras
--      (compras_fin_de_mes) y recalcular un producto (recost_sales_for_product),
--      las dos últimas como el usuario. Las tres con «DELETE requires a WHERE
--      clause».
--   2. Con la 0642, las tres pasan, y la liquidación sale «a revisar» (no tiene
--      pedidos), que es lo que ya hacía sin safeupdate.
--   3. Una sola firma de cada una (regla 2: sin sobrecargas).
--   4. La vuelta atrás: el md5 del principio, y vuelve a fallar igual.

\set ON_ERROR_STOP 1
begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA PC01 SIN WHERE: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';

-- ── 0 · Lo de antes ─────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261026T0642_pc01_sin_delete_sin_where.down.sql

create temp table _s (clave text primary key, v text) on commit drop;
grant select on _s to authenticated;
insert into _s values
  ('cuenta', 'c01a0000-0000-4000-8000-00000000000a'), ('empresa', '3b34403a-a7d6-4a48-a8d7-737e8cababdc'),
  ('usuario', 'c01a0000-0000-4000-8000-0000000000a1');

do $$
declare v_mal text;
begin
  select string_agg(format('%s %s', x.n, coalesce(p.h, 'no está')), ', ') into v_mal
    from (values ('_conta_liquidacion_cobros', '14c4932147645cb4aa3fb67ab686c322'), ('_compras_fin_de_mes', 'dc7b79cf386598cc35bcab45b2b4a965'),
                 ('recost_sales_for_product', 'e117089ed611dcba6ac02c74689a7869')) x(n, esperado)
    left join (select proname, md5(prosrc) h from pg_proc where pronamespace = 'public'::regnamespace) p on p.proname = x.n
   where p.h is distinct from x.esperado;
  if v_mal is not null then raise exception 'PRUEBA PC01 SIN WHERE · 0: no es lo de producción: %.', v_mal; end if;
  raise notice '0 · lo de antes: las tres, con el md5 de producción';
end $$;

-- Siembra, antes de cargar safeupdate: un canal y una liquidación sin cobrar.
do $$
declare a uuid := (select v::uuid from _s where clave = 'cuenta'); c uuid; cs uuid;
begin
  insert into public.sales_channel (account_id, name, slug) values (a, 'Plataforma sin where', 'pc01-sin-where') returning id into c;
  insert into public.channel_settlement (account_id, channel_id, period_from, period_to, net_payout, source, import_key)
  values (a, c, '2026-10-05', '2026-10-11', 20.00, 'manual', 'pc01-sin-where-prueba') returning id into cs;
  insert into _s values ('liq', cs);
  raise notice 'siembra: un canal y una liquidación sin cobrar';
end $$;

-- Desde aquí, la sesión es como la de la app. postgres no es superusuario en
-- Supabase y solo puede cargar lo que está en $libdir/plugins/ («load
-- 'safeupdate'» da «access to library "safeupdate" is not allowed», run 585).
load '$libdir/plugins/safeupdate';

-- Y se comprueba que está cargado: un delete sin where de una temporal para.
create temp table _sw_cargado (a int) on commit drop;
do $$
declare v_msg text;
begin
  begin
    delete from _sw_cargado;
    raise exception using errcode = 'P0001', message = 'pasa';
  exception when others then get stacked diagnostics v_msg = message_text;
  end;
  if v_msg not like '%DELETE requires a WHERE clause%' then
    raise exception 'PRUEBA PC01 SIN WHERE: safeupdate no está cargado (un delete sin where dio: %). Sin él la prueba no mide nada.', v_msg;
  end if;
  raise notice 'safeupdate cargado, como en la app: «%»', v_msg;
end $$;

-- Las tres llamadas, cada una en su subtransacción: devuelve null si pasa, o el
-- error con su código.
create function pg_temp._sw_llamar(p_que text) returns text language plpgsql as $$
declare v_estado text; v_msg text;
begin
  begin
    if p_que = 'cobros' then
      -- Un día más que el cobro que tenga: el disparador solo salta si cambia.
      update public.channel_settlement set collected_on = coalesce(collected_on, date '2026-10-11') + 1, collected_amount = 20.00
       where id = (select v::uuid from _s where clave = 'liq');
    elsif p_que = 'fin_de_mes' then
      perform count(*) from public.compras_fin_de_mes((select v::uuid from _s where clave = 'empresa'), date '2026-10-01');
    elsif p_que = 'recost' then
      perform * from public.recost_sales_for_product((select v::uuid from _s where clave = 'cuenta'), 'Producto sin where', 30, true);
    end if;
    -- Que la llamada no deje nada aunque pase: se deshace aquí mismo.
    raise exception using errcode = 'P0001', message = 'pasa';
  exception when others then
    get stacked diagnostics v_estado = returned_sqlstate, v_msg = message_text;
  end;
  return case when v_msg = 'pasa' then null else v_estado || ' ' || v_msg end;
end $$;
grant execute on function pg_temp._sw_llamar(text) to authenticated;

-- ── 1 · Hoy falla, como en la app ───────────────────────────────────────────
do $$
declare r text;
begin
  r := pg_temp._sw_llamar('cobros');
  if r is null or r not like '%DELETE requires a WHERE clause%' then
    raise exception 'PRUEBA PC01 SIN WHERE · 1: marcar cobrada la liquidación tenía que fallar por safeupdate, y dio: %.', coalesce(r, 'pasa');
  end if;
  raise notice '1 · hoy, marcar cobrada la liquidación (su disparador, _conta_liquidacion_cobros): «%»', r;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r1 text := pg_temp._sw_llamar('fin_de_mes'); r2 text := pg_temp._sw_llamar('recost');
begin
  if r1 is null or r1 not like '%DELETE requires a WHERE clause%' then
    raise exception 'PRUEBA PC01 SIN WHERE · 1: compras_fin_de_mes tenía que fallar por safeupdate, y dio: %.', coalesce(r1, 'pasa');
  end if;
  if r2 is null or r2 not like '%DELETE requires a WHERE clause%' then
    raise exception 'PRUEBA PC01 SIN WHERE · 1: recost_sales_for_product tenía que fallar por safeupdate, y dio: %.', coalesce(r2, 'pasa');
  end if;
  raise notice '1 · hoy, como el usuario: compras_fin_de_mes «%»; recost_sales_for_product «%»', r1, r2;
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 2 · Con la 0642, pasan ──────────────────────────────────────────────────
\i supabase/migrations/20261026T0642_pc01_sin_delete_sin_where.sql

do $$
declare r text; v_estado text;
begin
  r := pg_temp._sw_llamar('cobros');
  if r is not null then raise exception 'PRUEBA PC01 SIN WHERE · 2: marcar cobrada la liquidación sigue fallando: %.', r; end if;
  -- Y ahora de verdad (dentro de la transacción de la prueba), para ver lo que deja.
  update public.channel_settlement set collected_on = date '2026-10-12', collected_amount = 20.00
   where id = (select v::uuid from _s where clave = 'liq');
  select invoice_match_status into v_estado from public.channel_settlement where id = (select v::uuid from _s where clave = 'liq');
  if v_estado is distinct from 'a_revisar' then
    raise exception 'PRUEBA PC01 SIN WHERE · 2: la liquidación sin pedidos tenía que quedar «a_revisar», y quedó %.', coalesce(v_estado, 'sin estado');
  end if;
  raise notice '2 · con la 0642, marcar cobrada la liquidación pasa: queda «%» (no tiene pedidos), como sin safeupdate', v_estado;
end $$;

select set_config('request.jwt.claims', json_build_object('sub', (select v from _s where clave = 'usuario'), 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r1 text := pg_temp._sw_llamar('fin_de_mes'); r2 text := pg_temp._sw_llamar('recost');
begin
  if r1 is not null then raise exception 'PRUEBA PC01 SIN WHERE · 2: compras_fin_de_mes sigue fallando: %.', r1; end if;
  if r2 is not null then raise exception 'PRUEBA PC01 SIN WHERE · 2: recost_sales_for_product sigue fallando: %.', r2; end if;
  raise notice '2 · con la 0642, como el usuario: compras_fin_de_mes y recost_sales_for_product pasan';
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
declare v_mal text; r text;
begin
  select string_agg(format('%s %s', x.n, coalesce(p.h, 'no está')), ', ') into v_mal
    from (values ('_conta_liquidacion_cobros', '14c4932147645cb4aa3fb67ab686c322'), ('_compras_fin_de_mes', 'dc7b79cf386598cc35bcab45b2b4a965'),
                 ('recost_sales_for_product', 'e117089ed611dcba6ac02c74689a7869')) x(n, esperado)
    left join (select proname, md5(prosrc) h from pg_proc where pronamespace = 'public'::regnamespace) p on p.proname = x.n
   where p.h is distinct from x.esperado;
  if v_mal is not null then raise exception 'PRUEBA PC01 SIN WHERE · 4: la vuelta atrás no deja lo de producción: %.', v_mal; end if;
  r := pg_temp._sw_llamar('cobros');
  if r is null or r not like '%DELETE requires a WHERE clause%' then
    raise exception 'PRUEBA PC01 SIN WHERE · 4: con la vuelta atrás, marcar cobrada la liquidación tenía que volver a fallar, y dio: %.', coalesce(r, 'pasa');
  end if;
  raise notice '4 · la vuelta atrás: las tres con el md5 del principio, y vuelve a fallar igual';
end $$;

rollback;
