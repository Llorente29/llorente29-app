-- ============================================================================
-- C01 · Semillas para las CAPTURAS de la ficha. SOLO STAGING-CONTA.
-- ----------------------------------------------------------------------------
-- Deja a «Hermanos Ruiz» de la cuenta A (Taberna de Prueba Norte) como en la
-- maqueta aprobada (docs/conta/maquetas/Proveedor.dc.html): datos fiscales y de
-- pago completos, Ana Ruiz (pedidos) y Luis Martín (comercial), y cuatro
-- facturas: F-2026-0915 por pagar (vence el 24/10) y tres pagadas.
-- Le faltan, a propósito, lo mismo que en la maqueta: el certificado del banco
-- y el contacto de administración.
--
-- Todo inventado. El IBAN es el de ejemplo de CaixaBank que usan las pruebas
-- del núcleo (ES91 2100 0418 4502 0005 1332), con sus dígitos de control bien.
--
-- Va DESPUÉS de seed_c01_staging.sql y de las dos migraciones del C01.
-- Se puede volver a pasar: pone los mismos valores y no duplica nada.
-- Guarda: aborta si la base tiene alguna cuenta que no sea de prueba.
-- ============================================================================

do $$
declare
  a_cuenta constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  b_cuenta constant uuid := 'c01b0000-0000-4000-8000-00000000000b';
  a_user   constant uuid := 'c01a0000-0000-4000-8000-0000000000a1';
  a_local  constant uuid := 'c01a0000-0000-4000-8000-0000000000a2';
  a_ruiz   constant uuid := 'c01a0000-0000-4000-8000-0000000000a3';
  v_cat uuid;
begin
  if exists (select 1 from accounts where id not in (a_cuenta, b_cuenta)) then
    raise exception 'Semillas de capturas ABORTADAS: esta base tiene cuentas que no son de prueba. ¿Es staging-conta?';
  end if;
  select id into v_cat from expense_category where code = 'food_beverage';

  update supplier set
    legal_name = 'Hermanos Ruiz Distribución, S.L.',
    tax_id_type = 'nif_es', country_code = 'ES', entity_kind = 'company',
    tax_id_check_status = 'valid', tax_id_verified_at = now(), tax_id_checked_at = now(),
    fiscal_street = 'C/ Ejemplo 12', fiscal_postal_code = '28021', fiscal_city = 'Madrid', fiscal_province = 'Madrid',
    vat_regime = 'general', usual_vat_rates = '{10,21}', irpf_withholding_pct = null,
    expense_category_id = v_cat, default_location_id = null,
    payment_method = 'transfer', payment_terms_days = 30, payment_fixed_days = '{}',
    iban = 'ES9121000418450200051332', iban_verified_at = now(), bank_name = 'CaixaBank',
    health_registry_no = '40.012345/M'
  where id = a_ruiz and account_id = a_cuenta;

  -- La dirección vieja ya está repartida: su propuesta, confirmada.
  update supplier_proposal set status = 'confirmed', decided_at = now(), decided_by = a_user, decided_by_name = 'Admin Norte'
   where supplier_id = a_ruiz and field = 'fiscal_address' and status = 'pending';

  -- Contactos: el principal que creó la migración pasa a ser Ana Ruiz (pedidos).
  update supplier_contact set name = 'Ana Ruiz', role = 'orders', phone = '600 000 000', email = null,
         notes = null
   where supplier_id = a_ruiz and is_primary;
  insert into supplier_contact (id, account_id, supplier_id, name, role, phone, email, is_primary, created_by_name)
  values ('c01a0000-0000-4000-8000-0000000000c2', a_cuenta, a_ruiz, 'Luis Martín', 'sales', null, 'luis@ejemplo.test', false, 'Semillas C01')
  on conflict (id) do nothing;

  -- Facturas: la aprobada del seed vence el 24/10; tres más, pagadas.
  update supplier_invoice set due_date = date '2026-10-24'
   where account_id = a_cuenta and supplier_id = a_ruiz and invoice_number = 'F-2026-0915';
  insert into supplier_invoice (id, account_id, supplier_id, location_id, invoice_number, invoice_date, status,
    tax_base_total, tax_total, grand_total, created_by_name, approved_at, approved_by, approved_by_name,
    due_date, paid_at, paid_method, paid_by, paid_by_name)
  values
    ('c01a0000-0000-4000-8000-0000000000f1', a_cuenta, a_ruiz, a_local, 'F-2026-0871', date '2026-09-10', 'pagada',
     876.73, 87.67, 964.40, 'Semillas C01', now(), a_user, 'Admin Norte', date '2026-10-10', date '2026-09-30', 'transfer', a_user, 'Admin Norte'),
    ('c01a0000-0000-4000-8000-0000000000f2', a_cuenta, a_ruiz, a_local, 'F-2026-0802', date '2026-08-27', 'pagada',
     1002.50, 100.25, 1102.75, 'Semillas C01', now(), a_user, 'Admin Norte', date '2026-09-26', date '2026-09-24', 'transfer', a_user, 'Admin Norte'),
    ('c01a0000-0000-4000-8000-0000000000f3', a_cuenta, a_ruiz, a_local, 'F-2026-0760', date '2026-08-13', 'pagada',
     716.64, 71.66, 788.30, 'Semillas C01', now(), a_user, 'Admin Norte', date '2026-09-12', date '2026-09-10', 'transfer', a_user, 'Admin Norte')
  on conflict (id) do nothing;

  raise notice 'Capturas C01 OK: Hermanos Ruiz como la maqueta (% contactos, % facturas).',
    (select count(*) from supplier_contact where supplier_id = a_ruiz),
    (select count(*) from supplier_invoice where supplier_id = a_ruiz);
end $$;
