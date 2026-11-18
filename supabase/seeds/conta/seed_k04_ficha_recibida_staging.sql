-- ============================================================================
-- K04 · La ficha de la factura recibida en el núcleo: lo que necesita su e2e
-- (tests/e2e/conta/k04) en la gestoría de la cuenta del núcleo (semilla K02).
-- SOLO STAGING. Todo inventado (T11): NIF de ceros, nombres «de Prueba».
--
-- Solo AÑADE, con ids y fechas fijos: se puede aplicar dos veces igual (W07),
-- y por eso va de verdad desde la rama (W05). No activa el plan entero
-- (company_chart_activate pide apartar la 57200001, que tiene su enlace del
-- banco: eso es borrar, y desde la rama solo iría en ROLLBACK). Añade lo justo
-- para que la propuesta del asiento salga como en una empresa con su plan:
--
--   · las cuentas de gasto 60000000, 60200000 y 62800000 (de serie), la
--     retención 47510000, el IVA soportado al 4, 10 y 21 % (47200004,
--     47200010 y 47200021) con su enlace a cada tipo;
--   · dos proveedores con su subcuenta (40000071 y 40000072), uno para cada
--     tamaño de la e2e, y uno SIN subcuenta ni hoja 400 en el plan (la factura
--     que no se puede validar: «El proveedor no tiene su cuenta»);
--   · por cada tamaño, tres facturas leídas de su proveedor, cada una con su
--     importe (con el mismo total, la base las da por repetidas) (las dos primeras
--     las valida la e2e, a la 60000000 y a la 60200000, y en la tercera sale
--     la duda de la cuenta de gasto) y una del proveedor sin cuenta.
--
-- Las facturas anteriores validadas no se siembran: validar encadena la huella
-- del libro (journal_entry.hash) y eso no es «añadir». Las valida la propia
-- e2e con la ficha nueva, con el teclado.
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  cuando    constant timestamptz := '2026-11-18 00:00:00+00';
  v_t record;
  v_c uuid;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K04 ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  if not exists (select 1 from public.company where id = k_emp2 and account_id = k_cuenta) then
    raise exception 'Semilla K04: falta la gestoría de la cuenta del núcleo (seed_k02_nucleo_staging.sql). Aplícala antes.';
  end if;

  -- 1 · Las cuentas de gasto, la retención y el IVA soportado.
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_at, updated_at)
  values
    (k_cuenta, k_emp2, 'pymes', '60000000', '600', 'Compras de mercaderías', 'template', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '60200000', '602', 'Compras de otros aprovisionamientos', 'template', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '62800000', '628', 'Suministros', 'template', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '47510000', '4751', 'H.P. acreedora por retenciones practicadas', 'template', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '47200004', '472', 'IVA soportado 4 %', 'own', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '47200010', '472', 'IVA soportado 10 %', 'own', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '47200021', '472', 'IVA soportado 21 %', 'own', 'serie', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '40000071', '4000', 'Proveedor de Prueba Ficha Uno, S.L.', 'own', 'manual', cuando, cuando),
    (k_cuenta, k_emp2, 'pymes', '40000072', '4000', 'Proveedor de Prueba Ficha Dos, S.L.', 'own', 'manual', cuando, cuando)
  on conflict (company_id, code) do nothing;
  for v_t in select t.id, t.rate from public.tax_rate t
              where t.tax_system = 'iva' and t.is_system and t.valid_to is null and t.treatment = 'taxed' and t.rate in (4, 10, 21) loop
    select id into v_c from public.company_account where company_id = k_emp2 and code = '472000' || lpad(v_t.rate::int::text, 2, '0');
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (k_cuenta, k_emp2, v_c, 'tax_rate', v_t.id::text, 'soportado', 'serie')
    on conflict (company_id, entity, entity_id, role) do nothing;
  end loop;

  -- 2 · Los proveedores: dos con su subcuenta y uno sin ella.
  insert into public.supplier (id, account_id, name, legal_name, tax_id, created_by_name, created_at)
  values
    ('c0e40000-0000-4000-8000-0000000000a1', k_cuenta, 'Proveedor de Prueba Ficha Uno, S.L.', 'Proveedor de Prueba Ficha Uno, S.L.', 'B00000000', 'Semilla K04', cuando),
    ('c0e40000-0000-4000-8000-0000000000a2', k_cuenta, 'Proveedor de Prueba Ficha Dos, S.L.', 'Proveedor de Prueba Ficha Dos, S.L.', 'A00000000', 'Semilla K04', cuando),
    ('c0e40000-0000-4000-8000-0000000000a3', k_cuenta, 'Proveedor de Prueba Sin Cuenta, S.L.', 'Proveedor de Prueba Sin Cuenta, S.L.', 'J00000000', 'Semilla K04', cuando)
  on conflict (id) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp2, a.id, 'supplier', p.prov, 'principal', 'manual'
    from (values ('40000071', 'c0e40000-0000-4000-8000-0000000000a1'), ('40000072', 'c0e40000-0000-4000-8000-0000000000a2')) p(codigo, prov)
    join public.company_account a on a.company_id = k_emp2 and a.code = p.codigo
  on conflict (company_id, entity, entity_id, role) do nothing;

  -- 3 · Las facturas leídas: por cada tamaño (1 = 1456, 2 = 1366), tres de su
  -- proveedor (al 4 y al 10 %, con su gasto en la 60000000) y una del proveedor
  -- sin cuenta. id …0b<tamaño><n>; número K04-<tamaño>-<n>.
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e40000-0000-4000-8000-000000000b' || x.t || x.n)::uuid, k_cuenta, k_emp2,
         case when x.n = 4 then 'c0e40000-0000-4000-8000-0000000000a3' else ('c0e40000-0000-4000-8000-0000000000a' || x.t)::uuid end,
         'K04-' || x.t || '-' || x.n, date '2026-10-01' + (x.n * 4), date '2026-10-31' + (x.n * 4), 'en_revision', 'ocr',
         x.total, x.b4 + 185.39, x.c4 + 18.54, true, 'Semilla K04', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K04).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', case when x.n = 4 then 'Proveedor de Prueba Sin Cuenta, S.L.' when x.t = 1 then 'Proveedor de Prueba Ficha Uno, S.L.' else 'Proveedor de Prueba Ficha Dos, S.L.' end,
                                             'nif', case when x.n = 4 then 'J00000000' when x.t = 1 then 'B00000000' else 'A00000000' end),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', null),
             'numero', 'K04-' || x.t || '-' || x.n, 'fecha', (date '2026-10-01' + (x.n * 4))::text, 'vencimiento', (date '2026-10-31' + (x.n * 4))::text,
             'base', x.b4 + 185.39, 'cuota', x.c4 + 18.54, 'total', x.total, 'desgloseDe', 'papel')),
         cuando, cuando
    from (select t, n, b4, c4, b4 + c4 + 185.39 + 18.54 as total
            from (select t, n, 147.61 + 10 * (n + 4 * (t - 1)) as b4, round((147.61 + 10 * (n + 4 * (t - 1))) * 0.04, 2) as c4
                    from generate_series(1, 2) t, generate_series(1, 4) n) y) x
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, q.tipo, q.base, q.cuota
    from public.supplier_invoice i
    cross join lateral (values (4, i.tax_base_total - 185.39, i.tax_total - 18.54), (10, 185.39, 18.54)) q(tipo, base, cuota)
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K04'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, l.texto, l.cantidad, null, l.importe, l.tipo, l.pos, '60000000'
    from public.supplier_invoice i
    cross join lateral (values (1, 'Producto fresco, 3 cajas', 3, i.tax_base_total - 185.39, 4), (2, 'Producto envasado y envases', 1, 185.39, 10)) l(pos, texto, cantidad, importe, tipo)
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K04'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K04';
  if v_n <> 8 then raise exception 'Semilla K04: hay % facturas de la semilla y tenían que ser 8.', v_n; end if;
  select count(*) into v_n from public.company_account_link where company_id = k_emp2 and entity = 'tax_rate' and role = 'soportado';
  if v_n < 3 then raise exception 'Semilla K04: solo % tipos de IVA con su soportado (tenían que ser 3).', v_n; end if;
  raise notice 'Semilla K04 OK: 9 cuentas, % tipos con su soportado, 3 proveedores y 8 facturas leídas en la gestoría del núcleo.', v_n;
end $$;
