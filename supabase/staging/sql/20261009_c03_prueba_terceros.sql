-- ============================================================================
-- C03 · Prueba en staging-conta de las migraciones 0100–0150 (terceros,
-- liquidaciones, periodos propuestos, funciones, lectura). Todo dentro de una
-- transacción que acaba en ROLLBACK: no queda nada.
--
--   0. Liquidaciones de prueba en la cuenta A: con periodo, sin periodo con
--      pedidos y sin periodo sin pedidos; y dos de la cesión «de antes».
--   1. Vuelta atrás de las seis (0150 → 0100) y FOTO DE ANTES: huella de
--      supplier, channel_settlement, licensed_settlement y
--      brand_licensing_agreement, y lo que devuelven las seis funciones de
--      Ventas que las leen.
--   2. Se vuelven a aplicar (\ir) y FOTO DE DESPUÉS con la MISMA vara (las
--      columnas de antes): tiene que salir idéntica (regla 31).
--   3. Cada proveedor con su tercero; un NIF, un tercero; los periodos
--      propuestos donde hay pedidos y solo ahí; las de la cesión «anterior», y
--      una carga nueva a la manera de antes sigue entrando (y queda «anterior»).
--   4. El disparador de alta: proveedor nuevo con el NIF de un cliente → el
--      mismo tercero; dos proveedores con el mismo NIF → el segundo, aparte.
--   5. Como el administrador de A: alta de cliente con el NIF de un proveedor
--      (para y lo dice), añadirle el papel; plataforma con su canal; cobro con
--      diferencia; confirmar el periodo propuesto; archivar y recuperar.
--   6. El socio de marca por local: calcular, una línea sin precio no cierra,
--      preparar, confirmar, no se rehace.
--   7. Como el administrador de B: no ve nada de A ni lo toca.
--   8. Un cliente de otra cuenta no se enlaza a una cuenta de A.
-- ============================================================================
begin;

\set a '''c01a0000-0000-4000-8000-00000000000a'''
\set b '''c01b0000-0000-4000-8000-00000000000b'''
\set l1 '''c01a0000-0000-4000-8000-0000000000a2'''
\set l2 '''e0200000-0000-4000-8000-0000000000a3'''
\set uber '''e0200000-0000-4000-8000-00000000a0c2'''

-- ── 0 · Datos de prueba ─────────────────────────────────────────────────────
insert into public.channel_settlement (id, account_id, channel_id, location_id, settlement_ref, period_from, period_to, settlement_date,
                                       period_grain, gross_sales, commission, net_payout, source, import_key)
values ('c03e0000-0000-4000-8000-000000000001', :a, :uber, :l1, 'PRUEBA-1', '2026-09-01', '2026-09-30', '2026-10-03', 'mes', 1000, 300, 700, 'import_csv_uber', 'prueba-c03-1'),
       ('c03e0000-0000-4000-8000-000000000002', :a, :uber, :l1, 'PRUEBA-2', null, null, '2026-09-20', 'quincena', 500, 150, 350, 'import_csv_glovo', 'prueba-c03-2'),
       ('c03e0000-0000-4000-8000-000000000003', :a, :uber, :l1, 'PRUEBA-3', null, null, '2026-09-05', 'quincena', 400, 120, null, 'import_csv_je', 'prueba-c03-3');
insert into public.channel_settlement_order (account_id, channel_id, location_id, settlement_id, settlement_ref, platform_order_code, order_date, products, import_key)
values (:a, :uber, :l1, 'c03e0000-0000-4000-8000-000000000002', 'PRUEBA-2', 'P1', '2026-09-03', 20, 'prueba-c03-o1'),
       (:a, :uber, :l1, 'c03e0000-0000-4000-8000-000000000002', 'PRUEBA-2', 'P2', '2026-09-14', 25, 'prueba-c03-o2'),
       (:a, :uber, :l1, 'c03e0000-0000-4000-8000-000000000002', 'PRUEBA-2', 'P3', '2026-09-08', 30, 'prueba-c03-o3');
insert into public.licensed_settlement (account_id, location_id, period_from, period_to, service_revenue, materials_supplied, net_settlement, import_key)
values (:a, :l1, '2026-06-01', '2026-06-30', 1000, 200, 800, 'prueba-c03-ls1'),
       (:a, :l2, '2026-06-01', '2026-06-30', 900, 150, 750, 'prueba-c03-ls2');

-- ── 1 · Vuelta atrás de las seis y foto de antes ────────────────────────────
\echo '>>> 1. Vuelta atrás (0150 → 0100)'
\ir ../../vuelta-atras/20261009T0150_c03_lectura.down.sql
\ir ../../vuelta-atras/20261009T0140_c03_funciones.down.sql
\ir ../../vuelta-atras/20261009T0130_c03_periodos_propuestos.down.sql
\ir ../../vuelta-atras/20261009T0120_c03_liquidaciones.down.sql
\ir ../../vuelta-atras/20261009T0110_c03_terceros_datos.down.sql
\ir ../../vuelta-atras/20261009T0100_c03_terceros.down.sql
do $$ begin
  if to_regclass('public.party') is not null then raise exception 'PRUEBA C03 · 1: la vuelta atrás no quita party.'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'channel_settlement' and column_name = 'collected_amount') then
    raise exception 'PRUEBA C03 · 1: la vuelta atrás no quita las columnas de channel_settlement.';
  end if;
  raise notice 'PRUEBA C03 · 1 en verde (vuelta atrás)';
end $$;

create temp table foto (que text primary key, antes text, despues text) on commit drop;
insert into foto (que, antes)
select 'supplier', md5(coalesce(string_agg(to_jsonb(s)::text, '|' order by s.id), '')) from public.supplier s
union all select 'channel_settlement', md5(coalesce(string_agg(to_jsonb(c)::text, '|' order by c.id), '')) from public.channel_settlement c
union all select 'licensed_settlement', md5(coalesce(string_agg(to_jsonb(l)::text, '|' order by l.id), '')) from public.licensed_settlement l
union all select 'brand_licensing_agreement', md5(coalesce(string_agg(to_jsonb(x)::text, '|' order by x.id), '')) from public.brand_licensing_agreement x;

-- Lo que devuelven las funciones de Ventas, como las llama la pantalla (con la sesión del administrador de A).
create or replace function pg_temp.lecturas_ventas() returns table (que text, valor text) language plpgsql as $$
declare
  a uuid := 'c01a0000-0000-4000-8000-00000000000a';
  f record; r text;
begin
  for f in select * from (values
      ('channel_economics_dashboard', 'select public.channel_economics_dashboard($1, ''2026-01-01''::date, ''2026-12-31''::date, null, null, null)::text'),
      ('channel_pnl_by_brand',        'select public.channel_pnl_by_brand($1, ''2026-01-01''::date, ''2026-12-31''::date)::text'),
      ('licensed_economics_dashboard','select public.licensed_economics_dashboard($1, ''2026-01-01''::timestamptz, ''2027-01-01''::timestamptz, null)::text'),
      ('channel_trend_monthly',       'select public.channel_trend_monthly($1, null, null, null)::text'),
      ('margin_by_brand',             'select public.margin_by_brand($1, ''2026-01-01''::timestamptz, ''2027-01-01''::timestamptz, null)::text')) v(n, q) loop
    begin
      execute f.q into r using a;
    exception when others then r := 'ERROR ' || sqlstate || ' ' || sqlerrm;
    end;
    que := f.n; valor := md5(coalesce(r, '∅')); return next;
  end loop;
end $$;

-- Con la sesión del administrador de A (auth.uid()), sin cambiar de rol: la foto es una tabla temporal.
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
insert into foto (que, antes) select 'ventas · ' || que, valor from pg_temp.lecturas_ventas();

-- ── 2 · Se vuelven a aplicar, y foto de después con la misma vara ───────────
\echo '>>> 2. Se vuelven a aplicar (0100 → 0150)'
\ir ../../migrations/20261009T0100_c03_terceros.sql
\ir ../../migrations/20261009T0110_c03_terceros_datos.sql
\ir ../../migrations/20261009T0120_c03_liquidaciones.sql
\ir ../../migrations/20261009T0130_c03_periodos_propuestos.sql
\ir ../../migrations/20261009T0140_c03_funciones.sql
\ir ../../migrations/20261009T0150_c03_lectura.sql

update foto set despues = x.h from (
  select 'supplier' que, md5(coalesce(string_agg(to_jsonb(s)::text, '|' order by s.id), '')) h from public.supplier s
  union all select 'channel_settlement', md5(coalesce(string_agg((to_jsonb(c) - array['party_id', 'collected_on', 'collected_amount', 'collection_note',
         'collected_by', 'collected_by_name', 'proposed_period_from', 'proposed_period_to', 'proposed_period_note', 'period_confirmed_at',
         'period_confirmed_by'])::text, '|' order by c.id), '')) from public.channel_settlement c
  union all select 'licensed_settlement', md5(coalesce(string_agg((to_jsonb(l) - array['formula', 'party_id', 'status', 'purchases_amount',
         'contributions_amount', 'brand_sales_base', 'commission_pct', 'commission_amount', 'amount', 'detail', 'updated_at', 'created_by',
         'created_by_name', 'confirmed_at', 'confirmed_by', 'confirmed_by_name'])::text, '|' order by l.id), '')) from public.licensed_settlement l
  union all select 'brand_licensing_agreement', md5(coalesce(string_agg((to_jsonb(x) - array['party_id', 'commission_base'])::text, '|' order by x.id), ''))
    from public.brand_licensing_agreement x) x
 where foto.que = x.que;

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
update foto set despues = v.valor from pg_temp.lecturas_ventas() v where foto.que = 'ventas · ' || v.que;

do $$
declare r record; n int := 0;
begin
  for r in select * from foto order by que loop
    raise notice 'PRUEBA C03 · 2 · % · antes % · después %', r.que, r.antes, r.despues;
    if r.antes is distinct from r.despues then raise exception 'PRUEBA C03 · 2: % no es igual antes y después.', r.que; end if;
    n := n + 1;
  end loop;
  if n <> 9 then raise exception 'PRUEBA C03 · 2: esperaba 9 medidas y hay %.', n; end if;
  raise notice 'PRUEBA C03 · 2 en verde: las 9 medidas, iguales antes y después';
end $$;

-- ── 3 · Lo que dejan las migraciones ────────────────────────────────────────
do $$
declare v record;
begin
  if exists (select 1 from public.supplier s where not exists (select 1 from public.party_role r where r.supplier_id = s.id)) then
    raise exception 'PRUEBA C03 · 3: hay proveedores sin tercero.';
  end if;
  if exists (select 1 from public.party_role r join public.supplier s on s.id = r.supplier_id join public.party p on p.id = r.party_id
              where p.account_id <> s.account_id or p.name <> s.name or p.tax_id is distinct from public.party_nif(s.tax_id)
                 or p.archived_at is distinct from s.archived_at) then
    raise exception 'PRUEBA C03 · 3: algún tercero no es la copia de su proveedor (cuenta, nombre, NIF o archivado).';
  end if;
  select * into v from public.channel_settlement where id = 'c03e0000-0000-4000-8000-000000000002';
  if v.proposed_period_from <> '2026-09-03' or v.proposed_period_to <> '2026-09-14' or v.period_from is not null
     or v.proposed_period_note not like 'Del 03/09/2026 al 14/09/2026: el primer y el último de sus 3 pedidos.%' then
    raise exception 'PRUEBA C03 · 3: el periodo propuesto no sale de sus pedidos: % / % / %', v.proposed_period_from, v.proposed_period_to, v.proposed_period_note;
  end if;
  if (select proposed_period_from from public.channel_settlement where id = 'c03e0000-0000-4000-8000-000000000003') is not null then
    raise exception 'PRUEBA C03 · 3: se ha inventado un periodo sin pedidos.';
  end if;
  if (select proposed_period_from from public.channel_settlement where id = 'c03e0000-0000-4000-8000-000000000001') is not null then
    raise exception 'PRUEBA C03 · 3: se ha propuesto periodo a una que ya lo tenía.';
  end if;
  if exists (select 1 from public.licensed_settlement where formula <> 'anterior') then
    raise exception 'PRUEBA C03 · 3: las liquidaciones de la cesión de antes no quedan como «anterior».';
  end if;
  -- El camino de quien escribe a la manera de antes (la carga de CTB): sigue funcionando y queda «anterior».
  insert into public.licensed_settlement (account_id, location_id, period_from, period_to, service_revenue, net_settlement, import_key)
  values ('c01a0000-0000-4000-8000-00000000000a', 'c01a0000-0000-4000-8000-0000000000a2', '2026-07-01', '2026-07-31', 1, 1, 'prueba-c03-ls3');
  if (select formula from public.licensed_settlement where import_key = 'prueba-c03-ls3') <> 'anterior' then
    raise exception 'PRUEBA C03 · 3: una carga a la manera de antes no queda como «anterior».';
  end if;
  raise notice 'PRUEBA C03 · 3 en verde';
end $$;

-- ── 4 · El disparador de alta del proveedor ─────────────────────────────────
do $$
declare v_cli uuid; v_p1 uuid; v_p2 uuid;
begin
  insert into public.party (account_id, name, tax_id) values ('c01a0000-0000-4000-8000-00000000000a', 'Cliente que vende', 'B91030056') returning id into v_cli;
  insert into public.supplier (id, account_id, name, tax_id) values ('c03e0000-0000-4000-8000-000000000101', 'c01a0000-0000-4000-8000-00000000000a', 'Cliente que vende', 'b-91030056');
  if (select party_id from public.party_role where supplier_id = 'c03e0000-0000-4000-8000-000000000101') <> v_cli then
    raise exception 'PRUEBA C03 · 4: un proveedor nuevo con el NIF de un cliente no se cuelga de su tercero.';
  end if;
  insert into public.supplier (id, account_id, name, tax_id) values ('c03e0000-0000-4000-8000-000000000102', 'c01a0000-0000-4000-8000-00000000000a', 'Repetido', 'B91030056');
  select party_id into v_p2 from public.party_role where supplier_id = 'c03e0000-0000-4000-8000-000000000102';
  if v_p2 is null or v_p2 = v_cli or (select tax_id from public.party where id = v_p2) is not null then
    raise exception 'PRUEBA C03 · 4: el segundo proveedor con el mismo NIF no va a un tercero aparte y sin NIF.';
  end if;
  update public.supplier set name = 'Repetido y renombrado' where id = 'c03e0000-0000-4000-8000-000000000102';
  if (select name from public.party where id = v_p2) <> 'Repetido y renombrado' then
    raise exception 'PRUEBA C03 · 4: el tercero de un proveedor no sigue su nombre.';
  end if;
  raise notice 'PRUEBA C03 · 4 en verde';
end $$;

-- ── 5 · Como el administrador de A ──────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_prov uuid; r jsonb; v_estado text; v_canal uuid := 'e0200000-0000-4000-8000-00000000a0c2';
begin
  select r.party_id into v_prov from public.party_role r where r.supplier_id = 'c01a0000-0000-4000-8000-0000000000a3';
  -- Alta de cliente con el NIF de un proveedor: para y dice quién es.
  begin
    perform public.party_save_customer('c01a0000-0000-4000-8000-00000000000a', null, 'Otro nombre', 'B91000018', '{}'::jsonb, 'Prueba');
    raise exception 'PRUEBA C03 · 5: deja dar de alta otro tercero con el NIF de un proveedor.';
  exception when unique_violation then
    if sqlerrm not like 'MISMO_NIF ' || v_prov || ': Hermanos Ruiz ya tiene el NIF B91000018.' then raise exception 'PRUEBA C03 · 5: no dice quién: %', sqlerrm; end if;
  end;
  -- Añadirle el papel de cliente, con sus datos.
  perform public.party_add_role(v_prov, 'customer', '{}'::jsonb);
  r := public.party_save_customer('c01a0000-0000-4000-8000-00000000000a', v_prov, 'Hermanos Ruiz', 'B91000018',
         '{"legalName": "Hermanos Ruiz, S.L.", "paymentTermsDays": 75, "exclude347": false}'::jsonb, 'Prueba');
  if (r->>'nuevo')::boolean or (select count(*) from public.party_role where party_id = v_prov) <> 2
     or (select payment_terms_days from public.customer_fiscal where party_id = v_prov) <> 75 then
    raise exception 'PRUEBA C03 · 5: el papel de cliente no queda en el mismo tercero con sus datos.';
  end if;
  -- 347 excluido sin motivo: no.
  begin
    perform public.party_save_customer('c01a0000-0000-4000-8000-00000000000a', v_prov, 'Hermanos Ruiz', 'B91000018', '{"exclude347": true}'::jsonb, 'Prueba');
    raise exception 'PRUEBA C03 · 5: deja excluir del 347 sin motivo.';
  exception when check_violation then null;
  end;
  -- Plataforma con su canal: sus liquidaciones de ese canal, enlazadas.
  r := public.party_add_role(v_prov, 'platform', jsonb_build_object('channelId', v_canal, 'settlementEvery', 'fortnightly', 'commissionPct', 30));
  if (r->>'liquidaciones_enlazadas')::int <> 3 then raise exception 'PRUEBA C03 · 5: enlaza % liquidaciones y son 3.', r->>'liquidaciones_enlazadas'; end if;
  -- Cobro con diferencia: se apunta tal cual y se dice.
  r := public.channel_settlement_collect('c03e0000-0000-4000-8000-000000000001', '2026-10-03', 487.70, null, 'Prueba');
  if (r->>'diferencia')::numeric <> -212.30 then raise exception 'PRUEBA C03 · 5: la diferencia sale % y es -212,30.', r->>'diferencia'; end if;
  -- El periodo propuesto, confirmado: pasa a period_from/to.
  perform public.channel_settlement_confirm_period('c03e0000-0000-4000-8000-000000000002');
  if (select period_from from public.channel_settlement where id = 'c03e0000-0000-4000-8000-000000000002') <> '2026-09-03' then
    raise exception 'PRUEBA C03 · 5: confirmar no copia el periodo.';
  end if;
  -- Archivar y recuperar, con su proveedor.
  perform public.party_set_archived(v_prov, true, 'histórico de 2024');
  if (select archived_at from public.supplier where id = 'c01a0000-0000-4000-8000-0000000000a3') is null then
    raise exception 'PRUEBA C03 · 5: archivar el tercero no archiva su proveedor.';
  end if;
  perform public.party_set_archived(v_prov, false);
  if (select archived_at from public.party where id = v_prov) is not null or (select archived_at from public.supplier where id = 'c01a0000-0000-4000-8000-0000000000a3') is not null then
    raise exception 'PRUEBA C03 · 5: recuperar no lo devuelve.';
  end if;
  raise notice 'PRUEBA C03 · 5 en verde';
end $$;
reset role;

-- ── 6 · El socio de marca, por local ────────────────────────────────────────
-- Datos: socio (con su proveedor Bebidas Sol), una marca con acuerdo al 10 %,
-- en Norte Centro: 2 albaranes (600 + 400), una aportación de 150 y ventas
-- sin IVA por 2.000 → 600 + 400 − 150 + 200 = 1.050. En Norte Mercado, nada.
insert into public.brand (id, account_id, name, slug, ownership_type) values ('c03e0000-0000-4000-8000-000000000201', :a, 'Marca de prueba C03', 'marca-prueba-c03', 'licensed');
insert into public.goods_receipt (id, account_id, location_id, supplier_id, receipt_date, status)
values ('c03e0000-0000-4000-8000-000000000211', :a, :l1, 'c01a0000-0000-4000-8000-0000000000a4', '2026-08-03', 'confirmado'),
       ('c03e0000-0000-4000-8000-000000000212', :a, :l1, 'c01a0000-0000-4000-8000-0000000000a4', '2026-08-20', 'confirmado'),
       ('c03e0000-0000-4000-8000-000000000213', :a, :l1, 'c01a0000-0000-4000-8000-0000000000a4', '2026-08-21', 'borrador'),
       ('c03e0000-0000-4000-8000-000000000214', :a, :l2, 'c01a0000-0000-4000-8000-0000000000a4', '2026-07-21', 'confirmado');
insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received, unit_cost, doc_amount)
values (:a, 'c03e0000-0000-4000-8000-000000000211', 'Caja A', 10, 60, null),
       (:a, 'c03e0000-0000-4000-8000-000000000212', 'Caja B', 4, null, 400),
       (:a, 'c03e0000-0000-4000-8000-000000000213', 'Borrador, no cuenta', 1, 999, 999),
       (:a, 'c03e0000-0000-4000-8000-000000000214', 'Otro mes', 1, 77, 77);
insert into public.sale (id, account_id, location_id, brand_id, source, sold_at, total, tax, taxable_base, status)
values ('c03e0000-0000-4000-8000-000000000221', :a, :l1, 'c03e0000-0000-4000-8000-000000000201', 'lastapp', '2026-08-10 13:00+02', 1320, 120, 1200, 'closed'),
       ('c03e0000-0000-4000-8000-000000000222', :a, :l1, 'c03e0000-0000-4000-8000-000000000201', 'lastapp', '2026-08-31 23:30+02', 880, 80, 800, 'closed'),
       -- 31/08 a las 23:30 de Madrid es 21:30 UTC: cuenta en agosto. Esta, 01/09 a las 00:30 de Madrid (22:30 UTC del 31), NO.
       ('c03e0000-0000-4000-8000-000000000223', :a, :l1, 'c03e0000-0000-4000-8000-000000000201', 'lastapp', '2026-09-01 00:30+02', 500, 45, 455, 'closed'),
       ('c03e0000-0000-4000-8000-000000000224', :a, :l1, 'c03e0000-0000-4000-8000-000000000201', 'lastapp', '2026-08-12 13:00+02', 999, 99, 900, 'cancelled');

-- El socio, su acuerdo y su aportación; y una línea SIN PRECIO en el albarán del 3 de agosto.
do $$
declare v_socio uuid;
begin
  select party_id into v_socio from public.party_role where supplier_id = 'c01a0000-0000-4000-8000-0000000000a4';
  perform set_config('prueba.socio', v_socio::text, false);
end $$;
insert into public.goods_receipt_line (account_id, goods_receipt_id, product_name, qty_received)
values (:a, 'c03e0000-0000-4000-8000-000000000211', 'Sin precio', 2);

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_socio uuid := current_setting('prueba.socio')::uuid; c jsonb; v_id uuid;
  l1 uuid := 'c01a0000-0000-4000-8000-0000000000a2';
begin
  perform public.party_add_role(v_socio, 'brand_partner', '{"contributionKinds": ["marketing"]}'::jsonb);
  insert into public.brand_licensing_agreement (account_id, brand_id, owner_name, revenue_share_pct, party_id)
  values ('c01a0000-0000-4000-8000-00000000000a', 'c03e0000-0000-4000-8000-000000000201', 'Bebidas Sol', 10, v_socio);
  insert into public.brand_partner_contribution (account_id, party_id, location_id, contributed_on, kind, amount)
  values ('c01a0000-0000-4000-8000-00000000000a', v_socio, l1, '2026-08-15', 'marketing', 150);
  -- La línea sin precio: se dice y no se cierra.
  c := public.brand_partner_settlement_compute(v_socio, l1, '2026-08-01', '2026-08-31');
  if jsonb_array_length(c->'faltan') <> 1 or c->'faltan'->0->>'texto' <> '1 línea de albarán sin precio: complétala en el albarán.' then
    raise exception 'PRUEBA C03 · 6: la línea sin precio no se dice: %', c->'faltan';
  end if;
  c := public.brand_partner_settlement_prepare(v_socio, l1, '2026-08-01', '2026-08-31', 'Prueba');
  perform set_config('prueba.liq', c->>'id', false);
  begin
    perform public.brand_partner_settlement_confirm((c->>'id')::uuid, (c->>'importe')::numeric, 'Prueba');
    raise exception 'PRUEBA C03 · 6: se cierra con una línea sin precio.';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'PRUEBA C03 · 6a en verde (falta una fuente: no se cierra)';
end $$;
reset role;

-- Se completa el albarán (fuera de la pantalla: aquí basta con quitar la línea).
delete from public.goods_receipt_line where product_name = 'Sin precio' and goods_receipt_id = 'c03e0000-0000-4000-8000-000000000211';

select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_socio uuid := current_setting('prueba.socio')::uuid; v_id uuid := current_setting('prueba.liq')::uuid; c jsonb;
  l1 uuid := 'c01a0000-0000-4000-8000-0000000000a2'; l2 uuid := 'e0200000-0000-4000-8000-0000000000a3';
begin
  c := public.brand_partner_settlement_prepare(v_socio, l1, '2026-08-01', '2026-08-31', 'Prueba');
  if (c->>'compras')::numeric <> 1000 or (c->>'aportaciones')::numeric <> 150 or (c->>'base_ventas')::numeric <> 2000
     or (c->>'comision')::numeric <> 200 or (c->>'importe')::numeric <> 1050 or (c->>'id')::uuid <> v_id then
    raise exception 'PRUEBA C03 · 6: la fórmula no sale 1000 − 150 + 200 = 1050 (o no rehace el mismo borrador): %', c;
  end if;
  -- Otro local, otro cálculo: en Norte Mercado no hay ventas de agosto → falta una fuente.
  c := public.brand_partner_settlement_compute(v_socio, l2, '2026-08-01', '2026-08-31');
  if (c->>'compras')::numeric <> 0 or c->'faltan'->0->>'texto' <> 'No hay ninguna venta de sus marcas en este local y periodo: las ventas no han llegado.' then
    raise exception 'PRUEBA C03 · 6: el otro local se mezcla o no dice lo que falta: %', c;
  end if;
  -- Confirmar con el importe que se ha visto; después, no se rehace.
  begin
    perform public.brand_partner_settlement_confirm(v_id, 999, 'Prueba');
    raise exception 'PRUEBA C03 · 6: confirma con un importe que no es el calculado.';
  exception when invalid_parameter_value then null;
  end;
  c := public.brand_partner_settlement_confirm(v_id, 1050, 'Prueba');
  if (select status from public.licensed_settlement where id = v_id) <> 'confirmada' then raise exception 'PRUEBA C03 · 6: no queda confirmada.'; end if;
  begin
    perform public.brand_partner_settlement_prepare(v_socio, l1, '2026-08-01', '2026-08-31', 'Prueba');
    raise exception 'PRUEBA C03 · 6: rehace una confirmada.';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'PRUEBA C03 · 6 en verde';
end $$;
reset role;

-- ── 7 · Como el administrador de B ──────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare v_prov uuid;
begin
  if exists (select 1 from public.party where account_id = 'c01a0000-0000-4000-8000-00000000000a')
     or exists (select 1 from public.party_role where account_id = 'c01a0000-0000-4000-8000-00000000000a')
     or exists (select 1 from public.customer_fiscal where account_id = 'c01a0000-0000-4000-8000-00000000000a')
     or exists (select 1 from public.brand_partner_contribution where account_id = 'c01a0000-0000-4000-8000-00000000000a') then
    raise exception 'PRUEBA C03 · 7: B ve terceros de A.';
  end if;
  begin
    perform public.party_save_customer('c01a0000-0000-4000-8000-00000000000a', null, 'Intruso', null, '{}'::jsonb, 'B');
    raise exception 'PRUEBA C03 · 7: B da de alta clientes en A.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.channel_settlement_collect('c03e0000-0000-4000-8000-000000000002', '2026-10-01', 1, null, 'B');
    raise exception 'PRUEBA C03 · 7: B apunta cobros en A.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA C03 · 7 en verde';
end $$;
reset role;

-- B no puede tocar el tercero de A aunque sepa su id.
do $$
declare v_prov uuid;
begin
  select party_id into v_prov from public.party_role where supplier_id = 'c01a0000-0000-4000-8000-0000000000a3';
  perform set_config('prueba.party', v_prov::text, true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', 'c01b0000-0000-4000-8000-0000000000b1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$ begin
  begin
    perform public.party_add_role(current_setting('prueba.party')::uuid, 'brand_partner', '{}'::jsonb);
    raise exception 'PRUEBA C03 · 7: B añade papeles a un tercero de A.';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.party_set_archived(current_setting('prueba.party')::uuid, true, 'B');
    raise exception 'PRUEBA C03 · 7: B archiva un tercero de A.';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PRUEBA C03 · 7 (por id) en verde';
end $$;
reset role;

-- ── 8 · Un cliente de otra cuenta no se enlaza ──────────────────────────────
do $$
declare v_b uuid; v_cuenta uuid;
begin
  insert into public.party (account_id, name) values ('c01b0000-0000-4000-8000-00000000000b', 'Cliente de B') returning id into v_b;
  select id into v_cuenta from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and template_code = '4300' and status = 'activa' limit 1;
  if v_cuenta is null then
    select id into v_cuenta from public.company_account where company_id = '3b34403a-a7d6-4a48-a8d7-737e8cababdc' and code like '430%' and status = 'activa' limit 1;
  end if;
  begin
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values ('c01a0000-0000-4000-8000-00000000000a', '3b34403a-a7d6-4a48-a8d7-737e8cababdc', v_cuenta, 'customer', v_b::text, 'principal', 'manual');
    raise exception 'PRUEBA C03 · 8: enlaza a una cuenta de A un cliente de B.';
  exception when check_violation then null;
  end;
  raise notice 'PRUEBA C03 · 8 en verde';
end $$;

rollback;
