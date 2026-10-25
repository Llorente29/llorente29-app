-- scripts/conta/produccion/cuentas/v03-verifactu.sql
--
-- V03 · Entrega 1 (25/10) · LO QUE CUENTA LA TANDA DEL MOTOR DE VERIFACTU,
-- antes y después. SOLO LEE. Las facturas son de Foodint (regla 9); lo de
-- Verifactu y las funciones son de la base entera, y se dice. Las tablas que
-- crea la tanda solo se nombran dentro de cadenas (no existen antes).
-- Lo que tiene que cambiar: las tablas de Verifactu y el disparador, de «no» a
-- «sí». Lo demás, igual: ninguna empresa con Verifactu encendido, ningún
-- registro, las facturas de Foodint las mismas y conta_venta_emitir sin tocar.
-- Medido en producción el 25/10 a las 21:50 UTC, antes: 0 / 1286 / 0 · 0 de 6 ·
-- no existe · no existe · no · 99be8350. Después: lo mismo, salvo 6 de 6, 0, 0
-- y «sí».
select clave, valor from (
  select 1 o, 'facturas de venta de Foodint (borrador / emitidas / anuladas)' clave,
    (select count(*) filter (where status = 'borrador') || ' / ' || count(*) filter (where status = 'emitida') || ' / ' || count(*) filter (where status = 'anulada')
       from public.customer_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710') valor union all
  select 2, 'tablas de Verifactu (base entera)',
    (select count(*) from unnest(array['verifactu_empresa','verifactu_operacion','verifactu_cadena','verifactu_registro','verifactu_envio','verifactu_flujo']) t
      where to_regclass('public.' || t) is not null) || ' de 6' union all
  select 3, 'empresas con Verifactu en pruebas o real (base entera)',
    case when to_regclass('public.verifactu_empresa') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.verifactu_empresa where modo <> ''apagado''', false, true, '')))[1]::text end union all
  select 4, 'registros de Verifactu (base entera)',
    case when to_regclass('public.verifactu_registro') is null then 'no existe'
         else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.verifactu_registro', false, true, '')))[1]::text end union all
  select 5, 'disparador customer_invoice_verifactu',
    case when exists (select 1 from pg_trigger where tgrelid = 'public.customer_invoice'::regclass and tgname = 'customer_invoice_verifactu') then 'sí' else 'no' end union all
  select 6, 'huella de conta_venta_emitir',
    (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'conta_venta_emitir')
) t order by o;
