-- scripts/conta/produccion/cuentas/gb-pestana-devuelto.sql
--
-- GB · nº 17, A · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma
-- vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. Las dos funciones: false / false → true / true; «devuelto» en el CHECK: false → true.
--   2. Los recibos devueltos y lo hecho desde la pestaña NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_devueltos / _devuelto_hecho / devuelto en el CHECK' clave,
    concat_ws(' / ', (to_regprocedure('public.conta_bitrix_pestana_devueltos(text,text,text,text)') is not null)::text,
      (to_regprocedure('public.conta_bitrix_pestana_devuelto_hecho(text,text,text,text,uuid,text,text)') is not null)::text,
      (select pg_get_constraintdef(oid) like '%devuelto%' from pg_constraint where conname = 'conta_bitrix_pestana_cambio_accion_check')::text) valor union all
  select 2, 'Recibos devueltos / cambios desde la pestaña (con corte de fecha)',
    concat_ws(' / ', (select count(*) from public.conta_recibo where estado in ('devuelto', 'retrocedido') and updated_at < timestamptz '2026-11-10 09:00:00+00'),
                     (select count(*) from public.conta_bitrix_pestana_cambio where hecho_at < timestamptz '2026-11-10 09:00:00+00'))
) q order by o;
