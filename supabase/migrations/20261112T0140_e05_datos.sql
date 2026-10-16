-- supabase/migrations/20261112T0140_e05_datos.sql
--
-- E05 · Los datos de Foodint para las quincenas de Catcher (Julio, 14–15/10).
-- Va en la misma tanda que la 0100–0130, después de ellas. Solo añade filas
-- (ninguna se cambia ni se borra); si ya está, no hace nada. Todo con
-- account_id (regla 9): Foodint 51ad1792…, empresa Llorente29 Food 658728c0….
--
--   1. La 40700001 «Saldo prepago Catcher» (el nombre de Diez C0008, tal cual),
--      colgada de la 407, como la 40700000 que ya hay.
--   2. El gasto del proveedor «Riders» (el de la 41000100): la 62400001
--      «Transportes reparto ventas», la de las 139 de riders de septiembre en Diez.
--   3. Las tiendas de Catcher → los locales: «FoodInt Camichi» = Foodint
--      Carabanchel y «FoodInt Florencio Llorente» = Foodint Alcalá.
--   4. La tarifa del portal desde el 01/09/2026: 4,00 € hasta 1 km, 4,20 € de 1
--      a 2, 4,70 € de 2 a 3, 0,50 €/km de más hasta 12 €, lluvia 10 %, demanda
--      10 %, juntas como mucho 15 %, 2,50 € el pedido extra y 0,79 € de
--      comisión por pedido (sin IVA).
-- Catcher Marketplace no tiene ficha: la propone la primera quincena que se
-- suba, y su 410 se le pone en su ficha antes de proponer el pago.
-- Vuelta atrás: supabase/vuelta-atras/20261112T0140_e05_datos.down.sql.

do $$
declare
  a  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  e  constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_plan text; v_riders text; v_gasto uuid; v_carab uuid; v_alcala uuid; n int;
begin
  if not exists (select 1 from public.company where id = e and account_id = a) then
    raise exception 'E05 datos: la empresa no es de esa cuenta.';
  end if;
  select plan into v_plan from public.company_account where account_id = a and company_id = e and code = '40700000';
  if v_plan is null then raise exception 'E05 datos: no está la 40700000 de la que colgar la 40700001.'; end if;

  -- 1
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  select a, e, v_plan, '40700001', '407', 'Saldo prepago Catcher', 'own', 'manual', 'Tanda E05'
   where not exists (select 1 from public.company_account where account_id = a and company_id = e and code = '40700001');

  -- 2
  select l.entity_id into v_riders from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id and ca.account_id = l.account_id
   where l.account_id = a and l.company_id = e and l.entity = 'supplier' and l.role = 'principal' and ca.code = '41000100';
  select count(*) into n from public.company_account_link l join public.company_account ca on ca.id = l.company_account_id and ca.account_id = l.account_id
   where l.account_id = a and l.company_id = e and l.entity = 'supplier' and l.role = 'principal' and ca.code = '41000100';
  if n <> 1 then raise exception 'E05 datos: la 41000100 tiene % proveedores; tiene que ser uno, «Riders».', n; end if;
  select id into v_gasto from public.company_account where account_id = a and company_id = e and code = '62400001';
  if v_gasto is null then raise exception 'E05 datos: no está la 62400001.'; end if;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select a, e, v_gasto, 'supplier', v_riders, 'gasto', 'manual'
   where not exists (select 1 from public.company_account_link where account_id = a and company_id = e and entity = 'supplier' and entity_id = v_riders and role = 'gasto');

  -- 3 · Por nombre, dentro de la cuenta, y solo si hay exactamente uno.
  select count(*), max(id::text)::uuid into n, v_carab from public.locations where account_id = a and name = 'Foodint Carabanchel';
  if n <> 1 then raise exception 'E05 datos: % locales «Foodint Carabanchel» en la cuenta.', n; end if;
  select count(*), max(id::text)::uuid into n, v_alcala from public.locations where account_id = a and name = 'Foodint Alcalá';
  if n <> 1 then raise exception 'E05 datos: % locales «Foodint Alcalá» en la cuenta.', n; end if;
  insert into public.supplier_batch_store (account_id, company_id, provider, store_name, location_id, created_by_name) values
    (a, e, 'catcher', 'FoodInt Camichi', v_carab, 'Tanda E05'),
    (a, e, 'catcher', 'FoodInt Florencio Llorente', v_alcala, 'Tanda E05')
  on conflict do nothing;

  -- 4
  insert into public.supplier_rate (account_id, company_id, provider, valid_from, params, source, created_by_name)
  values (a, e, 'catcher', '2026-09-01',
          '{"tramos":[{"hastaKm":1,"precio":4},{"hastaKm":2,"precio":4.2},{"hastaKm":3,"precio":4.7}],"porKmExtra":0.5,"maximo":12,"bonoLluviaPct":10,"bonoDemandaPct":10,"bonoMaxPct":15,"pedidoExtra":2.5,"comisionPedido":0.79}',
          'portal', 'Tanda E05')
  on conflict do nothing;
end $$;
