-- scripts/conta/produccion/cuentas/gb-pestana-portal.sql
--
-- GB · nº 9, punto 5 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La
-- misma vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. Las dos funciones: false / false → true / true.
--   2. Las peticiones de los clientes NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, '_conta_bitrix_pestana_bitrix_de / conta_bitrix_pestana_portal' clave,
    concat_ws(' / ', (to_regprocedure('public._conta_bitrix_pestana_bitrix_de(uuid,text,text)') is not null)::text,
                     (to_regprocedure('public.conta_bitrix_pestana_portal(text,text,text,text,uuid,uuid)') is not null)::text) valor union all
  select 2, 'Peticiones pedidas / hechas (con corte de fecha)',
    concat_ws(' / ', (select count(*) from public.conta_solicitud where estado = 'pedida' and pedida_at < timestamptz '2026-11-09 22:05:00+00' and (resuelta_at is null or resuelta_at >= timestamptz '2026-11-09 22:05:00+00')),
                     (select count(*) from public.conta_solicitud where estado = 'hecha' and resuelta_at < timestamptz '2026-11-09 22:05:00+00'))
) q order by o;
