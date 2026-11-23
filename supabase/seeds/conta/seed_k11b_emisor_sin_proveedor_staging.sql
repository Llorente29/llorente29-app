-- supabase/seeds/conta/seed_k11b_emisor_sin_proveedor_staging.sql
--
-- ============================================================================
-- K11b · Las facturas del «emisor que no se conoce» de las e2e K04b y K07, SIN PROVEEDOR DE VERDAD. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Desde la R14 (21/11), una recibida leída sin proveedor se da de alta sola al leerla (tg_r14_proveedor_solo,
-- _conta_proveedor_solo): las de las semillas K04b (emisor) y K07 se quedaron con el proveedor que les puso Sumied, y
-- sus e2e dejaron de ver «No conozco al que la emite» (en main, e2e de la noche 45156245865). Esas facturas no se
-- tocan (una semilla solo añade, W07). Van otras, nuevas, como las deja «Deshacer» de la R14: sin proveedor y con su
-- fila de conta_proveedor_solo deshecha, que es lo que hace que el alta sola no vuelva a ponérselo
-- (_conta_proveedor_solo para si la factura tiene una fila deshecha). Con NIF y nombres que no son de nadie:
--   · K04b: t = 1 y 2, n = 1 («Darlo de alta») y n = 2 («Es uno que ya tengo»);
--   · K07: t = 1 y 2, la del recorrido de Julio (n = 3).
-- Las cuentas y lo demás, de las semillas K02, K04, K04b y K07. Todo inventado (T11).
-- Solo añade, con ids fijos: aplicarla dos veces deja lo mismo (W07); va de verdad desde la rama (W05).
-- Guarda: aborta si al otro lado hay cuentas de producción, o si uno de sus NIF ya es de un proveedor de la cuenta.
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  v_cuando  constant timestamptz := '2026-11-23 06:00:00+00';
  v_nif text;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K11b (emisor) ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K11b (emisor): la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;
  if not exists (select 1 from public.company_account where company_id = k_emp2 and code = '60000000') then
    raise exception 'Semilla K11b (emisor): faltan las cuentas de la semilla K04 (seed_k04_ficha_recibida_staging.sql).';
  end if;
  if exists (select 1 from public.supplier where account_id = k_cuenta
              and tax_id in ('B00000133', 'B00000141', 'B00000158', 'B00000166', 'B00000174', 'B00000182')) then
    raise exception 'Semilla K11b (emisor): uno de sus NIF ya es de un proveedor de la cuenta: la factura no saldría como desconocida.';
  end if;

  -- Las facturas, leídas y sin proveedor (las de la K04b, con la «d»; la de la K07, con la «e»).
  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select x.id::uuid, k_cuenta, k_emp2, null, x.numero, x.fecha, x.fecha + 30, 'en_revision', 'ocr',
         round(x.base * 1.21, 2), x.base, round(x.base * 0.21, 2), true, 'Semilla K11b emisor', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K11b, emisor que no se conoce).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', x.nombre, 'nif', x.nif),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', x.numero, 'fecha', x.fecha::text, 'vencimiento', (x.fecha + 30)::text,
             'base', x.base, 'cuota', round(x.base * 0.21, 2), 'total', round(x.base * 1.21, 2), 'desgloseDe', 'papel')),
         v_cuando, v_cuando
    from (values
      ('c0f80000-0000-4000-8000-000000000d11', 'K11B-E-1-1', date '2026-10-07', 'B00000133', 'Emisor Desconocido de Prueba 1, S.L.', 211.10),
      ('c0f80000-0000-4000-8000-000000000d12', 'K11B-E-1-2', date '2026-10-11', 'B00000141', 'Emisor con Otro Nombre Desconocido 1, S.L.', 223.30),
      ('c0f80000-0000-4000-8000-000000000d21', 'K11B-E-2-1', date '2026-10-07', 'B00000158', 'Emisor Desconocido de Prueba 2, S.L.', 241.50),
      ('c0f80000-0000-4000-8000-000000000d22', 'K11B-E-2-2', date '2026-10-11', 'B00000166', 'Emisor con Otro Nombre Desconocido 2, S.L.', 257.70),
      ('c0f80000-0000-4000-8000-000000000e13', 'K11B-K07-1-3', date '2026-10-09', 'B00000174', 'Emisor Desconocido K07 de Prueba 1, S.L.', 317.90),
      ('c0f80000-0000-4000-8000-000000000e23', 'K11B-K07-2-3', date '2026-10-09', 'B00000182', 'Emisor Desconocido K07 de Prueba 2, S.L.', 327.10)
    ) x(id, numero, fecha, nif, nombre, base)
  on conflict (id) do nothing;

  -- Como las deja «Deshacer» de la R14: su fila de conta_proveedor_solo, deshecha y sin proveedor. Va en la misma
  -- transacción que la factura: el disparador de la R14 es diferido y, al confirmar, la encuentra y no la toca.
  insert into public.conta_proveedor_solo (invoice_id, account_id, company_id, que, supplier_id, nif, cuando, created_at, deshecho_at, deshecho_por)
  select i.id, k_cuenta, k_emp2, 'alta', null, i.reading -> 'factura' -> 'proveedor' ->> 'nif', 'al_leer', v_cuando, v_cuando, 'Semilla K11b'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K11b emisor'
  on conflict (invoice_id) do nothing;

  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 21, i.tax_base_total, i.tax_total
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K11b emisor'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Material de oficina de prueba', 1, null, i.tax_base_total, 21, 1, '60000000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K11b emisor'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K11b emisor' and supplier_id is null;
  if v_n <> 6 then raise exception 'Semilla K11b (emisor): hay % facturas sin proveedor y tenían que ser 6.', v_n; end if;
  select count(*) into v_n from public.conta_proveedor_solo s join public.supplier_invoice i on i.id = s.invoice_id
   where i.created_by_name = 'Semilla K11b emisor' and s.deshecho_at is not null and s.supplier_id is null;
  if v_n <> 6 then raise exception 'Semilla K11b (emisor): hay % filas deshechas de la R14 y tenían que ser 6.', v_n; end if;
  raise notice 'Semilla K11b (emisor) OK: 6 facturas de un emisor que no se conoce, sin proveedor y con el alta sola deshecha, en la gestoría (%).', v_nif;
end $$;
