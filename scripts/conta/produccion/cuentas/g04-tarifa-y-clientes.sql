-- scripts/conta/produccion/cuentas/g04-tarifa-y-clientes.sql
--
-- G04 · Tarea 3 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma
-- vara a los dos lados (regla 31). Lo que tiene que pasar con la tanda (y
-- volver con su vuelta atrás):
--   1. Tablas nuevas del G04: 0 → 10.
--   2. Vistas nuevas de consulta: 0 → 6.
--   3. Funciones nuevas: 0 → 16.
--   4. Columnas nuevas en conta_linea y conta_gc_suscripcion: 0 → 5.
--   5. Los precios importados (conta_tarifa) de antes del 08/11 09:30 (Madrid): los mismos, y lo que suman.
--   6. Las líneas (conta_linea) de antes del 08/11 09:30 (Madrid): las mismas.
--   7. La vista de antes (conta_consulta_clientes), que lee lo publicado: sigue.
select clave, valor from (
  select 1 o, 'Tablas nuevas del G04' clave,
    (select count(*)::text from unnest(array['conta_gestoria_ajustes', 'conta_servicio_nivel', 'conta_paquete', 'conta_paquete_linea', 'conta_precio', 'conta_precio_tramo',
       'conta_cliente_paquete', 'conta_cambio_precios', 'conta_cambio_precios_linea', 'conta_gc_cobro_otra_via']) t where to_regclass('public.' || t) is not null) valor union all
  select 2, 'Vistas nuevas de consulta',
    (select count(*)::text from unnest(array['conta_consulta_tarifa_precio', 'conta_consulta_asignacion', 'conta_consulta_cliente_empresa', 'conta_consulta_proximo_cobro',
       'conta_consulta_cargo_devuelto', 'conta_consulta_que_hacer']) v where to_regclass('public.' || v) is not null) union all
  select 3, 'Funciones nuevas',
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('_conta_tarifa_puede', '_conta_tarifa_mes', '_conta_tarifa_huella', '_conta_tarifa_nombre', '_conta_precio_insertar', 'conta_gestoria_ajustes_guardar',
         'conta_tarifa_nivel_guardar', 'conta_tarifa_paquete_guardar', 'conta_tarifa_precio_guardar', 'conta_tarifa_servicio_anadir', 'conta_tarifa_nivel_cambiar',
         'conta_tarifa_cambio_ensayar', 'conta_tarifa_cambio_aplicar', 'conta_tarifa_cambio_deshacer', 'conta_gc_cobro_otra_via', 'conta_gc_cobro_otra_via_quitar')) union all
  select 4, 'Columnas nuevas en conta_linea y conta_gc_suscripcion',
    (select count(*)::text from information_schema.columns where table_schema = 'public'
       and ((table_name = 'conta_linea' and column_name in ('nivel_id', 'alta_el', 'baja_el')) or (table_name = 'conta_gc_suscripcion' and column_name in ('proximo_cobro_fecha', 'proximo_cobro_importe')))) union all
  select 5, 'Precios importados de antes del 08/11 09:30 (todas las cuentas): cuántos · suma · cuántos con final',
    (select count(*) || ' · ' || coalesce(sum(importe), 0) || ' · ' || count(hasta) from public.conta_tarifa where created_at < timestamptz '2026-11-08 09:30+01') union all
  select 6, 'Líneas de antes del 08/11 09:30 (todas las cuentas): cuántas · cuántas con final',
    (select count(*) || ' · ' || count(hasta) from public.conta_linea where created_at < timestamptz '2026-11-08 09:30+01') union all
  select 7, 'La vista de antes (conta_consulta_clientes)',
    (select (to_regclass('public.conta_consulta_clientes') is not null)::text)
) q order by o;
