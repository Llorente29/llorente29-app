-- supabase/staging/sql/20261024_n6_puerta_v1_prueba.sql
--
-- SOLO STAGING. Prueba de 20261024T0714_n6_puerta_v1 (las cinco fuente_*_v1 y
-- sus dos de apoyo), con \i dentro de la transacción y ROLLBACK: staging no
-- cambia. Con datos inventados en la cuenta B de pruebas (una empresa, un local).
--
--   1. Recepciones: una de B con dos líneas (una con IVA del 10 %, otra sin
--      artículo) da su base, su IVA, «iva_completo» falso y sus líneas; y una
--      «no es mercancía» no suma.
--   2. Ventas del día: una venta cerrada a la 01:30 de Madrid es del día
--      anterior (hora de cierre 02:00), con su base, IVA y total.
--   3. Pedidos: la misma venta, con su día en Madrid, y el filtro por canal.
--   4. Productos responde. Las liquidaciones de plataforma y de licencia NO
--      están en la puerta: son de Sumied (Julio, 24/10).
--   5. Importes con dos decimales.
--   6. Como usuario de B: lee lo suyo. Como usuario de A: lo de B le da 42501.
--      anon no puede ejecutarlas; las de apoyo no se ejecutan desde la API.
--   7. Pasarla otra vez no cambia nada, y la vuelta atrás quita sus siete
--      (no toca otras fuente_*, como la de nóminas del N7).

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA N6: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '60s';

\i supabase/migrations/20261024T0714_n6_puerta_v1.sql

do $$
declare
  v_b    constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  v_loc  constant uuid := 'c01b0000-0000-4000-8000-0000000000b2';
  v_sup  constant uuid := 'c01b0000-0000-4000-8000-0000000000b3';
  v_rec  constant uuid := 'cd000000-0000-4000-8000-000000001301';
  v_ri   constant uuid := 'cd000000-0000-4000-8000-000000001302';
  v_sale constant uuid := 'cd000000-0000-4000-8000-000000001303';
  v_e uuid; v_cat uuid; v_unit uuid; v_canal uuid; v_slug text; r record; v_n int; v_antes20 numeric; v_antes21 numeric;
begin
  select id into v_e from public.company where account_id = v_b order by created_at limit 1;
  select category_id into v_cat from public.vat_category_rate where rate = 10 and valid_to is null limit 1;
  select id into v_unit from public.kitchen_unit where account_id = v_b or account_id is null order by is_base desc nulls last limit 1;
  -- Staging no tiene unidades de cocina (medido el 24/10 por la CI: ninguna de B ni global): la prueba pone la suya.
  if v_unit is null then
    insert into public.kitchen_unit (account_id, name, abbreviation, dimension, factor_to_base, is_base)
    values (v_b, 'Kilo de prueba N6', 'kg', 'weight', 1, true) returning id into v_unit;
  end if;
  select id, slug into v_canal, v_slug from public.sales_channel where account_id = v_b order by created_at limit 1;
  if v_e is null or v_cat is null or v_unit is null or v_canal is null then
    raise exception 'PRUEBA N6: la cuenta B no tiene lo que se midió el 24/10 (empresa %, IVA 10 %, canal %).', v_e, v_cat, v_canal;
  end if;
  update public.company_tax_profile set sales_day_close_time = time '02:00' where company_id = v_e;

  -- 1 · Una recepción con dos líneas y una «no es mercancía».
  insert into public.recipe_item (id, account_id, type, name, base_unit_id, vat_category_id)
  values (v_ri, v_b, 'raw', 'Tomate de prueba N6', v_unit, v_cat);
  insert into public.goods_receipt (id, account_id, location_id, supplier_id, supplier_doc_number, receipt_date, status, source)
  values (v_rec, v_b, v_loc, v_sup, 'ALB-N6-1', date '2026-10-20', 'borrador', 'manual');
  insert into public.goods_receipt_line (account_id, goods_receipt_id, recipe_item_id, product_name, qty_received, unit_cost, position)
  values (v_b, v_rec, v_ri, 'Tomate', 10, 2.00, 1),
         (v_b, v_rec, null, 'Algo sin artículo', 1, 5.50, 2);
  insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, unit_cost, position, not_goods, not_goods_kind)
  values (v_b, v_rec, 'Portes', 1, 9.99, 3, true, 'otro');

  select * into r from public.fuente_recepciones_v1(v_e, date '2026-10-20', date '2026-10-20') where recepcion_id = v_rec;
  if r.base is distinct from 25.50 or r.iva is distinct from 2.00 or r.total is distinct from 27.50
     or r.iva_completo is distinct from false or r.albaran <> 'ALB-N6-1' or r.local_id <> v_loc then
    raise exception 'PRUEBA N6 · 1: la recepción no cuadra (base %, iva %, total %, completo %).', r.base, r.iva, r.total, r.iva_completo;
  end if;
  select count(*) into v_n from public.fuente_recepcion_lineas_v1(v_rec);
  if v_n <> 3 then raise exception 'PRUEBA N6 · 1: la recepción da % líneas, no 3.', v_n; end if;
  if (select tipo_iva from public.fuente_recepcion_lineas_v1(v_rec) where articulo_id = v_ri) is distinct from 10 then
    raise exception 'PRUEBA N6 · 1: la línea del tomate no lleva su 10 %%.';
  end if;

  -- 2 · Una venta cerrada a la 01:30 de Madrid del 21/10: es del día 20.
  --     Se mide el total de los dos días antes y después de meterla.
  select coalesce(sum(total), 0) into v_antes20 from public.fuente_ventas_dia_v1(v_e, date '2026-10-20');
  select coalesce(sum(total), 0) into v_antes21 from public.fuente_ventas_dia_v1(v_e, date '2026-10-21');
  perform set_config('folvy.reparto_tal_cual', 'on', true);
  insert into public.sale (id, account_id, location_id, channel_id, sold_at, status, total, taxable_base, tax, source, platform_order_code, is_active)
  values (v_sale, v_b, v_loc, v_canal, (timestamp '2026-10-21 01:30') at time zone 'Europe/Madrid', 'closed', 11.00, 10.00, 1.00, 'manual', 'N6-1', true);
  if (select coalesce(sum(total), 0) from public.fuente_ventas_dia_v1(v_e, date '2026-10-20')) - v_antes20 <> 11.00
     or (select coalesce(sum(total), 0) from public.fuente_ventas_dia_v1(v_e, date '2026-10-21')) - v_antes21 <> 0 then
    raise exception 'PRUEBA N6 · 2: la venta de la 01:30 del 21 no cae en el día 20 (hora de cierre 02:00).';
  end if;
  select * into r from public.fuente_ventas_dia_v1(v_e, date '2026-10-20') where canal_id = v_canal and local_id = v_loc;
  if r.pedidos < 1 or r.base < 10.00 or r.iva < 1.00 then
    raise exception 'PRUEBA N6 · 2: base o IVA del día no cuadran (%).', r;
  end if;

  -- 3 · Pedidos, con su día en Madrid y el filtro por canal.
  select * into r from public.fuente_pedidos_v1(v_e, timestamptz '2026-10-20 00:00Z', timestamptz '2026-10-22 00:00Z') where pedido_id = v_sale;
  if r.dia_madrid is distinct from date '2026-10-21' or r.referencia <> 'N6-1' or r.canal is distinct from v_slug then
    raise exception 'PRUEBA N6 · 3: el pedido no sale como tocaba (%).', r;
  end if;
  if exists (select 1 from public.fuente_pedidos_v1(v_e, timestamptz '2026-10-20 00:00Z', timestamptz '2026-10-22 00:00Z', 'no-existe')) then
    raise exception 'PRUEBA N6 · 3: el filtro por canal no filtra.';
  end if;

  -- 4 · Productos responde; las de liquidaciones no existen.
  if not exists (select 1 from public.fuente_productos_v1(v_e, 'raw') where producto_id = v_ri) then
    raise exception 'PRUEBA N6 · 4: fuente_productos_v1 no da el tomate.';
  end if;
  if to_regprocedure('public.fuente_liquidaciones_plataforma_v1(uuid,date,date)') is not null
     or to_regprocedure('public.fuente_liquidacion_pedidos_v1(uuid)') is not null
     or to_regprocedure('public.fuente_licencias_mes_v1(uuid,date)') is not null then
    raise exception 'PRUEBA N6 · 4: sigue habiendo una fuente de liquidaciones, y son de Sumied.';
  end if;

  -- 5 · Dos decimales.
  if (select scale(base) from public.fuente_recepciones_v1(v_e, date '2026-10-20', date '2026-10-20') where recepcion_id = v_rec) <> 2 then
    raise exception 'PRUEBA N6 · 5: los importes no van con dos decimales.';
  end if;
  raise notice 'N6 · 1-5: recepciones y sus líneas, ventas del día por su cierre, pedidos y productos, con dos decimales; sin fuentes de liquidaciones';
end $$;

-- 6 · Como usuario de B, de A y anónimo.
-- La empresa de B se lee ANTES de cambiar de rol: como usuario de A, la RLS de company no la deja ver.
select set_config('prueba.empresa_b', (select id from public.company where account_id = 'c01b0000-0000-4000-8000-00000000000b' order by created_at limit 1)::text, true);
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := current_setting('prueba.empresa_b')::uuid;
begin
  if not exists (select 1 from public.fuente_recepciones_v1(v_e, date '2026-10-20', date '2026-10-20')) then
    raise exception 'PRUEBA N6 · 6: el usuario de B no lee sus recepciones.';
  end if;
  begin
    perform public.fuente__cuenta(v_e);
    raise exception 'PRUEBA N6 · 6: fuente__cuenta se ejecuta desde la API.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_e uuid := current_setting('prueba.empresa_b')::uuid;
begin
  begin
    perform * from public.fuente_recepciones_v1(v_e, date '2026-10-01', date '2026-10-31');
    raise exception 'PRUEBA N6 · 6: el usuario de A ha leído las recepciones de B.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.fuente_recepcion_lineas_v1('cd000000-0000-4000-8000-000000001301');
    raise exception 'PRUEBA N6 · 6: el usuario de A ha leído las líneas de una recepción de B.';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform * from public.fuente_productos_v1('00000000-0000-0000-0000-000000000000');
    raise exception 'PRUEBA N6 · 6: anon ha ejecutado fuente_productos_v1.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'N6 · 6: B lee lo suyo; A no lee lo de B; anon no ejecuta; las de apoyo no van desde la API';
end $$;
reset role;

-- 7 · Otra vez, y la vuelta atrás.
\i supabase/migrations/20261024T0714_n6_puerta_v1.sql
\i supabase/vuelta-atras/20261024T0714_n6_puerta_v1.down.sql
do $$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace
               and proname in ('fuente__cuenta', 'fuente__locales', 'fuente_recepciones_v1', 'fuente_recepcion_lineas_v1',
                               'fuente_ventas_dia_v1', 'fuente_pedidos_v1', 'fuente_productos_v1')) then
    raise exception 'PRUEBA N6 · 7: la vuelta atrás no ha quitado sus siete.';
  end if;
  raise notice 'PRUEBA N6 en verde: la puerta v1 lee lo de cada empresa y solo eso; se puede pasar dos veces; la vuelta atrás la quita.';
end $$;

rollback;
