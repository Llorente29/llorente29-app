-- scripts/conta/produccion/cuentas/gb-pestana-anadir.sql
--
-- GB · nº 17, G · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma
-- vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La función: false → true; «servicio» en el CHECK: false → true.
--   2. Lo que se cobra a los clientes y lo hecho desde la pestaña NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_anadir / servicio en el CHECK' clave,
    concat_ws(' / ', (to_regprocedure('public.conta_bitrix_pestana_anadir(text,text,text,text,uuid,uuid,uuid,uuid,date,boolean)') is not null)::text,
      (select pg_get_constraintdef(oid) like '%servicio%' from pg_constraint where conname = 'conta_bitrix_pestana_cambio_accion_check')::text) valor union all
  select 2, 'Líneas / paquetes de clientes / cambios desde la pestaña (tabla entera, todas las cuentas, con corte de fecha)',
    concat_ws(' / ', (select count(*) from public.conta_linea where created_at < timestamptz '2026-11-10 10:00:00+00'),
                     (select count(*) from public.conta_cliente_paquete where created_at < timestamptz '2026-11-10 10:00:00+00'),
                     (select count(*) from public.conta_bitrix_pestana_cambio where hecho_at < timestamptz '2026-11-10 10:00:00+00'))
) q order by o;
