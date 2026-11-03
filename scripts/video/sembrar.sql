-- scripts/video/sembrar.sql — V01 · lo que el vídeo necesita, en la empresa A del CARRIL.
--
--   psql "$DB_URL" -1 -v ON_ERROR_STOP=1 -v cuenta=<uuid> -v empresa=<uuid> -f scripts/video/sembrar.sql
--
-- SOLO STAGING y solo en el carril de este run: la cuenta del carril se borra
-- entera al acabar (scripts/e2e/carril.sh soltar), y con ella todo lo de aquí.
-- Nunca la plantilla: si la cuenta no es de un carril (su segundo grupo es
-- 0000), para.
--
-- Datos inventados que parecen de verdad (T11): nombres de proveedor de
-- hostelería sin personas, NIF de ceros con su control, IBAN del banco 9999.
-- La tercera factura (la que se lee en el paso 2) la crea el guion por la API,
-- con su PDF, como la crearía la lectura (scripts/video/guion.mjs).

\set ON_ERROR_STOP 1

select set_config('video.cuenta', :'cuenta', false), set_config('video.empresa', :'empresa', false);

do $$
begin
  if split_part(current_setting('video.cuenta'), '-', 2) = '0000' then
    raise exception 'V01: % es la plantilla, no un carril. No se siembra nada.', current_setting('video.cuenta');
  end if;
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'V01: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
end $$;

-- 1 · La empresa, la cuenta y la persona, con nombre de bar de verdad.
update public.company set trade_name = 'Taberna del Mercado', legal_name = 'Taberna del Mercado, S.L.', tax_id = 'B00000042'
 where id = :'empresa' and account_id = :'cuenta';
update public.accounts set name = 'Taberna del Mercado' where id = :'cuenta';
update public.user_profiles set display_name = 'Administración' where account_id = :'cuenta' and display_name = 'Admin Norte';
update public.locations set name = 'Taberna del Mercado' where account_id = :'cuenta' and name = 'Norte Centro';

-- 2 · El Revolut del sandbox, con su nombre de cuenta de empresa, y sin los
--     movimientos del sandbox (traen nombres de personas inventadas por Revolut).
update public.treasury_account t set name = 'Revolut Business'
  from public.bank_aggregator_link l
 where l.treasury_account_id = t.id and l.provider = 'revolut' and t.company_id = :'empresa';
delete from public.bank_movement m
 using public.bank_aggregator_link l
 where l.treasury_account_id = m.treasury_account_id and l.provider = 'revolut' and m.company_id = :'empresa'
   and not exists (select 1 from public.bank_match b where b.movement_id = m.id);
-- Y sus extractos (con el saldo del sandbox): sin ellos, Movimientos no compara
-- con un saldo que ya no tiene sus movimientos.
delete from public.bank_statement st
 using public.bank_aggregator_link l
 where l.treasury_account_id = st.treasury_account_id and l.provider = 'revolut' and st.company_id = :'empresa'
   and not exists (select 1 from public.bank_movement m where m.statement_id = st.id);

-- 3 · Los otros nombres de prueba que salen en Pagos, por nombres creíbles.
update public.supplier set name = 'Suministros Hosteleros del Norte', legal_name = 'Suministros Hosteleros del Norte, S.L.'
 where account_id = :'cuenta' and name = 'Suministros B01 del Norte';
update public.supplier set name = 'Panadería La Espiga' where account_id = :'cuenta' and name = 'Panadería Luna';
update public.supplier set name = 'Distribuciones Ruiz', legal_name = 'Distribuciones Ruiz, S.L.' where account_id = :'cuenta' and name = 'Hermanos Ruiz';

-- 4 · Los tres proveedores del vídeo: tres de la plantilla, con otro nombre,
--     su NIF, su IBAN y transferencia a 15 días. Cada uno con su subcuenta 400
--     (si no la tiene, una copia de la forma de la 40000001).
create temp table _p (viejo text, nombre text, razon text, nif text, iban text, codigo text) on commit drop;
insert into _p values
  ('Mayorista Prueba Alfa',            'Frutas y Verduras La Huerta', 'Frutas y Verduras La Huerta, S.L.', 'B00000018', :'iban1', '40000921'),
  ('Carnes Prueba del Valle, S.L.',    'Cárnicas del Centro',         'Cárnicas del Centro, S.L.',         'B00000026', :'iban2', '40000922'),
  ('Bodega Prueba Ribera, S.L.',       'Bebidas Sierra Norte',        'Bebidas Sierra Norte, S.A.',        'A00000034', :'iban3', '40000923');

do $$
declare p record; s uuid; ca uuid; e uuid := current_setting('video.empresa')::uuid; c uuid := current_setting('video.cuenta')::uuid;
begin
  for p in select * from _p loop
    select id into s from public.supplier where account_id = c and name = p.viejo;
    if s is null then raise exception 'V01: no está el proveedor «%» en el carril.', p.viejo; end if;
    -- Otro proveedor del carril con el mismo NIF no puede quedar (la ficha avisaría).
    update public.supplier set tax_id = null where account_id = c and tax_id = p.nif and id <> s;
    update public.supplier set name = p.nombre, legal_name = p.razon, tax_id = p.nif, iban = p.iban,
           payment_method = 'transfer', payment_terms_days = 15
     where id = s;
    if not exists (select 1 from public.company_account_link l where l.company_id = e and l.entity = 'supplier' and l.entity_id = s::text and l.role = 'principal') then
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, keywords, kind, status, is_common, source, created_by_name)
      select ca2.account_id, ca2.company_id, ca2.plan, p.codigo, ca2.template_code, 'Proveedores · ' || p.nombre, p.nombre, ca2.keywords, ca2.kind, ca2.status, ca2.is_common, ca2.source, 'Vídeo V01'
        from public.company_account ca2 where ca2.company_id = e and ca2.code = '40000001'
         and not exists (select 1 from public.company_account y where y.company_id = e and y.code = p.codigo);
      select id into ca from public.company_account where company_id = e and code = p.codigo;
      if ca is null then raise exception 'V01: no se ha podido crear la subcuenta % (¿falta la 40000001 en el plan?).', p.codigo; end if;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
      values (c, e, ca, 'supplier', s::text, 'principal', 'manual');
    else
      update public.company_account a set name = 'Proveedores · ' || p.nombre, plain_name = p.nombre
        from public.company_account_link l
       where l.company_id = e and l.entity = 'supplier' and l.entity_id = s::text and l.role = 'principal' and a.id = l.company_account_id;
    end if;
  end loop;
end $$;

-- 5 · Las dos facturas aprobadas de Cárnicas y Bebidas (la de La Huerta la crea el guion).
--     Fecha: hace 12 días; vencen en 3 (salen arriba en Pagos, «esta semana»).
insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, doc_kind, invoice_number, invoice_date, due_date,
  status, tax_base_total, tax_total, grand_total, source, payment_method, created_by_name, notes)
select :'cuenta', :'empresa', s.id, (select id from public.locations where account_id = :'cuenta' order by name limit 1), 'invoice',
       x.numero, current_date - 12, current_date + 3, 'aprobada', x.base, x.iva, x.total, 'ocr', 'transfer', 'Vídeo V01', 'Vídeo V01 (datos inventados)'
  from (values ('Cárnicas del Centro', 'CC-26-0942', 703.25, 70.33, 773.58),
               ('Bebidas Sierra Norte', 'SN/2026/3310', 472.80, 92.47, 565.27)) as x(proveedor, numero, base, iva, total)
  join public.supplier s on s.account_id = :'cuenta' and s.name = x.proveedor;

-- 6 · (03/11) La plantilla trae ahora facturas de demostración del B01 (otra sesión) que vencen
--     esta semana o ya han vencido, de proveedores «… Prueba …». En el carril, y solo para el vídeo:
--     «Pagar lo de esta semana» tiene que marcar las tres del vídeo y nada más. Las demás por pagar
--     pasan a vencer dentro de tres semanas (salvo las de tarjeta o domiciliadas, que no entran nunca).
update public.supplier_invoice si set due_date = current_date + 21
  from public.supplier s
 where s.id = si.supplier_id and si.account_id = :'cuenta' and si.status = 'aprobada' and si.paid_at is null
   and si.due_date is not null and si.due_date <= current_date + 7
   and si.invoice_number not in ('CC-26-0942', 'SN/2026/3310', 'FV-2026/1187')
   and coalesce(si.payment_method, s.payment_method, 'transfer') not in ('card', 'direct_debit');
-- Y los nombres de proveedor con «Prueba», sin él (los que salen en Pagos).
update public.supplier set
  name = case
    when name ilike 'Bebidas Prueba Sur%' then 'Bebidas del Sur'
    when name ilike 'Carnes Prueba Centro%' then 'Carnes Centro'
    when name ilike 'Verduras Prueba%' then 'Verduras La Vega'
    when name ilike 'Panadería de Prueba%' then 'Panadería El Horno'
    when name ilike 'Hielo Prueba%' then 'Hielos del Norte'
    when name ilike 'Limpiezas Prueba%' then 'Limpiezas Brillo'
    else trim(regexp_replace(name, '\s*\mPrueba\M', '', 'g')) end,
  legal_name = case when legal_name is null then null else trim(regexp_replace(legal_name, '\s*\mPrueba\M', '', 'g')) end
 where account_id = :'cuenta' and (name ilike '%prueba%' or legal_name ilike '%prueba%');

select s.name, s.tax_id, right(s.iban, 4) as iban4,
       (select a.code from public.company_account_link l join public.company_account a on a.id = l.company_account_id
         where l.company_id = :'empresa' and l.entity = 'supplier' and l.entity_id = s.id::text and l.role = 'principal') as subcuenta
  from public.supplier s where s.account_id = :'cuenta' and s.name in (select nombre from _p) order by s.name;
