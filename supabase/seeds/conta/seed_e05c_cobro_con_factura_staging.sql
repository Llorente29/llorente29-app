-- ============================================================================
-- E05c · Bancos: el cobro con su factura emitida · Lo que prepara su e2e, en su
-- carril. SOLO STAGING.
-- ----------------------------------------------------------------------------
-- Para tests/e2e/conta/e05c/cobro-con-factura.spec.ts. Crea una función que la e2e
-- llama con la sesión de la persona de la cuenta del núcleo (semilla K02, o la de
-- su carril). Hace lo de e2e_e05_preparar (semilla E05: un banco propio con su
-- extracto de octubre de 2026, en la empresa general) y añade:
--   · un cliente inventado («Cliente de Prueba Bancos <lado>») con su subcuenta
--     de la 4300 (43000501 en adelante) y su enlace «customer», como el alta;
--   · dos facturas emitidas a mano (242,00 € y 121,00 €), cada una con su asiento
--     propuesto (la 430 al debe; la 70000000 y la 47700000 al haber), para que el libro diga
--     que el cliente debe 363,00 €;
--   · en octubre, un ingreso de 242,00 € sin propuesta («por aclarar») que es el
--     cobro de la primera.
-- Guardas: aborta si al otro lado hay cuentas de producción; solo para la
-- persona de la cuenta del núcleo. Se puede aplicar dos veces (W07): create or
-- replace, y la fila de abajo con «not exists».
-- ============================================================================

do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'Semilla E05c ABORTADA: esta base tiene cuentas de producción. ¿Es staging-conta?';
  end if;
end $$;

-- La misma fila que la semilla E05 (la 626 de la empresa general de la plantilla, si no está): así esta
-- semilla escribe algo, porque la medida W07 no sabe medir una que solo crea funciones.
insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
select x.account_id, x.id, 'pymes', '62600000', '626', 'Servicios bancarios y similares', 'template', 'serie'
  from public.company x
 where x.id = 'c0e20000-0000-4000-8000-0000000000e2'
   and not exists (select 1 from public.company_account a where a.company_id = x.id and a.code = '62600000');

create or replace function public.e2e_e05c_preparar(p_lado text, p_motor text)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  r jsonb; v_acc uuid; emp uuid; v_banco uuid; v_party uuid; v_ca uuid; v_st uuid; v_m uuid; v_fy uuid; v_e uuid; v_f uuid; v_n int;
  v_sello text := upper(to_hex((extract(epoch from clock_timestamp()) * 1000)::bigint % 1679616));
  v_nombre text := 'Cliente de Prueba Bancos ' || p_lado;
  c record; fact jsonb := '{}'::jsonb; v_cod text;
begin
  r := public.e2e_e05_preparar(p_lado, p_motor);
  v_acc := (r->>'cuenta')::uuid; emp := (r->>'empresa')::uuid; v_banco := (r->>'banco')::uuid;
  select id into v_fy from public.fiscal_year where company_id = emp and date '2026-10-01' between starts_on and ends_on;
  if v_fy is null then raise exception 'E05c e2e: la empresa general no tiene el ejercicio 2026 (semilla K02).'; end if;

  -- Las cuentas de la venta, si no están (la 700 y la 477 son hojas del plan: van como su genérica).
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  select v_acc, emp, 'pymes', x.code, x.plantilla, x.name, 'template', 'serie'
    from (values ('70000000', '700', 'Ventas de mercaderías'), ('47700000', '477', 'Hacienda Pública, IVA repercutido')) x(code, plantilla, name)
   where not exists (select 1 from public.company_account a where a.company_id = emp and a.code = x.code);

  -- El cliente, con su subcuenta de la 4300 (una por llamada) y su enlace «customer», como lo deja el alta.
  insert into public.party (account_id, name) values (v_acc, v_nombre) returning id into v_party;
  insert into public.party_role (account_id, party_id, role) values (v_acc, v_party, 'customer');
  select 501 + count(*) into v_n from public.company_account where company_id = emp and code ~ '^43000[5-9][0-9]{2}$';
  v_cod := '43000' || lpad(v_n::text, 3, '0');
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source)
  values (v_acc, emp, 'pymes', v_cod, '4300', v_nombre, 'own', 'manual') returning id into v_ca;
  insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
  values (v_acc, emp, v_ca, 'customer', v_party::text, 'principal', 'manual');

  -- Sus dos facturas emitidas a mano, cada una con su asiento propuesto (la 430 al debe).
  for c in select * from (values ('cobro', 1, 200.00::numeric, date '2026-10-01'), ('otra', 2, 100.00::numeric, date '2026-10-02')) t(caso, n, base, fecha) loop
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, status, confidence, reason)
    values (v_acc, emp, v_fy, 1, c.fecha, 'Factura E05C a ' || v_nombre, 'manual', 'propuesto', 'seguro', 'Prueba e2e E05c: la venta de la factura.') returning id into v_e;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit) values
      (v_acc, emp, v_e, 1, v_ca, round(c.base * 1.21, 2), 0),
      (v_acc, emp, v_e, 2, (select id from public.company_account where company_id = emp and code = '70000000'), 0, c.base),
      (v_acc, emp, v_e, 3, (select id from public.company_account where company_id = emp and code = '47700000'), 0, round(c.base * 0.21, 2));
    insert into public.customer_invoice (account_id, company_id, status, origin, series_code, fiscal_year, number, number_text, issue_date, due_date,
      party_id, customer, base, tax, total, entry_id)
    values (v_acc, emp, 'emitida', 'a_mano', 'E5C' || upper(left(p_lado, 1)), 2026, (extract(epoch from clock_timestamp())::bigint % 100000)::int * 10 + c.n,
      format('E05C-%s-%s-%s', upper(left(p_lado, 3)), c.n, v_sello), c.fecha, c.fecha + 90,
      v_party, jsonb_build_object('nombre', v_nombre), c.base, round(c.base * 0.21, 2), round(c.base * 1.21, 2), v_e)
    returning id into v_f;
    fact := fact || jsonb_build_object(c.caso, jsonb_build_object('id', v_f, 'numero', format('E05C-%s-%s-%s', upper(left(p_lado, 3)), c.n, v_sello), 'total', round(c.base * 1.21, 2)));
  end loop;

  -- En octubre, el cobro de la primera, sin propuesta.
  select id into v_st from public.bank_statement where treasury_account_id = v_banco and period_from = date '2026-10-01';
  insert into public.bank_movement (account_id, company_id, treasury_account_id, statement_id, op_date, value_date, amount,
    bank_concept, clean_concept, fingerprint, soft_fingerprint, status, reason)
  values (v_acc, emp, v_banco, v_st, date '2026-10-18', date '2026-10-18', 242.00,
    'TRANSFERENCIA RECIBIDA ' || upper(v_nombre), v_nombre,
    format('e05c-%s-cobro-%s', p_lado, v_sello), format('e05c-suave-%s-cobro-%s', p_lado, v_sello),
    'por_aclarar', 'No sé qué factura cobra: el banco no trae su número.')
  returning id into v_m;

  return r || jsonb_build_object('cliente', v_party, 'cuentaCliente', v_cod, 'facturas', fact, 'cobro', v_m);
end $function$;
comment on function public.e2e_e05c_preparar(text, text) is 'SOLO STAGING (semilla E05c): lo de e2e_e05_preparar, un cliente con dos facturas emitidas pendientes de cobrar y el ingreso que cobra la primera, para su e2e.';
revoke all on function public.e2e_e05c_preparar(text, text) from public, anon;
grant execute on function public.e2e_e05c_preparar(text, text) to authenticated;
