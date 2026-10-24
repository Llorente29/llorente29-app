-- supabase/migrations/20261125T0310_i01d_proveedores_foodint.sql
--
-- I01d · EL PAÍS DE LOS CINCO PROVEEDORES EXTRANJEROS DE FOODINT (confirmado
-- por Julio el 20/10): Trypleez (PT), Vercel (US), Supabase (SG), Anthropic
-- Ireland (IE) y HubRise (FR). Solo Foodint (cuenta 51ad1792…, empresa
-- 658728c0…; regla 9); en cualquier otra base no hace nada.
--
--   · Trypleez ya tiene ficha (con país ES y sin NIF): país PT y su NIF-IVA,
--     el de su factura en el libro de Diez con «PT» delante.
--   · Los otros cuatro NO tienen ficha de proveedor: solo están en el libro de
--     Diez y en el plan, cada uno con su subcuenta 410 de su mismo nombre (las
--     41000035 a 41000038, sin enlazar). Se dan de alta con ese nombre, su país,
--     el NIF de sus facturas en el libro (si lo traen) y su subcuenta enlazada:
--     así sus próximas facturas se proponen con su autoliquidación.
--   · Los NIF-IVA europeos quedan «sin comprobar»: la ficha pregunta a VIES al
--     abrirse (conta-vies-check) y dice lo que contesta.
--
-- Ningún NIF va escrito aquí: se copian del libro de IVA de Foodint. Cada paso
-- comprueba que encuentra exactamente lo que espera; si no, para y no cambia
-- nada. No toca el camino del pedido (supplier y company_account_link no lo
-- son para Foodint de Sumied: sus proveedores de Cocina no cambian).
-- Vuelta atrás: supabase/vuelta-atras/20261125T0310_i01d_proveedores_foodint.down.sql

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_emp constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_try constant uuid := '0277a82e-fe98-42b1-9e2f-2eef1e0f6a26';
  p record; v_cta uuid; v_n int; v_nif text; v_s uuid;
begin
  if not exists (select 1 from public.company where id = v_emp and account_id = v_acc) then
    raise notice 'I01d 0310: esta base no tiene a Foodint: no hay nada que rellenar.';
    return;
  end if;

  -- 1 · Trypleez: Portugal y su NIF-IVA (el NIF portugués de su factura, con PT delante).
  select 'PT' || regexp_replace(max(v.counterpart_tax_id), '[^0-9]', '', 'g'), count(distinct v.counterpart_tax_id)
    into v_nif, v_n
    from public.vat_book_entry v
   where v.account_id = v_acc and v.company_id = v_emp and v.counterpart_name = 'TRYPLEEZ, SA' and v.counterpart_tax_id is not null;
  if v_n <> 1 or v_nif !~ '^PT[0-9]{9}$' then
    raise exception 'I01d 0310: el libro de Foodint no trae un NIF portugués único de Trypleez (% distintos): no se cambia nada.', v_n;
  end if;
  update public.supplier
     set country_code = 'PT', tax_id_type = 'vat_eu', tax_id = coalesce(tax_id, v_nif),
         tax_id_check_status = 'pending', tax_id_checked_at = null, tax_id_verified_at = null, updated_at = now()
   where id = v_try and account_id = v_acc and upper(name) = 'TRYPLEEZ, SA';
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'I01d 0310: la ficha de Trypleez no está como se midió (% filas): no se cambia nada.', v_n; end if;

  -- 2 · Los cuatro sin ficha: alta con su subcuenta 410 de Diez.
  for p in select * from (values
      ('ANTHROPIC IRELAND LIMITED', 'IE', 'vat_eu'),
      ('HUBRISE SASU',              'FR', 'vat_eu'),
      ('SUPABASE PTE. LTD.',        'SG', 'foreign'),
      ('VERCEL INC.',               'US', 'foreign')) x(nombre, pais, tipo)
  loop
    if exists (select 1 from public.supplier where account_id = v_acc and (upper(name) = p.nombre or upper(legal_name) = p.nombre)) then
      raise exception 'I01d 0310: % ya tiene ficha de proveedor (no se midió así): no se cambia nada.', p.nombre;
    end if;
    select count(*), min(a.id::text)::uuid into v_n, v_cta
      from public.company_account a
     where a.account_id = v_acc and a.company_id = v_emp and a.code like '410%' and upper(a.name) = p.nombre
       and not exists (select 1 from public.company_account_link l where l.company_account_id = a.id);
    if v_n <> 1 then raise exception 'I01d 0310: % no tiene una subcuenta 410 suya sin enlazar (% encontradas): no se cambia nada.', p.nombre, v_n; end if;
    select max(v.counterpart_tax_id), count(distinct v.counterpart_tax_id) into v_nif, v_n
      from public.vat_book_entry v
     where v.account_id = v_acc and v.company_id = v_emp and v.counterpart_name = p.nombre and v.counterpart_tax_id is not null;
    if v_n > 1 then raise exception 'I01d 0310: % trae % NIF distintos en el libro: no se cambia nada.', p.nombre, v_n; end if;
    if p.tipo = 'vat_eu' and (v_nif is null or upper(left(v_nif, 2)) <> p.pais) then
      raise exception 'I01d 0310: el libro no trae un NIF-IVA de % para % (trae %): no se cambia nada.', p.pais, p.nombre, coalesce(left(v_nif, 2) || '…', 'ninguno');
    end if;
    insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, country_code, tax_id_check_status, is_active, created_by_name)
    values (v_acc, p.nombre, p.nombre, v_nif, case when v_nif is not null then p.tipo end, p.pais,
            case when p.tipo = 'vat_eu' then 'pending' end, true, 'Sumied · I01d (alta de los proveedores extranjeros de Diez)')
    returning id into v_s;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_acc, v_emp, v_cta, 'supplier', v_s::text, 'principal', 'manual');
  end loop;
  raise notice 'I01d 0310: Trypleez con país PT y su NIF-IVA; Anthropic Ireland (IE), HubRise (FR), Supabase (SG) y Vercel (US) dados de alta con su subcuenta 410.';
end $$;
