-- scripts/conta/produccion/cuentas/l1ah-firma-interruptor.sql
--
-- L1a-H (29/10) · LO QUE CUENTA LA TANDA (1135), antes y después. SOLO LEE.
-- La columna nace en NULL en todas las cuentas: ninguna encendida, Foodint
-- incluida. Las firmas ya hechas no se tocan.
select clave, valor from (
  select 1 o, 'accounts.firma_registro_mes existe · la sesión la lee (antes false · false, después true · true)' clave,
    (exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'firma_registro_mes'))::text
      || ' · ' || coalesce((select has_column_privilege('authenticated', 'public.accounts', 'firma_registro_mes', 'select')
                             where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'accounts' and column_name = 'firma_registro_mes'))::text, 'false') valor union all
  select 2, 'firma_registro_mes_pedir existe (antes false, después true)',
    (to_regprocedure('public.firma_registro_mes_pedir(uuid,boolean)') is not null)::text union all
  select 3, 'cuentas con la firma encendida (antes y después 0)',
    -- quieta: la columna nace en NULL y solo la cambia firma_registro_mes_pedir, que nadie llama hasta que el front la publique
    (select count(*) from public.accounts a where (to_jsonb(a) ->> 'firma_registro_mes') = 'true')::text union all
  select 4, 'firmas del registro hechas antes del 29/10 11:30 UTC (igual antes y después)',
    (select count(*) from public.registro_jornada_firma where firmado_at < timestamptz '2026-10-29 11:30:00+00')::text
) t order by o;
