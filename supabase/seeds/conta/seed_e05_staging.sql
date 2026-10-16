-- supabase/seeds/conta/seed_e05_staging.sql
--
-- E05 · Las facturas de riders de Catcher en staging-conta, para la e2e y sus
-- capturas. SOLO STAGING. Todo inventado; nada copiado de producción. Se puede
-- volver a lanzar: ids y códigos fijos, y lo que ya está no se toca. Después
-- de la 0100–0130.
--
-- Cuenta A (empresa 3b34403a…), lo mismo que la tanda de datos de producción,
-- con datos de prueba:
--   · la 41000100 «Acreedores · RIDERS» y el proveedor genérico «Riders»;
--   · Catcher Marketplace (NIF inventado B00000125 —antes B00000055, que no pasaba
--     su control: seed_d01_nif_catcher_staging.sql lo arregla en lo sembrado—, el del ejemplo de las
--     pruebas) con su 41000201;
--   · la 40700001 «Saldo prepago Catcher», colgada de la 407;
--   · las dos tiendas del ejemplo → los dos primeros locales de A;
--   · la tarifa del portal, desde el 01/09/2026.
-- Como postgres: supplier_batch_store y supplier_rate no se escriben como
-- usuario (solo por sus funciones).

do $$
declare
  a      constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea     constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
  riders constant uuid := 'e0500000-0000-4000-8000-000000000001';
  catch  constant uuid := 'e0500000-0000-4000-8000-000000000002';
  v_plan text; v_ca uuid; v_s uuid; v_l1 uuid; v_l2 uuid;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'SEMILLA E05: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regclass('public.supplier_rate') is null then raise exception 'SEMILLA E05: faltan la 0120 y la 0130 en staging.'; end if;
  select plan into v_plan from public.company_account where company_id = ea limit 1;

  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name) values
    (a, ea, v_plan, '41000100', '4100', 'Acreedores · RIDERS', 'own', 'manual', 'semilla E05'),
    (a, ea, v_plan, '41000201', '4100', 'Catcher Marketplace SL', 'own', 'manual', 'semilla E05'),
    (a, ea, v_plan, '40700001', '407', 'Saldo prepago Catcher', 'own', 'manual', 'semilla E05')
  on conflict do nothing;

  insert into public.supplier (id, account_id, name, legal_name, is_active, created_by_name)
  values (riders, a, 'Riders', 'Riders', true, 'semilla E05') on conflict (id) do nothing;
  insert into public.supplier (id, account_id, name, legal_name, tax_id, is_active, created_by_name)
  values (catch, a, 'Catcher Marketplace', 'Catcher Marketplace SL', 'B00000125', true, 'semilla E05') on conflict (id) do nothing;

  for v_ca, v_s in select ca.id, x.s from (values ('41000100', riders), ('41000201', catch)) as x(code, s)
                     join public.company_account ca on ca.company_id = ea and ca.code = x.code loop
    if not exists (select 1 from public.company_account_link where company_id = ea and entity = 'supplier' and entity_id = v_s::text and role = 'principal') then
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
      values (a, ea, v_ca, 'supplier', v_s::text, 'principal', 'manual');
    end if;
  end loop;

  select id into v_l1 from public.locations where account_id = a order by created_at limit 1;
  select id into v_l2 from public.locations where account_id = a order by created_at offset 1 limit 1;
  insert into public.supplier_batch_store (account_id, company_id, provider, store_name, location_id, created_by_name) values
    (a, ea, 'catcher', 'FoodInt Camichi', v_l1, 'semilla E05'),
    (a, ea, 'catcher', 'FoodInt Florencio Llorente', coalesce(v_l2, v_l1), 'semilla E05')
  on conflict do nothing;

  insert into public.supplier_rate (account_id, company_id, provider, valid_from, params, source, created_by_name)
  values (a, ea, 'catcher', '2026-09-01',
          '{"tramos":[{"hastaKm":1,"precio":4},{"hastaKm":2,"precio":4.2},{"hastaKm":3,"precio":4.7}],"porKmExtra":0.5,"maximo":12,"bonoLluviaPct":10,"bonoDemandaPct":10,"bonoMaxPct":15,"pedidoExtra":2.5,"comisionPedido":0.79}',
          'portal', 'semilla E05')
  on conflict do nothing;

  raise notice 'SEMILLA E05: cuentas % de 3, proveedores % de 2, tiendas %, tarifas %.',
    (select count(*) from public.company_account where company_id = ea and code in ('41000100', '41000201', '40700001')),
    (select count(*) from public.supplier where id in ('e0500000-0000-4000-8000-000000000001', 'e0500000-0000-4000-8000-000000000002')),
    (select count(*) from public.supplier_batch_store where company_id = ea), (select count(*) from public.supplier_rate where company_id = ea);
end $$;
