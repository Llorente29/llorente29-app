-- ============================================================================
-- K10b · La factura SIN IVA de su e2e (tests/e2e/conta/k10b): la que llega como
-- una intracomunitaria de servicios y a la que se le cambia el tipo de
-- operación (con IVA español la autoliquidación no se propone: «o la factura o
-- su ficha están mal», e2e 44953178165). En la gestoría de la cuenta del núcleo
-- (semilla K02). SOLO STAGING. Todo inventado (T11).
--   · por tamaño (t = 1 a 1456, t = 2 a 1366), su proveedor de prueba con su
--     subcuenta (40000084, 40000085: los mismos que la semilla K10b, que los
--     encuentra hechos) y su factura del 17/10 sin IVA, leída, por revisar.
-- Va la PRIMERA del manifiesto de staging, y por eso no necesita nada de la rama:
-- delante de la 2150 nada la deja en ROLLBACK (W07). Acaba con «set constraints
-- all immediate»: sus facturas no dejan disparadores pendientes a la 2150, que
-- cambia supplier_invoice en la misma transacción (run 44948939495).
-- Solo AÑADE, con ids fijos; se puede aplicar dos veces igual (W07).
-- ============================================================================

do $$
declare
  k_cuenta  constant uuid := 'c0e20000-0000-4000-8000-0000000000e0';
  k_emp2    constant uuid := 'c0e20000-0000-4000-8000-0000000000e3';
  cuando    constant timestamptz := '2026-11-21 06:00:00+00';
  v_nif text;
  v_n int;
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla K10b sin IVA ABORTADA: al otro lado hay cuentas de producción. ¿Es staging-conta?';
  end if;
  select tax_id into v_nif from public.company where id = k_emp2 and account_id = k_cuenta;
  if v_nif is null then raise exception 'Semilla K10b sin IVA: la gestoría del núcleo no está o no tiene NIF (semilla K02).'; end if;

  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_at, updated_at)
  values (k_cuenta, k_emp2, 'pymes', '40000084', '4000', 'Proveedor de Prueba K10b Uno', 'own', 'manual', cuando, cuando),
         (k_cuenta, k_emp2, 'pymes', '40000085', '4000', 'Proveedor de Prueba K10b Dos', 'own', 'manual', cuando, cuando)
  on conflict (company_id, code) do nothing;
  insert into public.supplier (id, account_id, name, legal_name, country_code, vat_regime, created_by_name, created_at)
  select ('c0eb0000-0000-4000-8000-0000000000b' || t)::uuid, k_cuenta, x.nombre, x.nombre, 'ES', 'general', 'Semilla K10b', cuando
    from (values (1, 'Proveedor de Prueba K10b Uno, S.L.'), (2, 'Proveedor de Prueba K10b Dos, S.L.')) x(t, nombre)
  on conflict (id) do nothing;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  select k_cuenta, k_emp2, a.id, 'supplier', x.de, 'principal', 'manual'
    from (values ('40000084', 'c0eb0000-0000-4000-8000-0000000000b1'), ('40000085', 'c0eb0000-0000-4000-8000-0000000000b2')) x(codigo, de)
    join public.company_account a on a.company_id = k_emp2 and a.code = x.codigo
  on conflict (company_id, entity, entity_id, role) do nothing;

  insert into public.supplier_invoice (id, account_id, company_id, supplier_id, invoice_number, invoice_date, due_date, status, source,
    grand_total, tax_base_total, tax_total, needs_review, created_by_name, arrival_channel, reading_confidence, reading, created_at, updated_at)
  select ('c0eb0000-0000-4000-8000-000000000d' || x.t || '3')::uuid, k_cuenta, k_emp2, ('c0eb0000-0000-4000-8000-0000000000b' || x.t)::uuid,
         x.numero, date '2026-10-17', date '2026-11-16', 'en_revision', 'ocr', x.base, x.base, 0, true, 'Semilla K10b sin IVA', 'correo', 'probable',
         jsonb_build_object(
           'porque', jsonb_build_array('Leída de su PDF (semilla K10b).'), 'comprobaciones', '[]'::jsonb, 'confianza', 'probable',
           'factura', jsonb_build_object(
             'proveedor', jsonb_build_object('nombre', x.nombre),
             'destinatario', jsonb_build_object('nombre', 'Gestoría de Ejemplo Núcleo, S.L.', 'nif', v_nif),
             'numero', x.numero, 'fecha', '2026-10-17', 'vencimiento', '2026-11-16',
             'base', x.base, 'cuota', 0, 'total', x.base, 'desgloseDe', 'papel')),
         cuando, cuando
    from (values (1, 'K10B-1-0003', 375.20, 'Proveedor de Prueba K10b Uno, S.L.'),
                 (2, 'K10B-2-0003', 376.40, 'Proveedor de Prueba K10b Dos, S.L.')) x(t, numero, base, nombre)
  on conflict (id) do nothing;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount)
  select k_cuenta, i.id, 0, i.tax_base_total, 0
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K10b sin IVA'
     and not exists (select 1 from public.supplier_invoice_tax z where z.supplier_invoice_id = i.id);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position, expense_account_code)
  select i.id, 'Servicio de prueba K10b', 1, null, i.tax_base_total, 0, 1, '62800000'
    from public.supplier_invoice i
   where i.company_id = k_emp2 and i.created_by_name = 'Semilla K10b sin IVA'
     and not exists (select 1 from public.supplier_invoice_line z where z.supplier_invoice_id = i.id);

  select count(*) into v_n from public.supplier_invoice where company_id = k_emp2 and created_by_name = 'Semilla K10b sin IVA';
  if v_n <> 2 then raise exception 'Semilla K10b sin IVA: hay % facturas y tenían que ser 2.', v_n; end if;
  raise notice 'Semilla K10b sin IVA OK: dos proveedores de prueba (40000084, 40000085) con su factura del 17/10 sin IVA.';
end $$;
set constraints all immediate;
