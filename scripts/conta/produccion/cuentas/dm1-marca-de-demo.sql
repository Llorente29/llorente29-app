-- scripts/conta/produccion/cuentas/dm1-marca-de-demo.sql
--
-- DM1 · PR 2a (31/10) · LO QUE CUENTA LA TANDA (0907 y 1713), antes y después.
-- SOLO LEE. Las cuentas son de la TABLA ENTERA, todas a propósito: lo que se
-- mide es que ninguna pasa a ser de demo por aplicarla.
select clave, valor from (
  select 1 o, 'accounts.is_demo existe (antes false, después true)' clave,
    exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'is_demo')::text valor union all
  select 2, 'funciones nuevas: cuenta_puede_salir y _accounts_is_demo_solo_plataforma (antes 0, después 2)',
    ((to_regprocedure('public.cuenta_puede_salir(uuid)') is not null)::int
     + (to_regprocedure('public._accounts_is_demo_solo_plataforma()') is not null)::int)::text union all
  select 3, 'cuentas de antes del 31/10 09:00 UTC marcadas de demo (antes 0, después 0)',
    coalesce((select (xpath('/row/n/text()', query_to_xml('select count(*) n from public.accounts where is_demo and created_at < timestamptz ''2026-10-31 09:00:00+00''', false, true, '')))[1]::text
               where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'is_demo')), '0') union all
  select 5, 'encolar_alerta: huella (antes 36a9dfb7; después otra; deshecha, 36a9dfb7)',
    left(md5(pg_get_functiondef('public.encolar_alerta(text,text,text,text,interval,uuid,uuid,uuid,text)'::regprocedure)), 8) union all
  select 4, 'cuentas creadas antes del 31/10 09:00 UTC (igual antes y después)', (select count(*) from public.accounts where created_at < timestamptz '2026-10-31 09:00:00+00')::text
) t order by o;
