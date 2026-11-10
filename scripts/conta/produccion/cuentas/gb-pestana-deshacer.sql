-- scripts/conta/produccion/cuentas/gb-pestana-deshacer.sql
--
-- GB · nº 13 · «Deshacer» · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- La misma vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La función: false → true; «deshacer» en el CHECK: false → true.
--   2. Lo hecho desde la pestaña NO cambia (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_deshacer / deshacer en el CHECK' clave,
    concat_ws(' / ', (to_regprocedure('public.conta_bitrix_pestana_deshacer(text,text,text,text,uuid,timestamptz)') is not null)::text,
      (select pg_get_constraintdef(oid) like '%deshacer%' from pg_constraint where conname = 'conta_bitrix_pestana_cambio_accion_check')::text) valor union all
  select 2, 'Cambios desde la pestaña (con corte de fecha)',
    (select count(*) from public.conta_bitrix_pestana_cambio where hecho_at < timestamptz '2026-11-10 00:00:00+00')::text
) q order by o;
