-- supabase/migrations/20261105T1141_s01p_alquileres_foodint.sql
--
-- S01p·15 · Los alquileres de Foodint, según Julio (05/11). Sin nombres de
-- personas (T11): «arrendador 1» es el de Carabanchel; «2», el de Alcalá; «3, 4
-- y 5», las tres de Plaza Castilla.
--
-- 1. Arrendador 1 (Carabanchel): su contrato, que se apunta solo desde
--    octubre. Renta 716,00 + IVA 21 %, el día 1, a sus cuentas de siempre
--    (62100000, 47200021, 47510000 y la suya, 41000027), en Carabanchel. Sin
--    retención hasta octubre: dijo que estaba exento y no mandó el certificado
--    («sin certificado, no hay exención»). Desde noviembre, el 19 % del 115. Lo
--    de enero a octubre no se toca aquí (va a la lista de la gestoría, con D).
--    Sin contrato subido: «falta el contrato», sin frenar el apunte. Su
--    alquiler esperado queda cubierto por el contrato: ya no se le pide factura.
-- 2. Arrendador 2 (Alcalá) manda factura: sigue esperándola. No se toca.
-- 3. Arrendadores 3, 4 y 5 (Plaza Castilla): el contrato se liquida el
--    30/09/2026 y no habrá facturas de octubre ni noviembre. Su alquiler
--    esperado termina el 30/09 (ends_on): el cierre de octubre ya no las pide, y
--    sigue diciendo que terminaron (regla 7). La fianza la corrige D en su tanda.
-- 4. Los apuntes de octubre (866,36, sin retención) y noviembre (730,32, con
--    136,04 de retención), propuestos, para que Julio los valide.
--
-- Cambia filas que existen (supplier_expected_invoice): va con autorizo.
-- Nada en el camino del pedido.

-- Plaza Castilla: el contrato se liquida el 30/09/2026 (en una base sin Foodint, no toca nada).
update public.supplier_expected_invoice
   set ends_on = '2026-09-30', updated_at = now(), updated_by_name = 'Julio (tanda S01p)'
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
   and kind = 'alquiler' and ends_on is null
   and id in ('42b1c16f-238d-4d09-8510-33e0a03a27ca', 'c7d5e755-e8c9-42d7-930f-7f6de6914ff1', 'bbb2a2e7-9e5b-463b-a899-785f448abc08');

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_emp constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_prov constant uuid := 'ff3504ee-fdb6-4ff7-b330-30e36b8ab25f';   -- arrendador 1
  v_esp  constant uuid := 'f2c13b5e-ee18-4281-8f1e-1508486e9b36';   -- su alquiler esperado
  v_loc  constant uuid := '92d7656e-082e-452a-8ebc-236b2d6ebf5f';   -- Foodint Carabanchel
  v_c uuid; v_party uuid; v_n int; v_oct uuid; v_nov uuid; v_t numeric;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01p alquileres: esta base no tiene Foodint; no se toca nada.'; return;
  end if;
  select p.id into v_party from public.party p join public.supplier s on s.account_id = p.account_id and s.tax_id = p.tax_id
   where s.id = v_prov and s.account_id = v_acc;
  if v_party is null then raise exception 'S01p alquileres: el arrendador 1 no tiene su tercero.'; end if;
  if (select count(*) from public.supplier_expected_invoice where id = v_esp and account_id = v_acc and supplier_id = v_prov and kind = 'alquiler' and covered_by_recurring_id is null) <> 1 then
    raise exception 'S01p alquileres: el alquiler esperado del arrendador 1 no es el medido: no se toca nada.';
  end if;
  if exists (select 1 from public.recurring_contract where account_id = v_acc and kind = 'alquiler') then
    raise exception 'S01p alquileres: Foodint ya tiene un contrato de alquiler: no se crea otro.';
  end if;

  insert into public.recurring_contract (account_id, company_id, kind, name, party_id, concept_contains, amount,
                                         expense_account, vat_account, withholding_account, creditor_account,
                                         vat_rate_id, withholding_rate_id, location_id, day_of_month, propose_from, withholding_since,
                                         is_active, created_by_name)
  select v_acc, v_emp, 'alquiler', 'Alquiler de Carabanchel (Camichi 4)', v_party, s.name, 716.00,
         '62100000', '47200021', '47510000', '41000027',
         (select id from public.tax_rate where code = 'iva_general' and rate = 21),
         (select id from public.withholding_rate where code = 'alquiler' and is_system and valid_to is null),
         v_loc, 1, '2026-10-01', '2026-11-01', true, 'Julio (tanda S01p)'
    from public.supplier s where s.id = v_prov
  returning id into v_c;

  update public.supplier_expected_invoice
     set covered_by_recurring_id = v_c, updated_at = now(), updated_by_name = 'Julio (tanda S01p)'
   where id = v_esp and account_id = v_acc;

  -- Plaza Castilla (la sentencia de arriba): los 3, terminados el 30/09.
  select count(*) into v_n from public.supplier_expected_invoice
   where account_id = v_acc and kind = 'alquiler' and ends_on = '2026-09-30'
     and id in ('42b1c16f-238d-4d09-8510-33e0a03a27ca', 'c7d5e755-e8c9-42d7-930f-7f6de6914ff1', 'bbb2a2e7-9e5b-463b-a899-785f448abc08');
  if v_n <> 3 then raise exception 'S01p alquileres: Plaza Castilla son 3 alquileres esperados y aquí salen %: no se toca nada.', v_n; end if;

  -- Octubre y noviembre, propuestos.
  v_oct := public._conta_alquiler_proponer(v_c, '2026-10-01');
  v_nov := public._conta_alquiler_proponer(v_c, '2026-11-01');
  select sum(credit) into v_t from public.journal_line where entry_id = v_oct and company_account_id = (select id from public.company_account where company_id = v_emp and code = '41000027');
  if v_t is distinct from 866.36 then raise exception 'S01p alquileres: octubre no sale a 866,36 (sale %).', v_t; end if;
  select sum(credit) into v_t from public.journal_line where entry_id = v_nov and company_account_id = (select id from public.company_account where company_id = v_emp and code = '41000027');
  if v_t is distinct from 730.32 then raise exception 'S01p alquileres: noviembre no sale a 730,32 (sale %).', v_t; end if;
  raise notice 'S01p alquileres: contrato de Carabanchel; octubre (866,36) y noviembre (730,32, con 136,04 de retención), propuestos; Plaza Castilla, terminado el 30/09.';
end $$;
