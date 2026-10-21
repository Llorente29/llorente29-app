-- ============================================================================
-- PRUEBA (staging) · INVENTARIO 0440: anula tres inventarios de seguridad
-- viejos. Todo en una transacción con ROLLBACK.
--
-- Prueba el objeto que la 0440 declara en su cabecera,
-- public.inventario_anulacion_20261021 (la copia), y el fichero ENTERO, con \i,
-- sobre la cuenta A: se le dice qué filas esperar con inventario_0440.esperado,
-- que solo vale en una base sin cuentas de producción.
--
--   0. Siembra: tres inventarios de seguridad de A en «en_revision», contados
--      por la puerta de contar (save_count_line), y un cuarto que no se toca.
--   1. LA GUARDA: con una fila que no está como se midió (otras contadas), el
--      fichero entero para y no anula nada, ni crea la copia.
--   2. EL REAL: anula los tres, con su nota; la copia guarda estado, notas y
--      fecha de antes; ningún movimiento de stock; el cuarto, intacto; la copia
--      cerrada a la API.
--   3. LA VUELTA ATRÁS (\i, la de supabase/produccion/vuelta-atras.txt): los
--      tres vuelven a «en_revision» con sus notas y su fecha, y la copia se va.
-- No cambia ninguna función ni el coste ni el stock: no hay caminos de la
-- regla 10 que ensayar (solo cambia el estado de tres filas).
-- ============================================================================

begin;

select set_config('request.jwt.claims', '', true);
create temp table _hechos (paso text, resultado text) on commit drop;
grant all on _hechos to authenticated;

-- ── 0 · Siembra ────────────────────────────────────────────────────────────
create function pg_temp.articulo(p_id uuid, p_nombre text) returns uuid language sql as $$
  insert into public.recipe_item (id, account_id, type, name, base_unit_id, is_stockable, cost_strategy, fixed_cost)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'raw', p_nombre, 'c1b0a000-0000-4000-8000-000000000104', true, 'fixed', 1.00)
  returning id $$;
create function pg_temp.conteo(p_id uuid) returns uuid language sql as $$
  insert into public.inventory_count (id, account_id, location_id, status, kind, created_at, started_at, notes)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', 'contando', 'audit',
          now() - interval '20 days', now() - interval '20 days', 'nota de antes')
  returning id $$;
create function pg_temp.linea(p_id uuid, p_count uuid, p_item uuid) returns uuid language sql as $$
  insert into public.inventory_count_line (id, account_id, inventory_count_id, recipe_item_id, system_qty)
  values (p_id, 'c01a0000-0000-4000-8000-00000000000a', p_count, p_item, 10)
  returning id $$;
-- Cuenta hasta que la línea queda sellada (un primer número raro pide recontar).
create function pg_temp.contar(p_line uuid, p_qty numeric) returns void language plpgsql as $$
begin
  perform public.save_count_line(p_line, jsonb_build_array(jsonb_build_object('method', 'peso', 'qty', p_qty)), null, null, null);
  if (select counted_qty from public.inventory_count_line where id = p_line) is null then
    perform public.save_count_line(p_line, jsonb_build_array(jsonb_build_object('method', 'peso', 'qty', p_qty)), null, null, null);
  end if;
  if (select counted_qty from public.inventory_count_line where id = p_line) is null then
    raise exception 'PRUEBA 0440: la línea % no ha quedado contada.', p_line;
  end if;
end $$;

do $$
begin
  perform pg_temp.articulo('a7d00000-0000-4000-8000-000000000101', 'Prueba 0440 · uno');
  perform pg_temp.articulo('a7d00000-0000-4000-8000-000000000102', 'Prueba 0440 · dos');
  insert into public.stock_movement (account_id, location_id, recipe_item_id, movement_type, qty_base, unit_cost, cost_provisional, source_type, occurred_at, created_by_name, notes)
  select 'c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', x, 'ajuste', 10, 1.00, false, 'adjustment', now() - interval '30 days', 'prueba', 'prueba 0440'
    from unnest(array['a7d00000-0000-4000-8000-000000000101', 'a7d00000-0000-4000-8000-000000000102']::uuid[]) x;
  -- Tres viejos (2, 1 y 0 contadas) y un cuarto que no está en la lista.
  perform pg_temp.conteo(c) from unnest(array['a7d00000-0000-4000-8000-000000000201', 'a7d00000-0000-4000-8000-000000000202',
                                              'a7d00000-0000-4000-8000-000000000203', 'a7d00000-0000-4000-8000-000000000204']::uuid[]) c;
  perform pg_temp.linea('a7d00000-0000-4000-8000-000000000211', 'a7d00000-0000-4000-8000-000000000201', 'a7d00000-0000-4000-8000-000000000101');
  perform pg_temp.linea('a7d00000-0000-4000-8000-000000000212', 'a7d00000-0000-4000-8000-000000000201', 'a7d00000-0000-4000-8000-000000000102');
  perform pg_temp.linea('a7d00000-0000-4000-8000-000000000221', 'a7d00000-0000-4000-8000-000000000202', 'a7d00000-0000-4000-8000-000000000101');
  perform pg_temp.linea('a7d00000-0000-4000-8000-000000000231', 'a7d00000-0000-4000-8000-000000000203', 'a7d00000-0000-4000-8000-000000000102');
  perform pg_temp.linea('a7d00000-0000-4000-8000-000000000241', 'a7d00000-0000-4000-8000-000000000204', 'a7d00000-0000-4000-8000-000000000101');
end $$;

-- Como el administrador de A: contar es cosa de una persona.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
begin
  perform pg_temp.contar('a7d00000-0000-4000-8000-000000000211', 10);
  perform pg_temp.contar('a7d00000-0000-4000-8000-000000000212', 9);
  perform pg_temp.contar('a7d00000-0000-4000-8000-000000000221', 10);
  perform pg_temp.contar('a7d00000-0000-4000-8000-000000000241', 10);
end $$;
reset role;
select set_config('request.jwt.claims', '', true);

-- Cerrados y sin aprobar, como los de producción.
update public.inventory_count set status = 'en_revision', closed_at = now() - interval '18 days', updated_at = now() - interval '18 days'
 where id in ('a7d00000-0000-4000-8000-000000000201', 'a7d00000-0000-4000-8000-000000000202',
              'a7d00000-0000-4000-8000-000000000203', 'a7d00000-0000-4000-8000-000000000204');
create temp table _antes on commit drop as
  select id, status, notes, updated_at from public.inventory_count
   where id in ('a7d00000-0000-4000-8000-000000000201', 'a7d00000-0000-4000-8000-000000000202',
                'a7d00000-0000-4000-8000-000000000203', 'a7d00000-0000-4000-8000-000000000204');
do $$ begin
  insert into _hechos values ('0 · siembra', '3 de seguridad en en_revision (2, 1 y 0 contadas) y un cuarto fuera de la lista');
end $$;

-- ── 1 · La guarda ──────────────────────────────────────────────────────────
-- Una fila con otras contadas que las medidas (la 202 tiene 1, se le dice 5).
-- El fichero tiene que parar entero: se deja que falle y se vuelve atrás.
\set ON_ERROR_STOP 0
savepoint guarda;
select set_config('inventario_0440.esperado', jsonb_build_array(
  jsonb_build_object('id', 'a7d00000-0000-4000-8000-000000000201', 'code', 'P-201', 'account_id', 'c01a0000-0000-4000-8000-00000000000a', 'status', 'en_revision', 'contadas', 2),
  jsonb_build_object('id', 'a7d00000-0000-4000-8000-000000000202', 'code', 'P-202', 'account_id', 'c01a0000-0000-4000-8000-00000000000a', 'status', 'en_revision', 'contadas', 5),
  jsonb_build_object('id', 'a7d00000-0000-4000-8000-000000000203', 'code', 'P-203', 'account_id', 'c01a0000-0000-4000-8000-00000000000a', 'status', 'en_revision', 'contadas', 0))::text, true);
\i supabase/migrations/20261130T0440_inventario_anula_auditorias_viejas.sql
rollback to savepoint guarda;
\set ON_ERROR_STOP 1
select (:'LAST_ERROR_MESSAGE' like 'inventario 0440: no se anula nada%P-202%') as paro_la_guarda \gset
\if :paro_la_guarda
\else
  do $$ begin raise exception 'PRUEBA 0440 · 1: con una fila que no cuadra, el fichero no ha parado con la guarda.'; end $$;
\endif
do $$
begin
  if to_regclass('public.inventario_anulacion_20261021') is not null then
    raise exception 'PRUEBA 0440 · 1: después de parar, la copia existe.';
  end if;
  if exists (select 1 from public.inventory_count ic join _antes a on a.id = ic.id where ic.status <> a.status) then
    raise exception 'PRUEBA 0440 · 1: después de parar, algún inventario ha cambiado de estado.';
  end if;
  insert into _hechos values ('1 · guarda', 'con una fila que no cuadra para entero: ni anula ni crea la copia');
end $$;

-- ── 2 · El real ────────────────────────────────────────────────────────────
select set_config('inventario_0440.esperado', jsonb_build_array(
  jsonb_build_object('id', 'a7d00000-0000-4000-8000-000000000201', 'code', 'P-201', 'account_id', 'c01a0000-0000-4000-8000-00000000000a', 'status', 'en_revision', 'contadas', 2),
  jsonb_build_object('id', 'a7d00000-0000-4000-8000-000000000202', 'code', 'P-202', 'account_id', 'c01a0000-0000-4000-8000-00000000000a', 'status', 'en_revision', 'contadas', 1),
  jsonb_build_object('id', 'a7d00000-0000-4000-8000-000000000203', 'code', 'P-203', 'account_id', 'c01a0000-0000-4000-8000-00000000000a', 'status', 'en_revision', 'contadas', 0))::text, true);
\i supabase/migrations/20261130T0440_inventario_anula_auditorias_viejas.sql
do $$
declare v_n int;
begin
  select count(*) into v_n from public.inventory_count
   where id in ('a7d00000-0000-4000-8000-000000000201', 'a7d00000-0000-4000-8000-000000000202', 'a7d00000-0000-4000-8000-000000000203')
     and status = 'anulado' and notes like 'nota de antes' || E'\n' || 'Anulado el 21/10/2026 por decisión de Julio%';
  if v_n <> 3 then raise exception 'PRUEBA 0440 · 2: se esperaban 3 anulados con su nota y hay %.', v_n; end if;
  if (select status from public.inventory_count where id = 'a7d00000-0000-4000-8000-000000000204') <> 'en_revision' then
    raise exception 'PRUEBA 0440 · 2: el cuarto, que no estaba en la lista, ha cambiado.';
  end if;
  select count(*) into v_n from public.inventario_anulacion_20261021 c join _antes a on a.id = c.inventory_count_id
   where c.status_antes = a.status and c.notes_antes is not distinct from a.notes and c.updated_at_antes = a.updated_at;
  if v_n <> 3 then raise exception 'PRUEBA 0440 · 2: la copia no guarda lo de antes de los 3 (%).', v_n; end if;
  if exists (select 1 from public.stock_movement where source_type = 'inventory_count'
              and source_id in ('a7d00000-0000-4000-8000-000000000201', 'a7d00000-0000-4000-8000-000000000202', 'a7d00000-0000-4000-8000-000000000203')) then
    raise exception 'PRUEBA 0440 · 2: anular ha escrito movimientos de stock.';
  end if;
  if has_table_privilege('anon', 'public.inventario_anulacion_20261021', 'select')
     or has_table_privilege('authenticated', 'public.inventario_anulacion_20261021', 'select') then
    raise exception 'PRUEBA 0440 · 2: la copia se puede leer desde la API.';
  end if;
  insert into _hechos values ('2 · real', '3 anulados con su nota, la copia con lo de antes y cerrada a la API, 0 movimientos, el cuarto intacto');
end $$;

-- ── 3 · La vuelta atrás ────────────────────────────────────────────────────
\i supabase/vuelta-atras/20261130T0440_inventario_anula_auditorias_viejas.down.sql
do $$
begin
  if exists (select 1 from public.inventory_count ic join _antes a on a.id = ic.id
              where ic.status <> a.status or ic.notes is distinct from a.notes or ic.updated_at <> a.updated_at) then
    raise exception 'PRUEBA 0440 · 3: la vuelta atrás no ha dejado los inventarios como estaban.';
  end if;
  if to_regclass('public.inventario_anulacion_20261021') is not null then
    raise exception 'PRUEBA 0440 · 3: la copia sigue ahí.';
  end if;
  insert into _hechos values ('3 · vuelta atrás', 'los 3 en en_revision con sus notas y su fecha; la copia, fuera');
end $$;

do $$ begin
  raise notice 'PRUEBA 0440 en verde: %', (select string_agg(paso || ' → ' || resultado, ' | ') from _hechos);
end $$;

rollback;
