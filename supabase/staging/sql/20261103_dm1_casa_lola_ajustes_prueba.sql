-- supabase/staging/sql/20261103_dm1_casa_lola_ajustes_prueba.sql
--
-- SOLO STAGING. Prueba de la 2320 (DM1·8 · Casa Lola: la apertura, 11 nóminas y un pago con Revolut), dentro de la
-- transacción del run y con ROLLBACK: staging no cambia. Nombra lo que cambia: public.demo_contabilidad_sembrar,
-- public.journal_entry y public.journal_line (su candado se apaga y se enciende para borrar la contabilidad de demo).
--
-- sin usuario: la semilla la llama la plataforma (la migración, sin sesión) y ella misma entra como el
-- administrador de la cuenta que siembra; aquí se llama igual, sin sesión.
--
-- Casa Lola no está en staging: la prueba hace el camino de producción sobre un DOBLE inventado (de0c0002…):
--   0 · el doble, sembrado con la 1350 y con la 1525 encima (como Casa Lola hoy en producción).
--   1 · la 2320 encima, apuntada al doble (demo.cuenta): borra y siembra con la apertura, 11 nóminas y el pago
--       con Revolut. La 572 de Revolut, igual a su extracto; la de la cuenta principal, igual a su extracto menos
--       lo que falta por casar; 11 personas en cada nómina; el 111 del 3T casado con su cargo; la factura pagada
--       con Revolut, con su salida «pagada» y su remesa casada.
--   1b · LOS AGENTES de agentes.sh, con sus jueces: nada en rojo del doble.
--   1c · ROJO A PROPÓSITO: sin el 190 en el perfil, «Datos maestros» en rojo; con la huella de un asiento tocada,
--       «Libro diario» en rojo (se deshace con un savepoint).
--   2 · ninguna otra cuenta cambia.
--   3 · sembrar otra vez encima, para.
--   4 · la vuelta atrás de la 2320, apuntada al doble: el doble vuelve a como lo dejó la 1525, tabla a tabla.
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA DM1·8 Casa Lola: esta base tiene cuentas de producción. No se toca nada.';
  end if;
end $$;
set local statement_timeout = '600s';

-- ── 0 · El doble, sembrado con la 1350 y con la 1525 encima ─────────────────
-- Doble inventado de Casa Lola para probar la semilla (local y prueba de staging).
create temp table _d (clave text primary key, v uuid) on commit drop;
insert into _d values
  ('cuenta', 'de0c0002-0000-4000-8000-00000000c01a'), ('local', 'de0c0002-0000-4000-8000-00000000c01b'),
  ('marca', 'de0c0002-0000-4000-8000-00000000c01c'), ('admin', 'de0c0002-0000-4000-8000-00000000c01d'),
  ('glovo', 'de0c0002-0000-4000-8000-0000000000c1'), ('uber', 'de0c0002-0000-4000-8000-0000000000c2'),
  ('shop', 'de0c0002-0000-4000-8000-0000000000c3'), ('justeat', 'de0c0002-0000-4000-8000-0000000000c4'),
  ('salon', 'de0c0002-0000-4000-8000-0000000000c5');

insert into public.accounts (id, name, slug, country, currency, timezone, business_type)
select v, 'Casa Lola (doble de prueba)', 'casa-lola-doble-' || substr(md5(random()::text), 1, 6), 'ES', 'EUR', 'Europe/Madrid', 'restaurante' from _d where clave = 'cuenta';
insert into public.locations (id, account_id, name, active, is_billable)
select (select v from _d where clave = 'local'), (select v from _d where clave = 'cuenta'), 'Casa Lola', true, true;
insert into public.brand (id, account_id, name, slug, is_active)
select (select v from _d where clave = 'marca'), (select v from _d where clave = 'cuenta'), 'Casa Lola', 'casa-lola-doble-3', true;
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
insert into auth.users (id, email) select v, 'demo.casalola.doble3@example.invalid' from _d where clave = 'admin';
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
  cross join lateral (select case when d.clave = 'salon' then 1400 + h.k * 110 else 24 + h.k * 3 end::numeric + 0.5 imp) i;
\i supabase/migrations/20261103T1350_dm1_casa_lola_contabilidad.sql
update public.accounts set is_demo = true where id = (select v from _d where clave = 'cuenta');
select public.demo_contabilidad_sembrar((select v from _d where clave = 'cuenta')) is not null as sembrado_1350;
select set_config('demo.cuenta', (select v::text from _d where clave = 'cuenta'), true);
\i supabase/migrations/20261103T1525_dm1_casa_lola_gastos.sql
select set_config('demo.cuenta', '', true);

-- Lo de antes de la 2320: las filas del doble en cada tabla con account_id, y las de las demás cuentas.
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

-- ── 1 · La 2320 encima, apuntada al doble ───────────────────────────────────
select set_config('demo.cuenta', (select v::text from _d where clave = 'cuenta'), true);
-- El respaldo que guarda la 2320 tiene que ser la función que hay justo antes, la de la 1525, como en producción:
-- el de la pasada del run (antes de esta prueba) es la que tuviera staging.
delete from public.funcion_respaldo where firma = 'public.demo_contabilidad_sembrar(uuid)' and migracion = '20261103T2320_dm1_casa_lola_ajustes';
\i supabase/migrations/20261103T2320_dm1_casa_lola_ajustes.sql
select set_config('demo.cuenta', '', true);
do $$
declare
  c uuid := (select v from _d where clave = 'cuenta'); e uuid; n bigint; t public.tax_return; s numeric; m numeric; t2 record;
begin
  select id into e from public.company where account_id = c;
  if e is null then raise exception 'PRUEBA DM1·8 · 1: el doble no tiene empresa después de la 1525.'; end if;
  select count(*) into n from public.company where account_id = c;
  if n <> 1 then raise exception 'PRUEBA · 1: % empresas; tocaba una (borrada y sembrada otra vez).', n; end if;
  select count(*) into n from public.journal_entry where account_id = c and company_id = e and status <> 'validado';
  if n > 0 then raise exception 'PRUEBA · 1: % asientos sin validar.', n; end if;
  select count(*) into n from public.journal_entry where account_id = c and company_id = e and source_type = 'payroll' and status = 'validado';
  if n <> 4 then raise exception 'PRUEBA · 1: % nóminas validadas; tocaban 4 (julio a octubre).', n; end if;
  select count(*) into n from public.supplier_invoice where account_id = c and company_id = e;
  if n <> 38 then raise exception 'PRUEBA · 1: % recibidas; tocaban 38 (18 de Cocina y 20 de gastos fijos).', n; end if;
  select count(*) into n from public.supplier_invoice where account_id = c and company_id = e and withholding_amount > 0;
  if n <> 4 then raise exception 'PRUEBA · 1: % facturas con retención; tocaban las 4 del alquiler.', n; end if;
  for t in select * from public.tax_return where account_id = c and company_id = e and period = '3T' loop
    if t.status is distinct from 'paid' then raise exception 'PRUEBA · 1: el % del 3T está «%», no pagado: %', t.form_code, t.status, to_jsonb(t); end if;
  end loop;
  select count(*) into n from public.tax_return where account_id = c and company_id = e and period = '3T' and status = 'paid' and form_code in ('303', '111', '115');
  if n <> 3 then raise exception 'PRUEBA · 1: % del 303, 111 y 115 del 3T pagados; tocaban 3.', n; end if;
  if (select liquidation_entry_id from public.tax_return where account_id = c and company_id = e and form_code = '303' and period = '3T') is null then
    raise exception 'PRUEBA · 1: el 303 del 3T sin contabilizar.';
  end if;
  select count(*) into n from public.tax_return where account_id = c and company_id = e and period = '4T' and status = 'draft' and form_code in ('303', '111', '115');
  if n <> 3 then raise exception 'PRUEBA · 1: % del 303, 111 y 115 del 4T en borrador; tocaban 3.', n; end if;
  select count(*) into n from public.bank_movement where account_id = c and company_id = e and status = 'pendiente';
  if n <> 2 then raise exception 'PRUEBA · 1: % movimientos sin casar; tocaban los 2 sueltos.', n; end if;
  select b.closing_balance, b.opening_balance + (select sum(x.amount) from public.bank_movement x where x.statement_id = b.id) into s, m
    from public.bank_statement b join public.treasury_account tr on tr.id = b.treasury_account_id
   where b.account_id = c and b.company_id = e and tr.name = 'Cuenta principal';
  if s is distinct from m then raise exception 'PRUEBA · 1: el extracto no cuadra (saldo % y movimientos %).', s, m; end if;
  if (select tax_forms from public.company_tax_profile where company_id = e) @> array['111', '115', '180', '190'] is not true then
    raise exception 'PRUEBA · 1: al perfil le faltan el 111, el 115, el 180 o el 190.';
  end if;
  -- DM1·8 · La apertura y la 572 de cada banco contra su extracto (la principal, menos lo que falta por casar).
  if not exists (select 1 from public.journal_entry where account_id = c and company_id = e and source_type = 'opening' and status = 'validado' and entry_date = date '2026-01-01') then
    raise exception 'PRUEBA · 1: no está el asiento de apertura del 01/01.';
  end if;
  for t2 in select tr.id, tr.name, st.closing_balance as extracto,
                   coalesce((select sum(l.debit - l.credit) from public.journal_line l join public.journal_entry je on je.id = l.entry_id
                              join public.company_account_link k on k.company_account_id = l.company_account_id and k.entity = 'bank_account' and k.entity_id = tr.id::text
                             where je.account_id = c and je.status = 'validado'), 0) as libro,
                   coalesce((select sum(b.amount) from public.bank_movement b where b.treasury_account_id = tr.id and b.status = 'pendiente'), 0) as por_casar
              from public.treasury_account tr join public.bank_statement st on st.treasury_account_id = tr.id
             where tr.account_id = c and tr.company_id = e loop
    if t2.libro + t2.por_casar is distinct from t2.extracto then
      raise exception 'PRUEBA · 1: la 572 de «%» es % y su extracto % (con % por casar).', t2.name, t2.libro, t2.extracto, t2.por_casar;
    end if;
  end loop;
  if (select count(*) from public.treasury_account where account_id = c and company_id = e) <> 2 then raise exception 'PRUEBA · 1: no están las dos cuentas (la principal y Revolut).'; end if;
  if exists (select 1 from public.payroll_summary where account_id = c and company_id = e and employees_count <> 11) then
    raise exception 'PRUEBA · 1: una nómina no es de 11 personas.';
  end if;
  if not exists (select 1 from public.conta_pago_salida s join public.supplier_invoice i on i.id = s.invoice_id
                  join public.conta_pago_remesa_linea rl on rl.id = s.remesa_linea_id
                 where s.account_id = c and s.company_id = e and s.estado = 'pagada' and i.status = 'pagada' and rl.bank_match_id is not null) then
    raise exception 'PRUEBA · 1: no está el pago con Revolut (salida pagada, factura pagada y remesa casada).';
  end if;
  raise notice 'PRUEBA DM1·8 Casa Lola · 1: todo sale (apertura, 11 nóminas, pago con Revolut, cada 572 con su extracto; 303, 111 y 115 del 3T pagados; saldo del banco %).', s;
end $$;

-- ── 1b · Los agentes, con sus jueces: nada en rojo del doble ────────────────
\i scripts/conta/staging/agentes-volcar.sql
\set rojos `bash scripts/conta/staging/agentes-rojos.sh de0c0002`
select set_config('prueba.rojos', :'rojos', true) \g /dev/null
do $$ declare r text[] := string_to_array(current_setting('prueba.rojos'), ' '); begin
  if r[1]::int < 0 then raise exception 'PRUEBA DM1·8 · 1b: los jueces de los agentes no han escrito su informe.'; end if;
  if r[1]::int <> 0 or r[2]::int <> 0 then
    raise exception 'PRUEBA DM1·8 · 1b: en rojo para el doble: % en «Datos maestros», % en «Libro diario».', r[1], r[2];
  end if;
  raise notice 'PRUEBA DM1·8 Casa Lola · 1b: los dos agentes, sin nada en rojo del doble.';
end $$;

-- ── 1c · Rojo a propósito ───────────────────────────────────────────────────
savepoint sin_arreglos;
update public.company_tax_profile set tax_forms = array_remove(tax_forms, '190')
 where account_id = (select v from _d where clave = 'cuenta');
alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
update public.journal_entry set concept = concept || ' (tocado)'
 where id = (select e.id from public.journal_entry e where e.account_id = (select v from _d where clave = 'cuenta') and e.source_type = 'payroll'
              order by e.entry_date limit 1);
alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
\i scripts/conta/staging/agentes-volcar.sql
\set rojos `bash scripts/conta/staging/agentes-rojos.sh de0c0002`
select set_config('prueba.rojos', :'rojos', true) \g /dev/null
do $$ declare r text[] := string_to_array(current_setting('prueba.rojos'), ' '); begin
  if r[1]::int < 1 then raise exception 'PRUEBA DM1·8 · 1c: con el 111 sin el 190, «Datos maestros» no lo ve.'; end if;
  if r[2]::int < 1 then raise exception 'PRUEBA DM1·8 · 1c: con la huella de una nómina tocada, «Libro diario» no lo ve.'; end if;
  raise notice 'PRUEBA DM1·8 Casa Lola · 1c (rojo a propósito): % en rojo en «Datos maestros» y % en «Libro diario».', r[1], r[2];
end $$;
rollback to savepoint sin_arreglos;

-- ── 2 · Ninguna otra cuenta cambia ──────────────────────────────────────────
do $$ declare o record; begin
  select (select count(*) from public.company where account_id <> (select v from _d where clave = 'cuenta')) as empresas,
         (select count(*) from public.journal_entry where account_id <> (select v from _d where clave = 'cuenta')) as asientos,
         (select count(*) from public.bank_movement where account_id <> (select v from _d where clave = 'cuenta')) as movimientos into o;
  if (o.empresas, o.asientos, o.movimientos) is distinct from (select (empresas, asientos, movimientos) from _otras) then
    raise exception 'PRUEBA DM1·8 · 2: otra cuenta ha cambiado: antes %, ahora %', (select to_jsonb(x) from _otras x), to_jsonb(o);
  end if;
  raise notice 'PRUEBA DM1·8 Casa Lola · 2: las demás cuentas, igual (% empresas, % asientos, % movimientos).', o.empresas, o.asientos, o.movimientos;
end $$;

-- ── 3 · Otra vez encima: para ───────────────────────────────────────────────
do $$ begin
  begin
    perform public.demo_contabilidad_sembrar((select v from _d where clave = 'cuenta'));
    raise exception 'PRUEBA DM1·8 · 3: ha sembrado otra vez encima.';
  exception when unique_violation then
    raise notice 'PRUEBA DM1·8 Casa Lola · 3: otra vez encima para, como debe.';
  end;
end $$;

-- ── 4 · La vuelta atrás de la 2320, apuntada al doble ───────────────────────
select set_config('demo.cuenta', (select v::text from _d where clave = 'cuenta'), true);
\i supabase/vuelta-atras/20261103T2320_dm1_casa_lola_ajustes.down.sql
select set_config('demo.cuenta', '', true);
do $$ declare r record; k bigint; dif text[] := '{}'; begin
  -- company_account_log no cuenta: al sembrar otra vez, los cinco acreedores ya existen antes de activar el plan y
  -- su subcuenta la da el plan (sin línea en ese historial), no la semilla. Las subcuentas son las mismas en número.
  for r in select t, n from _antes where t <> 'company_account_log' loop
    execute format('select count(*) from public.%I where account_id = %L', r.t, (select d.v from _d d where d.clave = 'cuenta')) into k;
    if k <> r.n then dif := dif || format('%s: %s antes, %s ahora', r.t, r.n, k); end if;
  end loop;
  if cardinality(dif) > 0 then raise exception 'PRUEBA DM1·8 · 4: la vuelta atrás no deja el doble como lo dejó la 1525: %', dif; end if;
  if exists (select 1 from pg_trigger where tgname in ('trg_journal_entry_inalterable', 'trg_journal_line_inalterable') and tgenabled = 'D') then
    raise exception 'PRUEBA DM1·8 · 4: el candado de los asientos se ha quedado apagado.';
  end if;
  raise notice 'PRUEBA DM1·8 Casa Lola · 4: la vuelta atrás deja el doble como lo dejó la 1525, tabla a tabla.';
end $$;
