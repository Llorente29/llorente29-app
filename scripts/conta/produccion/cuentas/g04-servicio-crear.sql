-- scripts/conta/produccion/cuentas/g04-servicio-crear.sql
--
-- G04 · Tarea 4 · LO QUE CUENTA LA TANDA de la 1511, antes y después. SOLO
-- LEE. La misma vara a los dos lados (regla 31). Lo que tiene que pasar con la
-- tanda (y volver con su vuelta atrás):
--   1. La función «+ Crear › Servicio»: 0 → 1.
--   2. Servicios creados por ella (clave «g04:»): 0 → 0 (la tanda no crea ninguno).
--   3. Servicios de todas las cuentas: los mismos.
--   4. Precios (conta_precio) de todas las cuentas: los mismos.
--   5. Empresas con los cambios de tarifa encendidos: las mismas.
select clave, valor from (
  select 1 o, 'Función conta_tarifa_servicio_crear' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'conta_tarifa_servicio_crear') valor union all
  select 2, 'Servicios creados por ella (clave g04:)', (select count(*)::text from public.conta_servicio where clave like 'g04:%') union all
  select 3, 'Servicios (todas las cuentas)', (select count(*)::text from public.conta_servicio) union all
  select 4, 'Precios conta_precio (todas las cuentas)', (select count(*)::text from public.conta_precio) union all
  select 5, 'Empresas con los cambios de tarifa encendidos', (select count(*)::text from public.conta_gestoria_ajustes where cambios_de_tarifa)
) q order by o;
