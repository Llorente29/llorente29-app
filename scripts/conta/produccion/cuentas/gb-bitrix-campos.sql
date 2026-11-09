-- scripts/conta/produccion/cuentas/gb-bitrix-campos.sql
--
-- GB · nº 13, punto 1 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La
-- misma vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La función: false → true.
--   2. Lo hecho desde la pestaña NO cambia (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_campos' clave,
    (to_regprocedure('public.conta_bitrix_pestana_campos(uuid)') is not null)::text valor union all
  select 2, 'Cambios desde la pestaña (con corte de fecha)',
    (select count(*) from public.conta_bitrix_pestana_cambio where hecho_at < timestamptz '2026-11-10 00:20:00+00')::text
) q order by o;
