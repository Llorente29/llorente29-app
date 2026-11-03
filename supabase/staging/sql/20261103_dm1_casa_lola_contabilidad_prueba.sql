-- supabase/staging/sql/20261103_dm1_casa_lola_contabilidad_prueba.sql
--
-- SOLO STAGING. Prueba de la 1350 (DM1 · la contabilidad de demo de Casa
-- Lola), dentro de la transacción del run y con ROLLBACK: staging no cambia.
-- Nombra lo que crea: public.demo_contabilidad_sembrar.
--
-- sin usuario: la semilla la llama la plataforma (la migración, sin sesión) y
-- ella misma entra como el administrador de la cuenta que siembra; aquí se
-- llama igual, sin sesión.
--
-- Casa Lola no está en staging: la 1350 no siembra nada aquí (lo dice). La
-- prueba siembra un DOBLE inventado de Casa Lola (su cuenta, su local, sus
-- cinco canales, su marca, sus seis proveedores sin NIF, su administrador
-- «Demo Folvy» y ventas de Folvy del 14/08 al 08/10) y mira lo que sale:
--
--   0 · ROJO A PROPÓSITO: sin la marca de demo, la semilla no siembra (para).
--       Si sembrara, la guarda no mediría nada.
--   1 · con la marca: la empresa, el plan, las ventas del cierre del día
--       validadas, las 18 recibidas (las de octubre, sin pagar), las 12
--       liquidaciones, el extracto con todo casado menos dos, el 303 del 3T
--       presentado, contabilizado y pagado (su cargo casado) y el del 4T en
--       borrador. Cada asiento validado, con su huella y su número de cadena.
--   2 · ninguna otra cuenta cambia: las mismas empresas y asientos que antes.
--   3 · otra vez sobre la misma cuenta: para (ya tiene empresa).
--   4 · la vuelta atrás, apuntada al doble: el doble vuelve a como estaba,
--       tabla a tabla, y la función se quita.
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1 Casa Lola: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '300s';

-- ── El doble inventado de Casa Lola ─────────────────────────────────────────
-- Doble inventado de Casa Lola para probar la semilla (local y prueba de staging).
create temp table _d (clave text primary key, v uuid) on commit drop;
insert into _d values
  ('cuenta', 'de0c0000-0000-4000-8000-00000000c01a'), ('local', 'de0c0000-0000-4000-8000-00000000c01b'),
  ('marca', 'de0c0000-0000-4000-8000-00000000c01c'), ('admin', 'de0c0000-0000-4000-8000-00000000c01d'),
  ('glovo', 'de0c0000-0000-4000-8000-0000000000c1'), ('uber', 'de0c0000-0000-4000-8000-0000000000c2'),
  ('shop', 'de0c0000-0000-4000-8000-0000000000c3'), ('justeat', 'de0c0000-0000-4000-8000-0000000000c4'),
  ('salon', 'de0c0000-0000-4000-8000-0000000000c5');

insert into public.accounts (id, name, slug, country, currency, timezone, business_type)
select v, 'Casa Lola (doble de prueba)', 'casa-lola-doble-' || substr(md5(random()::text), 1, 6), 'ES', 'EUR', 'Europe/Madrid', 'restaurante' from _d where clave = 'cuenta';
insert into public.locations (id, account_id, name, active, is_billable)
select (select v from _d where clave = 'local'), (select v from _d where clave = 'cuenta'), 'Casa Lola', true, true;
insert into public.brand (id, account_id, name, slug, is_active)
select (select v from _d where clave = 'marca'), (select v from _d where clave = 'cuenta'), 'Casa Lola', 'casa-lola-doble', true;
insert into public.sales_channel (id, account_id, name, slug, is_active, channel_type)
select d.v, (select v from _d where clave = 'cuenta'), n.nombre, n.slug, true, n.tipo
  from (values ('glovo', 'Glovo', 'delivery'), ('uber', 'Uber', 'delivery'), ('shop', 'Shop', 'takeaway'),
               ('justeat', 'JustEat', 'delivery'), ('salon', 'Salón', 'dine_in')) n(slug, nombre, tipo)
  join _d d on d.clave = n.slug;
insert into public.supplier (account_id, name, legal_name, default_location_id, payment_method, payment_terms_days, invoicing_frequency, created_by_name)
select (select v from _d where clave = 'cuenta'), n.nombre, n.legal, (select v from _d where clave = 'local'), 'transfer', 30, 'monthly', 'Demo Folvy'
  from (values ('Frutas y Verduras Hermanos Vega', 'Hermanos Vega Frutas y Verduras, S.L.'), ('Carnes Sierra Norte', 'Cárnicas Sierra Norte, S.L.'),
               ('Pescados del Cantábrico', 'Pescados del Cantábrico Madrid, S.L.'), ('Distribuciones Castilla', 'Distribuciones Alimentarias Castilla, S.A.'),
               ('Bodegas y Bebidas Madrid', 'Bodegas y Bebidas Madrid, S.L.'), ('Panadería La Espiga', 'Panadería La Espiga, S.L.')) n(nombre, legal);
insert into auth.users (id, email) select v, 'demo.casalola.doble@example.invalid' from _d where clave = 'admin';
insert into public.user_profiles (user_id, account_id, role, active, display_name, terms_accepted_at, welcome_completed_at)
select (select v from _d where clave = 'admin'), (select v from _d where clave = 'cuenta'), 'admin', true, 'Demo Folvy', now(), now();

-- Ventas inventadas del 14/08 al 08/10 (como las de Casa Lola): cada día, por canal.
insert into public.sale (account_id, location_id, brand_id, channel_id, source, status, sold_at, opened_at, paid_at, closed_at,
                         total, paid, taxable_base, tax, payment_status, order_status, service_type, external_ref)
select (select v from _d where clave = 'cuenta'), (select v from _d where clave = 'local'), (select v from _d where clave = 'marca'), d.v,
       case when d.clave = 'salon' then 'folvy_pos' when d.clave = 'shop' then 'folvy_shop' else 'import' end, 'closed',
       t, t, t, t + interval '30 min', imp, imp, round(imp / 1.10, 2), imp - round(imp / 1.10, 2), 'paid', 'completed',
       case when d.clave = 'salon' then 'dine_in' when d.clave = 'shop' then 'pickup' else 'platform_delivery' end,
       'DOBLE-' || to_char(t, 'YYYYMMDD-HH24MI') || '-' || d.clave
  from generate_series(timestamptz '2026-08-14 12:00+02', timestamptz '2026-10-08 12:00+02', interval '1 day') g
  cross join lateral (select g + interval '1 hour' * k t, k from generate_series(0, 2) k) h
  join _d d on d.clave in ('glovo', 'uber', 'shop', 'justeat', 'salon')
  cross join lateral (select case when d.clave = 'salon' then 700 + h.k * 110 else 24 + h.k * 3 end::numeric + 0.5 imp) i;

-- Lo de antes: las filas del doble en cada tabla con account_id, y las de las demás cuentas.
create temp table _antes on commit drop as
select c.table_name::text as t, 0::bigint as n from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
 where c.table_schema = 'public' and c.column_name = 'account_id';
do $$ declare r record; k bigint; begin
  for r in select t from _antes loop
    execute format('select count(*) from public.%I where account_id = %L', r.t, (select d.v from _d d where d.clave = 'cuenta')) into k;
    update _antes set n = k where t = r.t;
  end loop;
end $$;
create temp table _otras on commit drop as
select (select count(*) from public.company where account_id <> (select v from _d where clave = 'cuenta')) as empresas,
       (select count(*) from public.journal_entry where account_id <> (select v from _d where clave = 'cuenta')) as asientos,
       (select count(*) from public.bank_movement where account_id <> (select v from _d where clave = 'cuenta')) as movimientos;

-- ── 0 · Rojo a propósito: sin la marca de demo, no siembra ──────────────────
do $$ begin
  begin
    perform public.demo_contabilidad_sembrar((select v from _d where clave = 'cuenta'));
    raise exception 'PRUEBA DM1 Casa Lola · 0: ha sembrado una cuenta SIN la marca de demo.';
  exception when insufficient_privilege then
    raise notice 'PRUEBA DM1 Casa Lola · 0 (rojo a propósito): sin la marca de demo para, como debe: %', sqlerrm;
  end;
  if exists (select 1 from public.company where account_id = (select v from _d where clave = 'cuenta')) then
    raise exception 'PRUEBA DM1 Casa Lola · 0: ha dejado una empresa a medias.';
  end if;
end $$;

-- ── 1 · Con la marca: lo que sale ───────────────────────────────────────────
update public.accounts set is_demo = true where id = (select v from _d where clave = 'cuenta');
create temp table _r on commit drop as select public.demo_contabilidad_sembrar((select v from _d where clave = 'cuenta')) as r;
do $$
declare
  c uuid := (select v from _d where clave = 'cuenta'); r jsonb := (select r from _r); e uuid := (r->>'empresa')::uuid; n bigint; t3 public.tax_return; t4 public.tax_return;
begin
  raise notice 'PRUEBA DM1 Casa Lola · 1: %', r - 'iva_4t';
  if e is null or not exists (select 1 from public.company where id = e and account_id = c and setup_completed_at is not null) then
    raise exception 'PRUEBA DM1 Casa Lola · 1: no hay empresa terminada.';
  end if;
  if (r->>'dias_de_ventas')::int <> 60 then raise exception 'PRUEBA · 1: % asientos de ventas; tocaban 56 días de Folvy y 4 semanas inventadas.', r->>'dias_de_ventas'; end if;
  if (r->>'recibidas')::int <> 18 then raise exception 'PRUEBA · 1: % recibidas; tocaban 18.', r->>'recibidas'; end if;
  if (r->>'liquidaciones')::int <> 12 then raise exception 'PRUEBA · 1: % liquidaciones; tocaban 12.', r->>'liquidaciones'; end if;
  select count(*) into n from public.journal_entry where account_id = c and company_id = e and status <> 'validado';
  if n > 0 then raise exception 'PRUEBA · 1: % asientos sin validar.', n; end if;
  select count(*) into n from public.journal_entry where account_id = c and company_id = e and status = 'validado' and (hash is null or chain_seq is null or number is null);
  if n > 0 then raise exception 'PRUEBA · 1: % asientos validados sin huella, cadena o número.', n; end if;
  select count(*) into n from public.supplier_invoice where account_id = c and company_id = e and status = 'pagada';
  if n <> 12 then raise exception 'PRUEBA · 1: % recibidas pagadas; tocaban 12 (agosto y septiembre).', n; end if;
  select count(*) into n from public.supplier_invoice where account_id = c and company_id = e and status = 'aprobada' and invoice_date = date '2026-10-31';
  if n <> 6 then raise exception 'PRUEBA · 1: % de octubre por pagar; tocaban 6.', n; end if;
  select count(*) into n from public.bank_movement where account_id = c and company_id = e and status = 'pendiente';
  if n <> 2 then raise exception 'PRUEBA · 1: % movimientos sin casar; tocaban 2.', n; end if;
  select count(*) into n from public.bank_movement where account_id = c and company_id = e and status <> 'casado' and status <> 'pendiente';
  if n > 0 then raise exception 'PRUEBA · 1: % movimientos ni casados ni pendientes.', n; end if;
  select * into t3 from public.tax_return where account_id = c and company_id = e and form_code = '303' and period = '3T';
  if t3.status is distinct from 'paid' or t3.result_kind is distinct from 'to_pay' or t3.liquidation_entry_id is null or t3.bank_match_id is null or t3.filed_via is distinct from 'outside' then
    raise exception 'PRUEBA · 1: el 303 del 3T no está presentado, contabilizado y pagado: %', to_jsonb(t3);
  end if;
  select * into t4 from public.tax_return where account_id = c and company_id = e and form_code = '303' and period = '4T';
  if t4.status is distinct from 'draft' or t4.result_kind is null then raise exception 'PRUEBA · 1: el 303 del 4T no está en borrador calculado: %', to_jsonb(t4); end if;
  select count(*) into n from public.vat_book_entry where account_id = c and company_id = e and book = 'received';
  if n <> 18 + 9 then raise exception 'PRUEBA · 1: % apuntes en el libro de recibidas; tocaban 27 (18 facturas y 9 comisiones).', n; end if;
  if (select count(*) from public.supplier where account_id = c and tax_id is null) > 0 then raise exception 'PRUEBA · 1: un proveedor sin NIF.'; end if;
  raise notice 'PRUEBA DM1 Casa Lola · 1: todo sale (3T % a pagar, pagado; 4T % en borrador).', t3.amount, t4.amount;
end $$;

-- ── 2 · Ninguna otra cuenta cambia ──────────────────────────────────────────
do $$ declare o record; begin
  select (select count(*) from public.company where account_id <> (select v from _d where clave = 'cuenta')) as empresas,
         (select count(*) from public.journal_entry where account_id <> (select v from _d where clave = 'cuenta')) as asientos,
         (select count(*) from public.bank_movement where account_id <> (select v from _d where clave = 'cuenta')) as movimientos into o;
  if (o.empresas, o.asientos, o.movimientos) is distinct from (select (empresas, asientos, movimientos) from _otras) then
    raise exception 'PRUEBA DM1 Casa Lola · 2: otra cuenta ha cambiado: antes %, ahora %', (select to_jsonb(x) from _otras x), to_jsonb(o);
  end if;
  raise notice 'PRUEBA DM1 Casa Lola · 2: las demás cuentas, igual (% empresas, % asientos, % movimientos).', o.empresas, o.asientos, o.movimientos;
end $$;

-- ── 3 · Otra vez sobre la misma cuenta: para ────────────────────────────────
do $$ begin
  begin
    perform public.demo_contabilidad_sembrar((select v from _d where clave = 'cuenta'));
    raise exception 'PRUEBA DM1 Casa Lola · 3: ha sembrado otra vez encima.';
  exception when unique_violation then
    raise notice 'PRUEBA DM1 Casa Lola · 3: otra vez encima para, como debe: %', sqlerrm;
  end;
end $$;

-- ── 4 · La vuelta atrás, apuntada al doble ──────────────────────────────────
select set_config('demo.vuelta_cuenta', (select v::text from _d where clave = 'cuenta'), true);
\i supabase/vuelta-atras/20261103T1350_dm1_casa_lola_contabilidad.down.sql
select set_config('demo.vuelta_cuenta', '', true);
do $$ declare r record; k bigint; dif text[] := '{}'; begin
  for r in select t, n from _antes loop
    execute format('select count(*) from public.%I where account_id = %L', r.t, (select d.v from _d d where d.clave = 'cuenta')) into k;
    if k <> r.n then dif := dif || format('%s: %s antes, %s ahora', r.t, r.n, k); end if;
  end loop;
  if cardinality(dif) > 0 then raise exception 'PRUEBA DM1 Casa Lola · 4: la vuelta atrás no deja el doble como estaba: %', dif; end if;
  if to_regprocedure('public.demo_contabilidad_sembrar(uuid)') is not null then raise exception 'PRUEBA · 4: la función sigue.'; end if;
  if (select is_demo from public.accounts where id = (select v from _d where clave = 'cuenta')) then raise exception 'PRUEBA · 4: sigue marcada como demo.'; end if;
  if exists (select 1 from pg_trigger where tgname in ('trg_journal_entry_inalterable', 'trg_journal_line_inalterable') and tgenabled = 'D') then
    raise exception 'PRUEBA · 4: el candado de los asientos se ha quedado apagado.';
  end if;
  raise notice 'PRUEBA DM1 Casa Lola · 4: la vuelta atrás deja el doble como estaba, tabla a tabla.';
end $$;
