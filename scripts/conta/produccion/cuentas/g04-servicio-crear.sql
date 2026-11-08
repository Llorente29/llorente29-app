-- scripts/conta/produccion/cuentas/g04-servicio-crear.sql
--
-- G04 · Tarea 4 · LO QUE CUENTA LA TANDA de la 1511, antes y después. SOLO
-- LEE. La misma vara a los dos lados (regla 31). Lo que tiene que pasar con la
-- tanda (y volver con su vuelta atrás):
--   1. La función «+ Crear › Servicio»: 0 → 1.
--   2. Servicios creados por ella (clave «g04:»): 0 → 0 (la tanda no crea ninguno).
--   3. Servicios de antes de la tanda, de todas las cuentas: los mismos.
--   4. Precios (conta_precio) de antes de la tanda, de todas las cuentas: los mismos.
--   5. Empresas con los cambios de tarifa encendidos: las mismas.
select clave, valor from (
  select 1 o, 'Función conta_tarifa_servicio_crear' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'conta_tarifa_servicio_crear') valor union all
  select 2, 'Servicios creados por ella (clave g04:)',
    -- quieta: la clave «g04:» solo la pone la función de esta tanda, que antes del real no existe; después del real, nadie la ha llamado aún
    (select count(*)::text from public.conta_servicio where clave like 'g04:%') union all
  select 3, 'Servicios de antes del 08/11 15:11 (todas las cuentas)', (select count(*)::text from public.conta_servicio where created_at < timestamptz '2026-11-08 15:11+01') union all
  select 4, 'Precios conta_precio de antes del 08/11 15:11 (todas las cuentas)', (select count(*)::text from public.conta_precio where created_at < timestamptz '2026-11-08 15:11+01') union all
  select 5, 'Empresas con los cambios de tarifa encendidos',
    -- quieta: el interruptor solo lo enciende Julio a mano (06/11); la tanda no lo toca
    (select count(*)::text from public.conta_gestoria_ajustes where cambios_de_tarifa)
) q order by o;
