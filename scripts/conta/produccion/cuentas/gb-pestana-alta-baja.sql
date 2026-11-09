-- scripts/conta/produccion/cuentas/gb-pestana-alta-baja.sql
--
-- GB · nº 9, punto 1 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La
-- misma vara a los dos lados (regla 31).
-- Medido antes el 09/11 a las 21:43 UTC (solo lectura). Lo que tiene que pasar:
--   1. La tabla y las dos funciones de la pestaña: false / false / false → true / true / true.
--   2. Las líneas de lo que se cobra NO cambian (la migración no llama a nada).
select clave, valor from (
  select 1 o, 'La tabla conta_bitrix_pestana_cambio / conta_bitrix_pestana_hacer / conta_bitrix_pestana_bitrix' clave,
    concat_ws(' / ', (to_regclass('public.conta_bitrix_pestana_cambio') is not null)::text,
                     (to_regprocedure('public.conta_bitrix_pestana_hacer(text,text,text,text,text,jsonb)') is not null)::text,
                     (to_regprocedure('public.conta_bitrix_pestana_bitrix(uuid,jsonb)') is not null)::text) valor union all
  select 2, 'Líneas de lo que se cobra (la demo / con corte de fecha en todas)',
    -- con corte: una línea nueva de otra cuenta a mitad del ensayo no lo para sin culpa de la tanda
    concat_ws(' / ', (select count(*) from public.conta_linea where account_id = 'de000000-0000-4000-8000-0000000000a0'),
                     (select count(*) from public.conta_linea where created_at < timestamptz '2026-11-09 21:43:00+00'))
) q order by o;
