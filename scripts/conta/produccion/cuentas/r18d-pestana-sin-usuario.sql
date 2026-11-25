-- scripts/conta/produccion/cuentas/r18d-pestana-sin-usuario.sql
--
-- R18d · La pestaña sin usuario de Sumied · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
-- Por cuenta (regla 9: los ids cortados a 8, sin portales ni nombres): las conexiones con un CRM y cuántas tienen el
-- portal unido para la pestaña; y, de toda la tabla, cuántas personas han mirado sin usuario. Antes de la tanda la
-- columna y la tabla no existen (se cuentan como 0); después, 0 y 0: unir lo hace la instalación de la aplicación.
-- Corte fijo: las conexiones creadas antes del 26/11/2026 a las 00:00 de Madrid.
with c as (
  select 'cuenta ' || left(account_id::text, 8) || ' · ' || crm || ' · ' || entorno as k, to_jsonb(x) as j
    from public.conta_crm x where x.created_at < timestamptz '2026-11-26 00:00:00+01'
)
select clave, valor from (
  select 1 o, k || ' · conexión' clave, count(*)::text valor from c group by k
  union all
  select 2, k || ' · portal unido para la pestaña', count(*) filter (where j->>'pestana_portal_at' is not null)::text from c group by k
  union all
  select 3, 'tabla entera · conexiones con un CRM', count(*)::text from c
  union all
  select 4, 'tabla entera · personas que han mirado sin usuario',
         case when to_regclass('public.conta_bitrix_pestana_persona') is null then '0'
              else (xpath('/row/n/text()', query_to_xml('select count(*) as n from public.conta_bitrix_pestana_persona', false, true, '')))[1]::text end
) t order by o, clave;
