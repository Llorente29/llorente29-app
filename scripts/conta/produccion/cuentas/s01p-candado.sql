-- scripts/conta/produccion/cuentas/s01p-candado.sql
--
-- S01p·2 · LO QUE CUENTA LA TANDA (1120 y 1121), antes y después. SOLO LEE.
select clave, valor from (
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 1 o, 'company tiene month_close_day y payroll_pay_days (antes 0, después 2)' clave,
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'company'
      and column_name in ('month_close_day', 'payroll_pay_days')) valor
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 2, 'conta_mes_cerrado solo bloquea el corte y lo presentado (antes 0, después 1)',
    (strpos(pg_get_functiondef('public.conta_mes_cerrado(uuid,date)'::regprocedure), 'migrated') > 0)::int::text
  union all
  -- quieta: catálogo; solo lo cambia esta tanda.
  select 3, 'Disparadores nuevos en journal_entry (antes 0, después 2)',
    (select count(*)::text from pg_trigger where tgrelid = 'public.journal_entry'::regclass
      and tgname in ('s01p_mes_cambio', 'trg_journal_entry_0_trimestre_presentado'))
  union all
  -- quieta: los 9 meses del corte con Diez de Foodint; solo los cambia un cierre o una reapertura, y Foodint no cierra ninguno hasta que exista la pantalla.
  select 4, 'Meses de Foodint que no admiten nada (antes 9, después 9)',
    (select count(*)::text from public.fiscal_period_lock l
      where l.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
        and l.reopened_at is null and public.conta_mes_cerrado(l.company_id, l.month))
  union all
  -- quieta: una fila concreta de Foodint; solo la cambia esta tanda o su ficha.
  select 5, 'Días de Foodint: cierre y nómina (antes «(sin columnas) · -», después «7 · {5,6}»)',
    (select coalesce(row_to_json(c)->>'month_close_day', '(sin columnas)') || ' · ' || coalesce(row_to_json(c)->>'payroll_pay_days', '-')
       from public.company c where c.id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')
) t order by o;
