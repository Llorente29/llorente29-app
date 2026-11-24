-- scripts/conta/produccion/cuentas/r18b-actualizar-bitrix.sql
--
-- R18b · «Actualizar Bitrix24» · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta (regla 9: los ids cortados a 8, sin portales ni claves): las conexiones con un CRM, cuántas tienen
-- «Actualizar Bitrix24» encendido y cuántas tienen clave para escribir. Antes de la tanda las dos columnas no
-- existen (se cuentan como 0); después, 0 y 0: la tanda nace apagada y sin clave.
-- Corte fijo: las conexiones creadas antes del 25/11/2026 a las 00:00 de Madrid.
with c as (
  select 'cuenta ' || left(account_id::text, 8) || ' · ' || crm || ' · ' || entorno as k, to_jsonb(x) as j
    from public.conta_crm x where x.created_at < timestamptz '2026-11-25 00:00:00+01'
)
select clave, valor from (
  select 1 o, k || ' · conexión' clave, count(*)::text valor from c group by k
  union all
  select 2, k || ' · «Actualizar Bitrix24» encendido', count(*) filter (where (j->>'actualizar')::boolean is true)::text from c group by k
  union all
  select 3, k || ' · con clave para escribir', count(*) filter (where j->>'escribir_ref' is not null)::text from c group by k
  union all
  select 4, 'tabla entera · conexiones con un CRM', count(*)::text from c
) t order by o, clave;
