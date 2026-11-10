-- scripts/conta/produccion/cuentas/gb-bitrix-avisos.sql
--
-- GB · nº 13, punto 4 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La
-- misma vara a los dos lados (regla 31). Lo que tiene que pasar:
--   1. La tabla y el cron: false / false → true / true (el cron, si hay cron_secret).
--   2. Las conexiones de CRM de pruebas y reales NO cambian.
select clave, valor from (
  select 1 o, 'conta_bitrix_pestana_aviso / cron conta-bitrix-avisos-despertar' clave,
    concat_ws(' / ', (to_regclass('public.conta_bitrix_pestana_aviso') is not null)::text,
                     (exists (select 1 from cron.job where jobname = 'conta-bitrix-avisos-despertar'))::text) valor union all
  select 2, 'Conexiones de CRM de pruebas / reales',
    concat_ws(' / ', (select count(*) from public.conta_crm where entorno = 'pruebas'), (select count(*) from public.conta_crm where entorno = 'real'))
) q order by o;
