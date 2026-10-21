-- supabase/vuelta-atras/20261130T0420_e05_catcher_ficha.down.sql
--
-- Vuelta atrás de la 0420 (solo Foodint): la factura de Catcher vuelve a estar
-- sin proveedor; fuera sus dos enlaces, la ficha, su tercero y las dos cuentas.
-- Freno: si la 41000042 o la 62300004 ya tienen apuntes, o la ficha ya tiene
-- otras facturas o albaranes, no se toca nada (se perdería trabajo hecho).
--
-- sin prueba con datos: solo actúa sobre Foodint (cuenta 51ad1792…), que no
-- está en staging; su prueba con datos es el ENSAYO de la tanda en producción.

do $$
declare
  a constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  f constant uuid := '98416803-9f78-411f-a95d-59c334533f05';
  v_sup uuid; v_party uuid; n int; m int;
begin
  if not exists (select 1 from public.company where id = e and account_id = a) then
    raise notice 'E05 Catcher (vuelta atrás): esta base no tiene a Foodint: nada que deshacer.';
    return;
  end if;
  select id into v_sup from public.supplier where account_id = a and created_by_name = 'Tanda E05 Catcher' and name = 'Catcher Marketplace SL';
  if v_sup is null then raise notice 'E05 Catcher (vuelta atrás): no está la ficha de la tanda: nada que deshacer.'; return; end if;
  select count(*) into n from public.journal_line l join public.company_account ca on ca.id = l.company_account_id
   where ca.account_id = a and ca.company_id = e and ca.code in ('41000042', '62300004');
  select (select count(*) from public.supplier_invoice where account_id = a and supplier_id = v_sup and id <> f)
       + (select count(*) from public.goods_receipt where account_id = a and supplier_id = v_sup) into m;
  if n > 0 or m > 0 then
    raise exception 'VUELTA ATRÁS 0420 PARADA: las cuentas tienen % apunte(s) y la ficha % documento(s) más: no se toca nada.', n, m using errcode = 'P0001';
  end if;
  update public.supplier_invoice set supplier_id = null where id = f and account_id = a and supplier_id = v_sup;
  delete from public.company_account_link where account_id = a and company_id = e and entity = 'supplier' and entity_id = v_sup::text;
  select party_id into v_party from public.party_role where account_id = a and supplier_id = v_sup and role = 'supplier';
  delete from public.party_role where account_id = a and supplier_id = v_sup;
  delete from public.supplier where id = v_sup and account_id = a;
  if v_party is not null and not exists (select 1 from public.party_role where party_id = v_party) then
    delete from public.party where id = v_party and account_id = a;
  end if;
  delete from public.company_account where account_id = a and company_id = e and code in ('41000042', '62300004') and created_by_name = 'Tanda E05 Catcher';
  raise notice 'E05 Catcher (vuelta atrás): fuera la ficha, sus enlaces, su tercero y las dos cuentas; su factura, otra vez sin proveedor.';
end $$;
