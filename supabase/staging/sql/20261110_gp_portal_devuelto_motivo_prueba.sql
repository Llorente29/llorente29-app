-- supabase/staging/sql/20261110_gp_portal_devuelto_motivo_prueba.sql
--
-- SOLO STAGING. Prueba de la 1222 (GP · nº 24, punto 6: el motivo del devuelto
-- en el portal). Todo en una transacción con ROLLBACK, con datos inventados
-- (T11): no cambia staging.
--
--   1. Inicio y Pagos traen, en cada devuelto, el motivo que guardó Code 1
--      («Sin saldo en la cuenta»); el que aún no lo tiene, null.
--   2. Lo de antes sigue igual (mes, importe, cuándo se devolvió).
--   3. La vuelta atrás: public._conta_portal_devueltos como estaba (sin motivo).
--
-- sin usuario: sembrar los datos inventados lo hace el servidor; la lectura se prueba como la persona del portal.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA GP-1222: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '120s';
set local lock_timeout = '120s';

select to_regprocedure('public.conta_portal_inicio(uuid)') is null as falta_la_1530 \gset
\if :falta_la_1530
\i supabase/migrations/20261109T1530_gp_portal_base.sql
\endif
-- La columna del motivo es de Code 1 (la 1138, del #591): si esta base aún no la tiene, se pasa antes.
select not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_recibo' and column_name = 'motivo_devolucion') as falta_la_1138 \gset
\if :falta_la_1138
\i supabase/migrations/20261110T1138_g05_motivo_devuelto.sql
\endif
select position('''motivo''' in pg_get_functiondef('public._conta_portal_devueltos(uuid, uuid)'::regprocedure)) > 0 as ya_esta_la_1222 \gset
\if :ya_esta_la_1222
\i supabase/vuelta-atras/20261110T1222_gp_portal_devuelto_motivo.down.sql
\endif
\i supabase/migrations/20261110T1222_gp_portal_devuelto_motivo.sql

-- ── 0 · Un cliente con su acceso y dos recibos devueltos: uno con motivo y otro aún sin él ─
create temp table _g on commit drop as
select c.account_id as cuenta, c.id as empresa, '0000a1a1-0000-4000-8000-000000001222'::uuid as todo_u,
       null::uuid as cliente, null::uuid as con, null::uuid as sin
  from public.company c order by c.created_at limit 1;
do $$
declare g _g; v_cli uuid; r1 uuid; r2 uuid;
begin
  select * into g from _g;
  if g.cuenta is null then raise exception 'PRUEBA GP-1222 · 0: staging no tiene ninguna empresa.'; end if;
  insert into auth.users (id, email) values (g.todo_u, 'todo.1222@ejemplo.invalid');
  insert into public.party (account_id, name, tax_id) values (g.cuenta, 'Cliente Devuelto Prueba, S.L.', 'B00001222') returning id into v_cli;
  insert into public.conta_portal_acceso (account_id, party_id, correo, user_id, permiso) values (g.cuenta, v_cli, 'todo.1222@ejemplo.invalid', g.todo_u, 'todo');
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado, motivo_devolucion)
  values (g.cuenta, g.empresa, v_cli, '2026-01', 'recibo:' || g.empresa || ':' || v_cli || ':2026-01', 18150, 'devuelto', 'Sin saldo en la cuenta') returning id into r1;
  insert into public.conta_recibo (account_id, company_id, party_id, mes, clave, total_cent, estado)
  values (g.cuenta, g.empresa, v_cli, '2026-02', 'recibo:' || g.empresa || ':' || v_cli || ':2026-02', 13310, 'devuelto') returning id into r2;
  insert into public.conta_recibo_evento (recibo_id, account_id, company_id, tipo, texto, cuando) values
    (r1, g.cuenta, g.empresa, 'devuelto', 'Devuelto (prueba GP-1222)', now() - interval '3 days'),
    (r2, g.cuenta, g.empresa, 'devuelto', 'Devuelto (prueba GP-1222)', now() - interval '1 day');
  update _g set cliente = v_cli, con = r1, sin = r2;
end $$;
grant select on _g to authenticated;
select todo_u as todo_u from _g \gset

-- ── 1 y 2 · Como la persona del portal: Inicio y Pagos ─────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', :'todo_u', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare g _g; pantalla text; d jsonb; a jsonb; b jsonb;
begin
  select * into g from _g;
  foreach pantalla in array array['Inicio', 'Pagos'] loop
    d := case pantalla when 'Inicio' then public.conta_portal_inicio(g.cliente) else public.conta_portal_pagos(g.cliente) end -> 'devueltos';
    select x into a from jsonb_array_elements(d) x where x ->> 'recibo_id' = g.con::text;
    select x into b from jsonb_array_elements(d) x where x ->> 'recibo_id' = g.sin::text;
    if a ->> 'motivo' is distinct from 'Sin saldo en la cuenta' or b is null or b ->> 'motivo' is not null then
      raise exception 'PRUEBA GP-1222 · 1: % no trae el motivo de cada devuelto: %', pantalla, d;
    end if;
    if a ->> 'mes' <> '2026-01' or (a ->> 'importe_cent')::int <> 18150 or a ->> 'devuelto_el' is null then
      raise exception 'PRUEBA GP-1222 · 2: % ha perdido algo de lo de antes: %', pantalla, a;
    end if;
  end loop;
  raise notice 'GP-1222 · 1 y 2: Inicio y Pagos traen el motivo («Sin saldo en la cuenta»; el que aún no lo tiene, null) y lo de antes, igual. OK';
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- ── 3 · La vuelta atrás ────────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261110T1222_gp_portal_devuelto_motivo.down.sql
do $$ begin
  if position('''motivo''' in pg_get_functiondef('public._conta_portal_devueltos(uuid, uuid)'::regprocedure)) > 0 then
    raise exception 'PRUEBA GP-1222 · 3: la vuelta atrás no deja public._conta_portal_devueltos como estaba.';
  end if;
  raise notice 'GP-1222 · 3: la vuelta atrás deja public._conta_portal_devueltos como estaba. OK';
end $$;

rollback;
