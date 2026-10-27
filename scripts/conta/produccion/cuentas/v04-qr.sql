-- scripts/conta/produccion/cuentas/v04-qr.sql
--
-- V04 · PR 2 (27/10) · LO QUE CUENTA LA TANDA DEL TIQUE CON VERIFACTU, antes y
-- después. SOLO LEE. Los pedidos y los tiques son de Foodint (regla 9), con un
-- corte fijo (W06); los registros de Verifactu, de la base entera, y se dice.
-- Lo que la tanda crea solo se nombra dentro de cadenas.
-- Lo que tiene que cambiar: las columnas de Verifactu del tique y el tramo
-- (0 → 10 de 10), el fabricante (0 → 1), el disparador y el cron (0 → 1), y las
-- huellas de las cinco funciones que cambian. Lo demás, igual: los pedidos y
-- los tiques de Foodint hasta el corte, los registros de Verifactu hasta el corte, y
-- las funciones del camino que la 0741 usa.
select clave, valor from (
  select 1 o, 'pedidos de Foodint hasta el corte (propias / cedidas)' clave,
    (select count(*) filter (where coalesce(b.ownership_type, 'own') = 'own') || ' / ' || count(*) filter (where b.ownership_type = 'licensed')
       from public.sale s left join public.brand b on b.id = s.brand_id and b.account_id = s.account_id
      where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and s.created_at < timestamptz '2026-10-27 06:00:00+00') valor union all
  select 2, 'tiques numerados de Foodint hasta el corte',
    (select count(*) from public.ticket_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and issued_at < timestamptz '2026-10-27 06:00:00+00')::text union all
  select 3, 'columnas de Verifactu del tique y el tramo de la serie (de 10)',
    (select count(*) from information_schema.columns where table_schema = 'public'
        and ((table_name = 'ticket_invoice' and column_name in ('company_id', 'importe_total', 'rectifica_id', 'verifactu_entorno', 'verifactu_registro_id',
              'verifactu_anulacion_id', 'verifactu_estado', 'verifactu_error', 'verifactu_intentos'))
          or (table_name = 'ticket_invoice_series' and column_name = 'tramo')))::text || ' de 10' union all
  select 4, 'el fabricante de Sumied, la tabla (base entera)',
    (select count(*) from unnest(array['verifactu_sistema']) t where to_regclass('public.' || t) is not null)::text union all
  select 5, 'el disparador de la venta y el cron del reintento',
    (select count(*) from pg_trigger where tgname = 'ticket_tras_venta')::text || ' y ' || (select count(*) from cron.job where jobname = 'ticket-verifactu-pendientes')::text union all
  select 6, 'registros de Verifactu hasta el corte (base entera)',
    (select count(*) from public.verifactu_registro where generado_at < timestamptz '2026-10-27 06:00:00+00')::text union all
  select 7, 'huella de las cinco funciones que cambian',
    (select string_agg(p.proname || ' ' || left(md5(pg_get_functiondef(p.oid)), 8), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('fiscal_for_print', 'fiscal_for_preview', '_ticket_invoice_number', 'ticket_invoice_ajustes', 'verifactu_modo')) union all
  select 8, 'huella de las funciones del camino que usa la 0741',
    (select string_agg(p.proname || ' ' || left(md5(p.prosrc), 8), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('kds_resolve_device', 'order_for_print', 'reprint_order_by_token', 'close_sale', 'cancel_sale',
                                                                      'encolar_alerta', '_verifactu_registrar', 'verifactu_url_qr', '_ticket_quien_factura'))
) t order by o;
