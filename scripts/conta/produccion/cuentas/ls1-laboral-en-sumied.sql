-- scripts/conta/produccion/cuentas/ls1-laboral-en-sumied.sql
--
-- LS1 (28/10) · LO QUE CUENTA LA TANDA (2224), antes y después. SOLO LEE.
-- Foodint por su account_id (regla 9).
select clave, valor from (
  select 1 o, 'conta_laboral de Foodint (enabled · source)' clave,
    -- quieta: es UNA fila (la cuenta y la llave son su clave primaria), y solo la escribe la plataforma a mano o esta tanda.
    coalesce((select enabled::text || ' · ' || source from public.feature_flags
               where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and feature_key = 'conta_laboral'), 'sin fila') valor
) t order by o;
