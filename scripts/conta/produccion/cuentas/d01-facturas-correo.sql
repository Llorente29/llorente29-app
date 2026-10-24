-- scripts/conta/produccion/cuentas/d01-facturas-correo.sql
--
-- D01 · LO QUE CUENTA LA TANDA DE LAS FACTURAS POR CORREO (0100 y 0110 del
-- 19), antes y después. SOLO LEE. Recuentos de Foodint (regla 9); ningún
-- nombre, dirección ni importe.
-- Lo que tiene que cambiar: 0 → 1 dirección de facturas encendida, la tabla de
-- remitentes de «no existe» a 1, y la huella de conta_entrada_llegada. Lo
-- demás, igual (la tanda no toca la bandeja ni el registro de entrada).
-- Medido en producción el 16/10 a las 19:17 UTC, antes: 1 / 0 / no existe /
-- 0 / 9 / 2b167f38.
select clave, valor from (
  select 1 o, 'direcciones de liquidaciones de Foodint encendidas' clave,
    (select count(*) from public.company_inbound_address where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'liquidaciones' and active)::text valor union all
  select 2, 'direcciones de facturas de Foodint encendidas',
    (select count(*) from public.company_inbound_address where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'facturas' and active)::text union all
  select 3, 'remitentes de Foodint que no mandan facturas',
    case when to_regclass('public.company_inbound_sender') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.company_inbound_sender where account_id = ''51ad1792-6629-4ef7-833a-b57b09a86710''', false, true, '')))[1]::text end union all
  select 4, 'llegadas por correo en la bandeja de Foodint',
    (select count(*) from public.document_inbox where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and channel = 'correo')::text union all
  select 5, 'correos en el registro de entrada (todas las cuentas)',
    (select count(*) from public.inbound_email_log)::text union all
  select 6, 'huella de conta_entrada_llegada',
    (select left(md5(pg_get_functiondef(p.oid)), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_entrada_llegada')
) t order by o;
