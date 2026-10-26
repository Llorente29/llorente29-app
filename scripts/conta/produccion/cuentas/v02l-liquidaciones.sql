-- scripts/conta/produccion/cuentas/v02l-liquidaciones.sql
--
-- V02 · Entrega 2 (25/10) · LO QUE CUENTA LA TANDA DEL MOTOR DE LIQUIDACIONES,
-- antes y después. SOLO LEE. Lo de Foodint, con su account_id (regla 9); lo
-- que es de la base entera (tablas y funciones nuevas, huellas), se dice.
--
-- Lo que tiene que cambiar:
--   · los nombres de tienda, de «no existe» a uno por tienda (9: el nombre con
--     el que llegó cada una);
--   · los tramos de marca y local, de «no existe» a uno por tienda (9: desde
--     siempre, con la marca y el local que tiene hoy);
--   · los cambios de tienda por confirmar, de «no existe» a 0;
--   · lo reclamado sin llegar, de «no existe» a 0 (columna nueva, vacía);
--   · los métodos de cobro con intermediario, de «no existe» a 0;
--   · las huellas de conta_liquidacion_registrar y conta_tienda_plataforma_asignar;
--   · el motor (conta_liquidaciones), de «no» a «sí».
-- Lo demás, IGUAL: la tanda no toca ninguna liquidación, tienda, cobro, casado
-- ni asiento que exista, ni el motor de cobros del PC01 (sus huellas, iguales).
--
-- Medido en producción el 25/10 a las 21:55 UTC, antes:
--   262 · 9 / 0 · no existe · no existe · no existe · no existe · no existe · 3 ·
--   6 · 297.60 · 2 · 15218 · 1815512f · 0146f39b · 14c49321 · d2f9e438 ·
--   b21dc88e · 2b7621db · no
select clave, valor from (
  select 1 o, 'liquidaciones de Foodint' clave,
    (select count(*) from public.channel_settlement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text valor union all
  select 2, 'tiendas de Foodint (todas / con su ID de la plataforma)',
    (select count(*) || ' / ' || count(external_id) from public.platform_store where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') union all
  select 3, 'nombres de tienda (base entera)',
    case when to_regclass('public.platform_store_alias') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.platform_store_alias', false, true, '')))[1]::text end union all
  select 4, 'tramos de marca y local de las tiendas (base entera)',
    case when to_regclass('public.platform_store_tramo') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.platform_store_tramo', false, true, '')))[1]::text end union all
  select 5, 'cambios de tienda por confirmar (base entera)',
    case when to_regclass('public.platform_store_cambio') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.platform_store_cambio where decided_at is null', false, true, '')))[1]::text end union all
  select 6, 'reclamado sin llegar (base entera)',
    case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'conta_liquidacion_resolucion' and column_name = 'arrived_on') then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.conta_liquidacion_resolucion where kind = ''reclamacion'' and arrived_on is null', false, true, '')))[1]::text end union all
  select 7, 'métodos de cobro con intermediario (base entera)',
    case when not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'payment_method' and column_name = 'party_id') then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.payment_method where party_id is not null', false, true, '')))[1]::text end union all
  select 8, 'intermediarios de Foodint (Contactos con papel de plataforma)',
    (select count(*) from public.party_role where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and role = 'platform')::text union all
  select 9, 'cobros de facturas por liquidación de Foodint (cuántos · cuánto)',
    (select count(*) || ' · ' || to_char(coalesce(sum(amount), 0), 'FM999999990.00') from public.customer_invoice_payment
      where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and settlement_id is not null) union all
  select 10, 'liquidaciones de Foodint casadas en Bancos',
    (select count(*) from public.bank_match_item i join public.bank_match b on b.id = i.match_id and b.status = 'vivo'
      where i.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and i.channel_settlement_id is not null)::text union all
  select 11, 'asientos (base entera)', (select count(*) from public.journal_entry)::text union all
  select 12, 'huella de conta_liquidacion_registrar',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_liquidacion_registrar') union all
  select 13, 'huella de conta_tienda_plataforma_asignar',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_tienda_plataforma_asignar') union all
  select 14, 'huella de _conta_liquidacion_cobros (PC01, no se toca)',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = '_conta_liquidacion_cobros') union all
  select 15, 'huella de conta_liquidacion_pedidos (PC01, no se toca)',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_liquidacion_pedidos') union all
  select 16, 'huella de conta_plataformas (V01, no se toca)',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_plataformas') union all
  select 17, 'huella de conta_liquidacion_factura_proponer (no se toca)',
    (select left(md5(p.prosrc), 8) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_liquidacion_factura_proponer') union all
  select 18, 'el motor, conta_liquidaciones (base entera)',
    case when exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_liquidaciones') then 'sí' else 'no' end
) t order by o;
