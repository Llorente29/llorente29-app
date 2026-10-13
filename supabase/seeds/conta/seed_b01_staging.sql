-- supabase/seeds/conta/seed_b01_staging.sql
--
-- B01 · Bancos: lo que necesita la demostración del motor en staging
-- (tests/e2e/conta/b01/motor.spec.ts). SOLO STAGING; datos inventados; todo
-- con «B01» en el nombre, en la empresa de A, sin tocar nada de lo que miran
-- las otras e2e (sus facturas, sus liquidaciones, sus bancos). Se puede
-- volver a lanzar: ids fijos y «on conflict do nothing».
--
--   · Tres bancos (como los tres de Foodint): «Banco B01 · Norte», «Sur» y
--     «Mercado», cada uno con su IBAN de ejemplo (válido, de una cuenta que no
--     es de nadie) y su cuenta 572 en el plan (57200911, 57200912, 57200913).
--   · Un proveedor «Suministros B01 del Norte» con su cuenta 400 (40000911) y
--     dos facturas aprobadas: B01-0477 (498,88) y B01-0478 (600,00).
--   · Una liquidación del canal de A (en staging se llama «Glovo») del 01 al 07/10,
--     neto 3.412,18, sin cobrar.
--   · Respuesta 4: el nombre corto de cada banco («B01 Norte»…) y su ASIENTO DE
--     APERTURA a 30/09 (propuesto, origen «opening»): el saldo inicial del
--     extracto inventado (45.000,00 · 8.000,00 · 2.500,00). Sin él, contabilidad
--     empezaba en cero y la pantalla decía «difiere» sin que nada difiriera.

do $$
declare
  a_cuenta  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  a_empresa constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  a_local   constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  plat      constant uuid := 'e0200000-0000-4000-8000-00000000a0c1';
  prov      constant uuid := 'b0100000-0000-4000-8000-000000000001';
  r record; v_ca uuid;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla B01: esta base tiene cuentas de producción. No se siembra nada.';
  end if;
  if to_regprocedure('public.bank_casar(uuid,jsonb,text,text,jsonb,text,uuid)') is null then
    raise exception 'Semilla B01: faltan las funciones de bancos (20261101T0110). Aplícalas antes.';
  end if;

  -- Las cuentas del plan: copia de la forma de 57200001 / 40000001 con otro código y nombre.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, keywords, kind, status, is_common, source, created_by_name)
  select ca.account_id, ca.company_id, ca.plan, x.code, ca.template_code, x.name, x.name, ca.keywords, ca.kind, ca.status, ca.is_common, ca.source, 'Semilla B01'
    from public.company_account ca,
         (values ('57200911', 'Bancos · Banco B01 Norte'), ('57200912', 'Bancos · Banco B01 Sur'), ('57200913', 'Bancos · Banco B01 Mercado')) as x(code, name)
   where ca.company_id = a_empresa and ca.code = '57200001'
     and not exists (select 1 from public.company_account y where y.company_id = a_empresa and y.code = x.code);
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, keywords, kind, status, is_common, source, created_by_name)
  select ca.account_id, ca.company_id, ca.plan, '40000911', ca.template_code, 'Proveedores · Suministros B01 del Norte', 'Suministros B01 del Norte',
         ca.keywords, ca.kind, ca.status, ca.is_common, ca.source, 'Semilla B01'
    from public.company_account ca
   where ca.company_id = a_empresa and ca.code = '40000001'
     and not exists (select 1 from public.company_account y where y.company_id = a_empresa and y.code = '40000911');

  -- Los tres bancos, enlazados a su 572.
  for r in select * from (values
      ('b0100000-0000-4000-8000-0000000000b1'::uuid, 'Banco B01 · Norte', 'ES0201829101320000000011', '57200911', null::uuid),
      ('b0100000-0000-4000-8000-0000000000b2'::uuid, 'Banco B01 · Sur', 'ES6501829102870000000012', '57200912', a_local),
      ('b0100000-0000-4000-8000-0000000000b3'::uuid, 'Banco B01 · Mercado', 'ES6401829103210000000013', '57200913', null::uuid)) as t(id, nombre, iban, codigo, local) loop
    insert into public.treasury_account (id, account_id, company_id, kind, name, iban, pgc_hint, is_default, is_active, location_id)
    values (r.id, a_cuenta, a_empresa, 'bank', r.nombre, r.iban, '572', false, true, r.local)
    on conflict (id) do nothing;
    select id into v_ca from public.company_account where company_id = a_empresa and code = r.codigo;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (a_cuenta, a_empresa, v_ca, 'bank_account', r.id::text, 'principal', 'manual')
    on conflict (company_id, entity, entity_id, role) do nothing;
  end loop;

  -- El proveedor, su cuenta y sus dos facturas aprobadas.
  insert into public.supplier (id, account_id, name, legal_name, created_by_name)
  values (prov, a_cuenta, 'Suministros B01 del Norte', 'Suministros B01 del Norte, S.L.', 'Semilla B01')
  on conflict (id) do nothing;
  select id into v_ca from public.company_account where company_id = a_empresa and code = '40000911';
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (a_cuenta, a_empresa, v_ca, 'supplier', prov::text, 'principal', 'manual')
  on conflict (company_id, entity, entity_id, role) do nothing;
  insert into public.supplier_invoice (id, account_id, supplier_id, location_id, invoice_number, invoice_date, status,
    tax_base_total, tax_total, grand_total, source, created_by_name, read_iban)
  values
    ('b0100000-0000-4000-8000-000000000f77', a_cuenta, prov, a_local, 'B01-0477', date '2026-09-28', 'aprobada', 412.30, 86.58, 498.88, 'manual', 'Semilla B01', null),
    ('b0100000-0000-4000-8000-000000000f78', a_cuenta, prov, a_local, 'B01-0478', date '2026-10-01', 'aprobada', 495.87, 104.13, 600.00, 'manual', 'Semilla B01', null)
  on conflict (id) do nothing;

  -- La liquidación del canal de A, sin cobrar.
  insert into public.channel_settlement (id, account_id, channel_id, location_id, settlement_ref, period_from, period_to, settlement_date, period_grain, currency,
    orders_count, gross_sales, commission, net_payout, source, import_key, needs_review, flow_type, created_by_name)
  values ('b0100000-0000-4000-8000-0000000000c1', a_cuenta, plat, a_local, 'B01-LIQ-0107', date '2026-10-01', date '2026-10-07', date '2026-10-08', 'week', 'EUR',
          212, 4120.40, 708.22, 3412.18, 'semilla_b01', 'semilla_b01:0107', false, 'own', 'Semilla B01')
  on conflict (id) do nothing;

  -- Respuesta 4: nombre corto (la columna es de la 0150) y asiento de apertura de cada banco.
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'treasury_account' and column_name = 'short_name') then
    update public.treasury_account set short_name = x.corto
      from (values ('b0100000-0000-4000-8000-0000000000b1'::uuid, 'B01 Norte'), ('b0100000-0000-4000-8000-0000000000b2'::uuid, 'B01 Sur'),
                   ('b0100000-0000-4000-8000-0000000000b3'::uuid, 'B01 Mercado')) as x(id, corto)
     where treasury_account.id = x.id and treasury_account.short_name is null;
  end if;
  for r in select * from (values
      ('b0100000-0000-4000-8000-0000000000b1'::uuid, 'Banco B01 Norte', '57200911', 45000.00),
      ('b0100000-0000-4000-8000-0000000000b2'::uuid, 'Banco B01 Sur', '57200912', 8000.00),
      ('b0100000-0000-4000-8000-0000000000b3'::uuid, 'Banco B01 Mercado', '57200913', 2500.00)) as t(id, nombre, codigo, saldo) loop
    -- _journal_entry_proponer desduplica por (origen, id): volver a sembrar no repite el asiento.
    perform public._journal_entry_proponer(a_empresa,
      jsonb_build_object('fecha', '2026-09-30', 'series', 3, 'concepto', 'Saldo inicial del banco · ' || r.nombre,
        'source_type', 'opening', 'source_id', r.id, 'confianza', 'seguro', 'porque', 'Semilla B01: el saldo del extracto inventado el 30/09.'),
      jsonb_build_array(jsonb_build_object('cuenta', r.codigo, 'debe', r.saldo, 'haber', 0, 'comun', true),
                        jsonb_build_object('cuenta', '10000000', 'debe', 0, 'haber', r.saldo, 'comun', true)),
      '{}', 'Semilla B01', null);
  end loop;
  -- Con la fecha de creación de su día (30/09), no la de hoy: «Lo que he hecho yo»
  -- del libro diario enseña las 5 últimas cosas, y tres aperturas recién creadas
  -- desplazaban lo que miran las e2e del C04 (lo cazó su e2e el 13/10, por mí).
  update public.journal_entry set created_at = timestamptz '2026-09-30 08:00:00+02'
   where company_id = a_empresa and source_type = 'opening' and status = 'propuesto'
     and source_id in ('b0100000-0000-4000-8000-0000000000b1', 'b0100000-0000-4000-8000-0000000000b2', 'b0100000-0000-4000-8000-0000000000b3')
     and created_at > timestamptz '2026-09-30 08:00:00+02';

  raise notice 'Semilla B01: tres bancos (57200911–13), Suministros B01 del Norte con B01-0477 y B01-0478, y la liquidación B01-LIQ-0107 (3.412,18); nombre corto y apertura a 30/09.';
end $$;
