-- scripts/conta/produccion/cuentas/ls1-laboral-en-sumied.sql
--
-- LS1 (28/10) · LO QUE CUENTA LA TANDA (2224), antes y después. SOLO LEE.
-- Foodint por su account_id (regla 9).
select clave, valor from (
  select 1 o, 'conta_laboral de Foodint (enabled · source)' clave,
    coalesce((select enabled::text || ' · ' || source from public.feature_flags
               where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and feature_key = 'conta_laboral'), 'sin fila') valor union all
  select 2, 'cuentas con conta_laboral encendido (todas)',
    (select count(*) from public.feature_flags where feature_key = 'conta_laboral' and enabled)::text
) t order by o;
