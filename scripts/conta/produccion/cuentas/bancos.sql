-- scripts/conta/produccion/cuentas/bancos.sql
--
-- B01 · LO QUE CUENTA LA TANDA DE BANCOS (0100–0170), antes y después. Lo
-- declara el manifiesto («cuenta: <este fichero>») y lo comparan deshacer.sh y
-- el ensayo de la vuelta atrás. SOLO LEE.
--
-- Se puede tomar ANTES de la tanda (las tablas bank_* aún no existen: se mira
-- con to_regclass y se cuenta por query_to_xml solo si existen) y DESPUÉS de
-- deshacerla: tiene que salir igual que antes.
--
-- Regla 9: lo de Foodint, anclado por su id de cuenta y dicho en la clave; las
-- tablas bank_* y las funciones, enteras y dichas («todas las cuentas»).
-- Los 50 asientos de ventas de octubre (respuesta 5): la huella de los creados
-- antes del 13/10 a las 18:00 UTC, la misma consulta que el 13/10
-- (577331bd83ee711a6d6892f5d4e18d5d). Con fecha de creación tope, para que el
-- cierre del día (a las :07) no la mueva entre el antes y el después.
with nuevas as (select unnest(array['bank_settings', 'bank_statement', 'bank_account_iban', 'bank_movement', 'bank_match', 'bank_match_item',
  'bank_rule', 'bank_rule_log', 'bank_activity_log', 'recurring_contract', 'bank_card', 'bank_month_close', 'bank_agent_run', 'bank_aggregator_link']) t)
select clave, valor from (
  select 1 o, 'tablas nuevas del B01 que existen, de 14 (todas las cuentas)' clave,
    (select count(*) from nuevas where to_regclass('public.' || t) is not null)::text valor union all
  select 2, 'filas en las tablas nuevas del B01 (todas las cuentas)', coalesce((select sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text::int)
       from nuevas where to_regclass('public.' || t) is not null)::text, '0') union all
  select 3, 'funciones bank_* y _bank_* (todas las cuentas)', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and (p.proname like 'bank\_%' or p.proname like '\_bank\_%'))::text union all
  select 4, 'columnas nuevas (treasury_account.short_name, bank_rule.corrections)', (select count(*) from information_schema.columns
       where table_schema = 'public' and ((table_name = 'treasury_account' and column_name = 'short_name') or (table_name = 'bank_rule' and column_name = 'corrections')))::text union all
  select 5, 'Foodint · fichas de banco', (select count(*) from public.treasury_account where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text union all
  select 6, 'Foodint · 572 con ficha de banco principal', (select coalesce(string_agg(a.code, ' ' order by a.code), '') from public.company_account_link l
       join public.company_account a on a.id = l.company_account_id
       where l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and l.entity = 'bank_account' and l.role = 'principal') union all
  select 7, 'Foodint · asientos que no vienen de Diez, creados antes del 13/10 18:00 UTC (n · huella)', (select count(*) || ' · ' || md5(string_agg(id::text || ':' || series || ':' || entry_date, ',' order by id))
       from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source_type <> 'migrated' and created_at < timestamptz '2026-10-13 18:00+00') union all
  select 8, 'Foodint · asientos de su libro creados antes del 13/10 18:00 UTC (todos los orígenes)', (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-10-13 18:00+00')::text union all
  select 9, 'conta_lectura · tablas bank_* que lee', case when not exists (select 1 from pg_roles where rolname = 'conta_lectura') then 'sin rol'
       else (select count(*) from unnest(array['bank_agent_run', 'bank_aggregator_link', 'bank_match', 'bank_month_close', 'bank_movement', 'bank_rule', 'bank_rule_log', 'bank_statement']) t
             where to_regclass('public.' || t) is not null and has_table_privilege('conta_lectura', 'public.' || t, 'select'))::text end
) t order by o;
