-- supabase/migrations/20261130T0420_e05_catcher_ficha.sql
--
-- E05 · LA FICHA DE CATCHER MARKETPLACE, CON SU 410 Y SU GASTO (Julio, 21/10:
-- «Catcher Marketplace SL pasa a su propia 410, con su ficha y su NIF, y el
-- gasto en la 623, porque su comisión anual supera los 3.005,06 € del 347»;
-- 41000042 y 62300004 aprobadas y comprobadas por él como las siguientes
-- libres).
--
-- Medido en producción el 21/10 (solo lectura, Foodint, regla 9):
--   · la factura de Catcher de la 1.ª quincena de octubre (98416803…, 262,87 €,
--     en revisión) está sin proveedor: «Catcher no tiene ficha»;
--   · en Foodint no hay ninguna ficha con su NIF ni con «catcher» en el nombre;
--   · la 41000042 y la 62300004 no existen (la más alta de la 4100 es la
--     41000041 y de la 623, la 62300003).
--
-- Lo que hace, solo en Foodint (cuenta 51ad1792…, empresa 658728c0…):
--   1. La 41000042 «CATCHER MARKETPLACE SL» (de la 4100, como la 41000041) y
--      la 62300004 «CATCHER MARKETPLACE SERVICIOS DE PROFESIONALES
--      INDEPENDIENTES» (de la 623, como la 62300003 de Just Eat).
--   2. La ficha «Catcher Marketplace SL», con el NIF y el nombre de su
--      factura (issuer_*), NIF español de empresa. Su tercero lo crea el
--      disparador de siempre (party_desde_proveedor).
--   3. Sus dos enlaces: «principal» a la 41000042 y «gasto» a la 62300004.
--   4. Su factura de la quincena pasa a ser suya (supplier_id). Nada más de la
--      factura cambia.
-- Para entera si algo no está como se midió: la factura ya tiene proveedor,
-- hay una ficha con ese NIF, alguna de las dos cuentas ya existe.
--
-- No toca el camino del pedido. Cambia datos (inserta y un update): pide
-- «autorizo».
-- sin prueba con datos: Foodint no está en staging; su prueba con datos es el
-- ENSAYO de la tanda en producción (todo en una transacción y rollback).
-- Vuelta atrás: supabase/vuelta-atras/20261130T0420_e05_catcher_ficha.down.sql

do $$
declare
  a constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  f constant uuid := '98416803-9f78-411f-a95d-59c334533f05';
  v_fac public.supplier_invoice; v_plan text; v_sup uuid; v_410 uuid; v_623 uuid; n int;
begin
  if not exists (select 1 from public.company where id = e and account_id = a) then
    raise notice 'E05 Catcher: esta base no tiene a Foodint: nada que hacer.';
    return;
  end if;
  select * into v_fac from public.supplier_invoice where id = f and account_id = a and company_id = e;
  if v_fac.id is null then raise exception 'E05 Catcher: no está la factura de Catcher de la 1.ª quincena de octubre.'; end if;
  if v_fac.supplier_id is not null then raise exception 'E05 Catcher: su factura ya tiene proveedor: no se cambia nada.'; end if;
  if v_fac.issuer_name is distinct from 'Catcher Marketplace SL' or v_fac.issuer_tax_id is null or v_fac.issuer_tax_id !~ '^B[0-9]{8}$' then
    raise exception 'E05 Catcher: el emisor de la factura no es el medido (Catcher Marketplace SL, con un NIF B…).';
  end if;
  select count(*) into n from public.supplier where account_id = a and (tax_id = v_fac.issuer_tax_id or name ilike '%catcher%');
  if n > 0 then raise exception 'E05 Catcher: ya hay % ficha(s) con su NIF o su nombre: no se crea otra.', n; end if;
  select count(*) into n from public.company_account where account_id = a and company_id = e and code in ('41000042', '62300004');
  if n > 0 then raise exception 'E05 Catcher: la 41000042 o la 62300004 ya existen: no se crea nada.'; end if;
  select plan into v_plan from public.company_account where account_id = a and company_id = e and code = '41000041';
  if v_plan is null then raise exception 'E05 Catcher: no está la 41000041 de la que tomar el plan.'; end if;

  -- 1
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  values (a, e, v_plan, '41000042', '4100', 'CATCHER MARKETPLACE SL', 'own', 'manual', 'Tanda E05 Catcher')
  returning id into v_410;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
  values (a, e, v_plan, '62300004', '623', 'CATCHER MARKETPLACE SERVICIOS DE PROFESIONALES INDEPENDIENTES', 'own', 'manual', 'Tanda E05 Catcher')
  returning id into v_623;

  -- 2
  insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, entity_kind, is_active, created_by_name)
  values (a, 'Catcher Marketplace SL', 'Catcher Marketplace SL', v_fac.issuer_tax_id, 'nif_es', 'company', true, 'Tanda E05 Catcher')
  returning id into v_sup;

  -- 3
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (a, e, v_410, 'supplier', v_sup::text, 'principal', 'manual'),
         (a, e, v_623, 'supplier', v_sup::text, 'gasto', 'manual');

  -- 4
  update public.supplier_invoice set supplier_id = v_sup where id = f and account_id = a and supplier_id is null;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'E05 Catcher: la factura no ha pasado a la ficha (% filas).', n; end if;

  if not exists (select 1 from public.party_role where account_id = a and supplier_id = v_sup and role = 'supplier') then
    raise exception 'E05 Catcher: la ficha no tiene su tercero (party_desde_proveedor).';
  end if;
  raise notice 'E05 Catcher: ficha % con la 41000042 y la 62300004; su factura de 262,87 € es suya.', v_sup;
end $$;
