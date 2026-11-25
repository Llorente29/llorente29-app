-- supabase/seeds/conta/seed_x33_gocardless_staging.sql
--
-- X33 · Lo que la e2e del X33 necesita de GoCardless en staging-conta. SOLO STAGING. Todo inventado; nada copiado de
-- producción (T11). Se puede volver a lanzar: ids fijos, y lo que ya está no se toca. Solo añade (W07).
--
-- Cuenta A (empresa 3b34403a…, la del X10 y el X31), noviembre de 2026, como lo trae Sumied de GoCardless:
--   · tres clientes de GoCardless: uno atado a su ficha con su 430 (código 101) y su factura emitida (traída, como las
--     traerá de ERP10 el X14: no sale a ERP10), uno atado a su ficha sin 430 y uno sin ficha de Sumied;
--   · sus mandatos y cuatro cobros: el del cliente con 430 (cobrado), el del cliente sin 430, el del que no tiene ficha
--     y uno fallido (que no lleva asiento);
--   · la liquidación que los ingresa en el banco.
-- Con esto, «Preparar los de noviembre de 2026» deja 2 preparados (el cobro con su 430 y el ingreso) y 2 en
-- «Pendiente de revisar» (sin 430 y sin cliente).

do $$
declare
  a  constant uuid := 'c01a0000-0000-4000-8000-00000000000a';
  ea constant uuid := '3b34403a-a7d6-4a48-a8d7-737e8cababdc';
begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'SEMILLA X33: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if not exists (select 1 from public.company where id = ea and account_id = a) then
    raise exception 'SEMILLA X33: falta la empresa de pruebas de la cuenta A.';
  end if;

  insert into public.party (id, account_id, name, created_by_name) values
    ('a3300000-0000-4000-8000-0000000000b1', a, 'Cliente Inventado X33 Uno, S.L.', 'semilla X33'),
    ('a3300000-0000-4000-8000-0000000000b2', a, 'Cliente Inventado X33 Dos, S.L.', 'semilla X33')
  on conflict do nothing;
  insert into public.conta_gc_cliente (company_id, gc_id, account_id, nombre, party_id) values
    (ea, 'CU00X33SEM1', a, 'Cliente Inventado X33 Uno, S.L.', 'a3300000-0000-4000-8000-0000000000b1'),
    (ea, 'CU00X33SEM2', a, 'Cliente Inventado X33 Dos, S.L.', 'a3300000-0000-4000-8000-0000000000b2'),
    (ea, 'CU00X33SEM3', a, 'Cliente Inventado X33 Tres', null)
  on conflict do nothing;
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id) values
    (ea, 'MD00X33SEM1', a, 'CU00X33SEM1'), (ea, 'MD00X33SEM2', a, 'CU00X33SEM2'), (ea, 'MD00X33SEM3', a, 'CU00X33SEM3')
  on conflict do nothing;
  insert into public.conta_cobro_cliente (company_id, party_id, account_id, codigo_cliente, forma_cobro) values
    (ea, 'a3300000-0000-4000-8000-0000000000b1', a, 101, 'gocardless'),
    (ea, 'a3300000-0000-4000-8000-0000000000b2', a, null, 'gocardless')
  on conflict do nothing;
  insert into public.customer_invoice (id, account_id, company_id, status, doc_type, origin, series_code, fiscal_year, number, number_text,
                                       issue_date, party_id, base, tax, total, created_by_name)
  values ('a3300000-0000-4000-8000-0000000000c1', a, ea, 'emitida', 'factura', 'traida', 'X33', 2026, 1, '2026/1/0001', '2026-11-01',
          'a3300000-0000-4000-8000-0000000000b1', 50, 10.5, 60.5, 'semilla X33')
  on conflict do nothing;
  insert into public.conta_gc_cobro (company_id, gc_id, account_id, mandato_gc_id, estado, fecha, importe, moneda, payout_gc_id) values
    (ea, 'PM00X33SEM1', a, 'MD00X33SEM1', 'paid_out', '2026-11-04', 60.5, 'EUR', 'PO00X33SEM1'),
    (ea, 'PM00X33SEM2', a, 'MD00X33SEM2', 'paid_out', '2026-11-04', 72.6, 'EUR', 'PO00X33SEM1'),
    (ea, 'PM00X33SEM3', a, 'MD00X33SEM3', 'paid_out', '2026-11-04', 30.25, 'EUR', 'PO00X33SEM1'),
    (ea, 'PM00X33SEM4', a, 'MD00X33SEM1', 'failed', '2026-11-04', 60.5, 'EUR', null)
  on conflict do nothing;
  insert into public.conta_gc_payout (company_id, gc_id, account_id, estado, llegada, importe, comision, moneda, referencia) values
    (ea, 'PO00X33SEM1', a, 'paid', '2026-11-06', 158.95, 4.4, 'EUR', 'X33-LIQ-SEMILLA')
  on conflict do nothing;
end $$;
