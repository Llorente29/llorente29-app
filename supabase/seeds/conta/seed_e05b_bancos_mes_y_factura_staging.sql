-- ============================================================================
-- E05b · Bancos: el mes y «Es otra factura» · Lo que prepara su e2e, en su
-- carril. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/e05b/mes-y-factura.spec.ts. Crea una función que la e2e
-- llama con la sesión de la persona de la cuenta del núcleo (semilla K02, o la de
-- su carril). Hace lo de e2e_e05_preparar (semilla E05: un banco propio con su
-- extracto de octubre de 2026 y cinco movimientos, en la empresa general) y añade:
--   · un proveedor inventado («Proveedor de Prueba Bancos <lado>», B00000005) con
--     su subcuenta (40000501 en adelante, de la 4000) y dos facturas recibidas aprobadas y sin pagar (121,00 € y
--     60,50 €);
--   · en octubre, dos pagos que las pagan, sin propuesta («por aclarar»): el
--     primero se casa desde la pantalla nueva y el segundo desde la de hoy, para
--     medir que dejan el mismo casado;
--   · el extracto de septiembre de 2026 con dos movimientos (un cargo y un
--     abono), para pasar de mes.
-- Guardas: aborta si al otro lado hay cuentas de producción; solo para la
-- persona de la cuenta del núcleo. Se puede aplicar dos veces (W07): create or
-- replace, y la fila de abajo con «not exists».
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla E05b ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
end $$;

-- La misma fila que la semilla E05 (la 626 de la empresa general de la plantilla, si no está): así esta
-- semilla escribe algo, porque la medida W07 no sabe medir una que solo crea funciones.
insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
select x.account_id, x.id, 'pymes', '62600000', '626', 'Servicios bancarios y similares', 'template', 'serie'
  from public.company x
 where x.id = 'c0e20000-0000-4000-8000-0000000000e2'
   and not exists (select 1 from public.company_account a where a.company_id = x.id and a.code = '62600000');

create or replace function public.e2e_e05b_preparar(p_lado text, p_motor text)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  r jsonb; v_acc uuid; emp uuid; v_banco uuid; v_prov uuid; v_ca uuid; v_st uuid; v_m uuid; v_f uuid; v_n int;
  v_sello text := upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint % 1679616));
  c record; fact jsonb := '{}'::jsonb; pagos jsonb := '{}'::jsonb; sept jsonb := '{}'::jsonb;
begin
  r := public.e2e_e05_preparar(p_lado, p_motor);
  v_acc := (r->>'cuenta')::uuid; emp := (r->>'empresa')::uuid; v_banco := (r->>'banco')::uuid;

  -- El proveedor, con su subcuenta de la 4000 (una por llamada) y su enlace «principal», como lo deja el alta.
  insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, country_code)
  values (v_acc, 'Proveedor de Prueba Bancos ' || p_lado, 'Proveedor de Prueba Bancos ' || p_lado || ', S.L.', 'B00000005', 'nif_es', 'ES')
  returning id into v_prov;
  select 501 + count(*) into v_n from public.company_account where company_id = emp and code ~ '^40000[5-9][0-9]{2}$';
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, emp, 'pymes', '40000' || lpad(v_n::text, 3, '0'), '4000', 'Proveedor de Prueba Bancos ' || p_lado, 'own', 'manual')
  returning id into v_ca;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, emp, v_ca, 'supplier', v_prov::text, 'principal', 'manual');

  -- Sus dos facturas, aprobadas y sin pagar, y un pago de cada una en octubre, sin propuesta.
  select id into v_st from public.bank_statement where treasury_account_id = v_banco and period_from = date '2026-10-01';
  for c in select * from (values
      ('nueva', 'E05B-' || upper(left(p_lado, 3)) || '-1-' || v_sello, date '2026-10-02', 100.00::numeric, date '2026-10-16'),
      ('hoy', 'E05B-' || upper(left(p_lado, 3)) || '-2-' || v_sello, date '2026-10-03', 50.00::numeric, date '2026-10-17')) t(caso, numero, fecha, base, pago) loop
    insert into public.supplier_invoice (account_id, company_id, supplier_id, invoice_number, invoice_date, status, source,
      tax_base_total, tax_total, grand_total, created_by_name)
    values (v_acc, emp, v_prov, c.numero, c.fecha, 'aprobada', 'manual', c.base, round(c.base * 0.21, 2), round(c.base * 1.21, 2), 'Prueba e2e E05b')
    returning id into v_f;
    insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount,
      bank_concept, clean_concept, fingerprint, soft_fingerprint, status, reason)
    values (v_acc, emp, v_banco, v_st, c.pago, c.pago, -round(c.base * 1.21, 2),
      'TRANSFERENCIA PROVEEDOR DE PRUEBA BANCOS ' || upper(p_lado), 'Proveedor de Prueba Bancos ' || p_lado,
      format('e05b-%s-%s-%s', p_lado, c.caso, v_sello), format('e05b-suave-%s-%s-%s', p_lado, c.caso, v_sello),
      'por_aclarar', 'No sé qué factura paga: el banco no trae su número.')
    returning id into v_m;
    fact := fact || jsonb_build_object(c.caso, jsonb_build_object('id', v_f, 'numero', c.numero, 'total', round(c.base * 1.21, 2)));
    pagos := pagos || jsonb_build_object(c.caso, v_m);
  end loop;

  -- Septiembre: su extracto con dos movimientos.
  insert into public.bank_statement (account_id, company_id, treasury_account_id, source, format, file_name, period_from, period_to,
    movements_count, new_count, repeated_count, continuity, opening_balance, closing_balance, balanced, imported_by_name)
  values (v_acc, emp, v_banco, 'fichero', 'n43', 'extracto-e05b-sep.n43', date '2026-09-01', date '2026-09-30', 2, 2, 0, 'primero', 900, 1000, true, 'Prueba e2e E05b')
  returning id into v_st;
  for c in select * from (values
      ('cargo', date '2026-09-10', -30.00::numeric, 'RECIBO TELEFONO EJEMPLO', 'Teléfono Ejemplo'),
      ('abono', date '2026-09-25', 130.00::numeric, 'TRANSFERENCIA RECIBIDA EJEMPLO', 'Cliente Ejemplo')) t(caso, fecha, importe, banco, limpio) loop
    insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount,
      bank_concept, clean_concept, fingerprint, soft_fingerprint, status, reason)
    values (v_acc, emp, v_banco, v_st, c.fecha, c.fecha, c.importe, c.banco, c.limpio,
      format('e05b-%s-%s-%s', p_lado, c.caso, v_sello), format('e05b-suave-%s-%s-%s', p_lado, c.caso, v_sello),
      'por_aclarar', 'No sé qué es.')
    returning id into v_m;
    sept := sept || jsonb_build_object(c.caso, v_m);
  end loop;

  return r || jsonb_build_object('proveedor', v_prov, 'cuentaProveedor', '40000' || lpad(v_n::text, 3, '0'), 'facturas', fact, 'pagos', pagos, 'septiembre', sept);
end $function$;
comment on function public.e2e_e05b_preparar(text, text) is 'SOLO STAGING (semilla E05b): lo de e2e_e05_preparar, un proveedor con dos facturas pendientes y sus pagos en octubre, y el extracto de septiembre, para su e2e.';
revoke all on function public.e2e_e05b_preparar(text, text) from public, anon;
grant execute on function public.e2e_e05b_preparar(text, text) to authenticated;
