-- ============================================================================
-- K04 · 3.er intento (autorizado por Julio): las facturas de la e2e de la ficha,
-- A NOMBRE DE LA GESTORÍA. SOLO STAGING. Todo inventado (T11).
--
-- Las de seed_k04_ficha_recibida_staging.sql se leyeron con el destinatario sin
-- NIF, y _conta_iva_no_deducible_auto (20261101T2212) las marcó «no viene a
-- nombre de la empresa» (vat_non_deductible, motivo no_a_nombre): su IVA va al
-- gasto, no a la 472. Comprobado en la base local del W09 antes de escribir
-- ésta (las 8: vat_non_deductible = true, no_a_nombre).
--
-- Corregirlas sería un update (desde la rama, solo en ROLLBACK): ésta solo
-- AÑADE otras ocho, con otros ids (…0c<tamaño><n>), otros números (K04B-…),
-- otras fechas y otros importes (así no salen como repetidas de las de antes),
-- y en su lectura el destinatario con el NIF de la gestoría, leído de su ficha
-- (company.tax_id). Los proveedores y las cuentas son los de la semilla K04.
-- Se puede aplicar dos veces igual (W07).
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  cuando    constant timestamptz := '2026-11-18 12:00:00+00';
  v_nif text;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K04b ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K04b: la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;
  if not exists (select 1 from public.supplier where id = 'c0e40000-0000-4000-8000-0000000000a1' and account_id = k_cuenta) then
    raise exception 'Semilla K04b: faltan los proveedores de la semilla K04 (seed_k04_ficha_recibida_staging.sql). Aplícala antes.';
  end if;

  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0e40000-0000-4000-8000-000000000c' || x.t || x.n)::uuid, k_cuenta, k_emp2,
         case when x.n = 4 then 'c0e40000-0000-4000-8000-0000000000a3' else ('c0e40000-0000-4000-8000-0000000000a' || x.t)::uuid end,
         'K04B-' || x.t || '-' || x.n, date '2026-10-02' + (x.n * 4), date '2026-11-01' + (x.n * 4), 'en_revision', 'ocr',
         x.total, x.b4 + 185.39, x.c4 + 18.54, true, 'Semilla K04b', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K04b).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', case when x.n = 4 then 'Proveedor de Prueba Sin Cuenta, S.L.' when x.t = 1 then 'Proveedor de Prueba Ficha Uno, S.L.' else 'Proveedor de Prueba Ficha Dos, S.L.' end,
                                             'nif', case when x.n = 4 then 'J00000000' when x.t = 1 then 'B00000000' else 'A00000000' end),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', 'K04B-' || x.t || '-' || x.n, 'fecha', (date '2026-10-02' + (x.n * 4))::text, 'vencimiento', (date '2026-11-01' + (x.n * 4))::text,
             'base', x.b4 + 185.39, 'cuota', x.c4 + 18.54, 'total', x.total, 'desgloseDe', 'papel')),
         cuando, cuando
    from (select t, n, b4, c4, b4 + c4 + 185.39 + 18.54 as total
            from (select t, n, 152.61 + 10 * (n + 4 * (t - 1)) as b4, round((152.61 + 10 * (n + 4 * (t - 1))) * 0.04, 2) as c4
                    from generate_series(1, 2) t, generate_series(1, 4) n) y) x
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, q.tipo, q.base, q.cuota
    from public.supplier_invoice i
    cross join lateral (values (4, i.tax_base_total - 185.39, i.tax_total - 18.54), (10, 185.39, 18.54)) q(tipo, base, cuota)
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K04b'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, l.texto, l.cantidad, null, l.importe, l.tipo, l.pos, '60000000'
    from public.supplier_invoice i
    cross join lateral (values (1, 'Producto fresco, 3 cajas', 3, i.tax_base_total - 185.39, 4), (2, 'Producto envasado y envases', 1, 185.39, 10)) l(pos, texto, cantidad, importe, tipo)
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K04b'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K04b';
  if v_n <> 8 then raise exception 'Semilla K04b: hay % facturas y tenían que ser 8.', v_n; end if;
  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K04b' and vat_non_deductible;
  if v_n <> 0 then raise exception 'Semilla K04b: % facturas siguen con el IVA no deducible.', v_n; end if;
  raise notice 'Semilla K04b OK: 8 facturas leídas a nombre de la gestoría (%), ninguna con el IVA no deducible.', v_nif;
end $$;
