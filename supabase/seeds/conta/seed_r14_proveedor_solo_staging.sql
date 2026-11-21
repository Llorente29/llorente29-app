-- ============================================================================
-- R14 · El proveedor nuevo se da de alta solo · Lo que prepara su e2e. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/r14/proveedor-solo.spec.ts. Crea una función que la e2e llama
-- con la sesión de la administradora del núcleo (de su carril), sobre una empresa que la
-- propia e2e acaba de crear («Prueba R14 …»): deja una recibida LEÍDA de un proveedor
-- que la cuenta no tiene (con su IVA y sus líneas, como conta_factura_desde_lectura) y
-- hace lo que hará el disparador de la 1120 al confirmar: _conta_proveedor_solo (1110).
-- Hasta el real del R14, ese disparador solo va en ROLLBACK a staging (cambia en
-- caliente): esto hace en staging lo que hará él. Cuando esté, el disparador encuentra
-- la factura ya con proveedor y no hace nada.
--
-- Guardas: aborta si al otro lado hay cuentas de producción. La función solo actúa en
-- una empresa «Prueba R14 …» de una cuenta de quien la llama (administradora o gestora).
-- Se puede aplicar dos veces (W07): create or replace.
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla R14 ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
end $$;

create or replace function public.e2e_r14_llega(p_company uuid, p_nif text, p_nombre text, p_numero text, p_lineas text[] default array['POLLO ENTERO 1,8KG', 'ALITAS DE POLLO CONGELADAS'])
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare c public.company; v uuid := gen_random_uuid(); r jsonb; n int := coalesce(cardinality(p_lineas), 0);
begin
  select * into c from public.company where id = p_company;
  if c.id is null or c.legal_name not like 'Prueba R14 %' or not public.current_user_is_admin_or_manager_of(c.account_id) then
    raise exception 'R14 e2e: solo en una empresa «Prueba R14 …» de tu cuenta.' using errcode = '42501';
  end if;
  if n = 0 then raise exception 'R14 e2e: sin líneas.' using errcode = '22023'; end if;
  insert into public.supplier_invoice (id, account_id, company_id, status, source, invoice_number, invoice_date, tax_base_total, tax_total, grand_total,
                                       needs_review, created_by_name, reading, reading_confidence)
  values (v, c.account_id, c.id, 'en_revision', 'ocr', p_numero, date '2026-11-10', 100, 10, 110, false, 'Prueba e2e R14',
          jsonb_build_object('factura', jsonb_build_object('numero', p_numero, 'fecha', '2026-11-10', 'base', 100, 'cuota', 10, 'total', 110,
            'tipos', jsonb_build_array(jsonb_build_object('tipo', 10, 'base', 100, 'cuota', 10)),
            'proveedor', jsonb_build_object('nombre', p_nombre, 'nif', p_nif, 'direccion', 'C/ Inventada 1, 28000 Madrid',
                                            'email', 'pedidos@ejemplo.test', 'telefono', '900000000', 'web', 'ejemplo.test'),
            'destinatario', jsonb_build_object('nombre', c.legal_name, 'nif', c.tax_id)),
            'confianza', 'seguro'), 'seguro');
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount) values (c.account_id, v, 10, 100, 10);
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, position)
  select v, t, 1, round(100.0 / n, 2) + case when o = n then 100 - round(100.0 / n, 2) * n else 0 end,
         round(100.0 / n, 2) + case when o = n then 100 - round(100.0 / n, 2) * n else 0 end, 10, o::int
    from unnest(p_lineas) with ordinality z(t, o);
  -- Lo que hace el disparador de la 1120 al confirmar.
  r := public._conta_proveedor_solo(v, 'al_leer');
  return jsonb_build_object('id', v, 'proveedor', r);
end $function$;
comment on function public.e2e_r14_llega(uuid, text, text, text, text[]) is 'SOLO STAGING (semilla R14): una recibida leída de un proveedor nuevo en una empresa «Prueba R14 …», con lo que hará el disparador de la 1120 (_conta_proveedor_solo), para su e2e.';
revoke all on function public.e2e_r14_llega(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.e2e_r14_llega(uuid, text, text, text, text[]) to authenticated;
