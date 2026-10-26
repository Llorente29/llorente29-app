-- scripts/conta/produccion/cuentas/v03-e3.sql
--
-- V03 · Entrega 3 (26/10) · LO QUE CUENTA LA TANDA DE «CORREGIR Y CUADRAR»,
-- antes y después. SOLO LEE. Las facturas son de Foodint (regla 9), con un
-- corte fijo (W06); lo de Verifactu es de la base entera, y se dice. Las
-- tablas que crea la tanda solo se nombran dentro de cadenas.
-- Lo que tiene que cambiar: las dos tablas del cuadre (0 → 2 de 2) y el cron
-- verifactu-cuadre (0 → 1). Lo demás, igual: las facturas de Foodint, ningún
-- registro de Verifactu ni ninguna empresa encendida, y las funciones de la E1
-- y la E2 que la 1750 usa, sin tocar.
select clave, valor from (
  select 1 o, 'facturas de venta de Foodint (borrador / emitidas / anuladas)' clave,
    (select count(*) filter (where status = 'borrador') || ' / ' || count(*) filter (where status = 'emitida') || ' / ' || count(*) filter (where status = 'anulada')
       from public.customer_invoice where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-26 16:00:00+00') valor union all
  select 2, 'tablas del cuadre con Hacienda (base entera)',
    (select count(*) from unnest(array['verifactu_cuadre', 'verifactu_cuadre_hacienda']) t where to_regclass('public.' || t) is not null) || ' de 2' union all
  select 3, 'empresas con Verifactu en pruebas o real (base entera)',
    -- quieta: ninguna empresa de producción tiene Verifactu encendido (lo enciende Julio, a mano)
    (select count(*) from public.verifactu_empresa where modo <> 'apagado')::text union all
  select 4, 'registros de Verifactu (base entera)',
    -- quieta: sin ninguna empresa encendida no se escribe ningún registro
    (select count(*) from public.verifactu_registro)::text union all
  select 5, 'cron verifactu-cuadre', (select count(*) from cron.job where jobname = 'verifactu-cuadre')::text union all
  select 6, 'huella de las funciones de la E1 y la E2 que usa la 1750',
    (select string_agg(p.proname || ' ' || left(md5(p.prosrc), 8), ', ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('verifactu_comprobar', '_verifactu_registrar', 'verifactu_reenviar', 'journal_entry_validar'))
) t order by o;
