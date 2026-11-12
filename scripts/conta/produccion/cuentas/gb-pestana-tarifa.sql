-- scripts/conta/produccion/cuentas/gb-pestana-tarifa.sql
--
-- GB · nº 9, punto 2 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La
-- misma vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. conta_bitrix_pestana_hacer admite «tarifa»: false → true.
--   2. Las líneas y los precios NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_hacer admite «tarifa»' clave,
    coalesce((select pg_get_functiondef('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)'::regprocedure) like '%conta_tarifa_nivel_cambiar%'
               where to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is not null), false)::text valor union all
  select 2, 'Líneas / precios (con corte de fecha)',
    concat_ws(' / ', (select count(*) from public.conta_linea where created_at < timestamptz '2026-11-09 21:43:00+00'),
                     (select count(*) from public.conta_precio where created_at < timestamptz '2026-11-09 21:43:00+00'))
) q order by o;
