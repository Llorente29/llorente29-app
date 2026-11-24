-- supabase/seeds/conta/seed_k13_calco_staging.sql
--
-- ============================================================================
-- K13 · Las recibidas de la e2e de calco (tests/e2e/conta/k13/calco.spec.ts), en el restaurante de la cuenta del núcleo
-- (semilla K11b). SOLO STAGING. La e2e solo las abre y mide: no escribe nada.
-- ----------------------------------------------------------------------------
-- Como la maqueta 17b: una línea de gasto y tres tipos de IVA (21, 10 y 4 %: dos filas de IVA). Con todo inventado (T11):
--   · «Proveedor de Prueba K13, S.L.», con su subcuenta 40000113;
--   · K13-CALCO-1, por revisar: la ficha sin duda;
--   · K13-CALCO-2, por revisar, de un emisor que no se conoce: la ficha con una duda («No conozco al que la emite», en
--     su franja, y el proveedor en ámbar). Sin proveedor y con el alta sola de la R14 deshecha, como la deja su
--     «Deshacer» (seed_k11b_emisor_sin_proveedor_staging.sql): así el alta sola no se lo vuelve a poner.
-- La duda de la maqueta es la de la cuenta de gasto, que sale de la historia validada del proveedor; esa no se siembra
-- (validar encadena la huella del libro, y eso no es «añadir», como dice la semilla K04): las casillas están en el mismo
-- sitio con una duda que con otra.
-- Solo añade, con ids fijos: aplicarla dos veces deja lo mismo (W07); va de verdad desde la rama (W05).
-- Guarda: aborta si al otro lado hay cuentas de producción, o si falta el restaurante (semilla K11b).
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp     constant uuid := 'c0f60000-0000-4000-8000-0000000000e3';
  k_prov    constant uuid := 'c0f14000-0000-4000-8000-0000000000a1';
  v_cuando  constant timestamptz := '2026-11-24 00:00:00+00';
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K13 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.company where id = k_emp) then
    raise exception 'Semilla K13: falta el restaurante de la cuenta del núcleo (semilla K11b).';
  end if;

  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_at, updated_at)
  values (k_cuenta, k_emp, 'pymes', '40000113', '4000', 'Proveedor de Prueba K13', 'own', 'manual', v_cuando, v_cuando)
  on conflict (company_id, code) do nothing;
  insert into public.supplier (id, account_id, name, legal_name, tax_id, country_code, vat_regime, created_by_name, created_at)
  values (k_prov, k_cuenta, 'Proveedor de Prueba K13, S.L.', 'Proveedor de Prueba K13, S.L.', 'B00013118', 'ES', 'general', 'Semilla K13', v_cuando)
  on conflict (id) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp, a.id, 'supplier', k_prov, 'principal', 'manual'
    from public.company_account a where a.company_id = k_emp and a.code = '40000113'
  on conflict (company_id, entity, entity_id, role) do nothing;

  -- Base 350,00: 100,00 al 21 %, 200,00 al 10 % y 50,00 al 4 % (cuotas 21,00, 20,00 y 2,00; total 393,00).
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select x.id::uuid, k_cuenta, k_emp, x.prov, x.numero, date '2026-11-03', date '2026-12-03', 'en_revision', 'ocr',
         393.00, 350.00, 43.00, true, 'Semilla K13', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K13).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', x.nombre, 'nif', x.nif),
             'destinatario', jsonb_build_object('nombre', 'Restaurante de Ejemplo Núcleo, S.L.', 'nif', 'B00000046'),
             'numero', x.numero, 'fecha', '2026-11-03', 'vencimiento', '2026-12-03',
             'base', 350.00, 'cuota', 43.00, 'total', 393.00, 'desgloseDe', 'papel')),
         v_cuando + x.n * interval '1 minute', v_cuando + x.n * interval '1 minute'
    from (values ('c0f14000-0000-4000-8000-0000000000f1', 'K13-CALCO-1', 1, k_prov, 'Proveedor de Prueba K13, S.L.', 'B00013118'),
                 ('c0f14000-0000-4000-8000-0000000000f2', 'K13-CALCO-2', 2, null::uuid, 'Emisor Desconocido de Prueba K13, S.L.', 'B00013126')) x(id, numero, n, prov, nombre, nif)
  on conflict (id) do nothing;
  -- La del emisor que no se conoce, como la deja «Deshacer» de la R14 (en la misma transacción: su disparador es diferido).
  insert into public.conta_proveedor_solo (invoice_id, account_id, company_id, que, supplier_id, nif, cuando, created_at, deshecho_at, deshecho_por)
  values ('c0f14000-0000-4000-8000-0000000000f2', k_cuenta, k_emp, 'alta', null, 'B00013126', 'al_leer', v_cuando, v_cuando, 'Semilla K13')
  on conflict (invoice_id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, x.pct, x.base, x.cuota
    from public.supplier_invoice i, (values (21, 100.00, 21.00), (10, 200.00, 20.00), (4, 50.00, 2.00)) x(pct, base, cuota)
   where i.company_id = k_emp and i.created_by_name = 'Semilla K13'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id and z.vat_pct = x.pct);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Mercaderías de prueba K13', 1, null, 350.00, null, 1, '60000001'
    from public.supplier_invoice i
   where i.company_id = k_emp and i.created_by_name = 'Semilla K13'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp and created_by_name = 'Semilla K13';
  if v_n <> 2 then raise exception 'Semilla K13: hay % facturas y tenían que ser 2.', v_n; end if;
  if exists (select 1 from public.supplier where account_id = k_cuenta and tax_id = 'B00013126') then
    raise exception 'Semilla K13: el NIF del emisor que no se conoce ya es de un proveedor de la cuenta.';
  end if;
  if (select supplier_id from public.supplier_invoice where id = 'c0f14000-0000-4000-8000-0000000000f2') is not null then
    raise exception 'Semilla K13: la del emisor que no se conoce tiene proveedor.';
  end if;
  if (select count(*) from public.supplier_invoice_tax z join public.supplier_invoice i on i.id = z.supplier_invoice_id
       where i.company_id = k_emp and i.created_by_name = 'Semilla K13') <> 6 then
    raise exception 'Semilla K13: cada factura lleva sus tres tipos de IVA.';
  end if;
  raise notice 'Semilla K13 OK: el proveedor 40000113, K13-CALCO-1 (sin duda) y K13-CALCO-2 (de un emisor que no se conoce), por revisar.';
end $$;
