-- scripts/conta/produccion/cuentas/g05-entrar-en-el-cliente.sql
--
-- G05 · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE. La misma vara a los
-- dos lados (regla 31). Lo que tiene que pasar con la tanda (y volver con su
-- vuelta atrás):
--   1. La columna user_profiles.advisor_account_id: 0 → 1.
--   2. El rastro conta_despacho_entrada: 0 → 1.
--   3. Funciones nuevas: 0 → 8.
--   4. Disparadores nuevos: 0 → 2.
--   5. user_profiles (todas las cuentas: es de personas, no de una cuenta):
--      filas · activas · con la bienvenida hecha. Las mismas: la tanda no toca filas.
--   6. Permisos vivos de asesoría (company_tax_presenter, todas las cuentas): los mismos.
--   7. Las funciones de antes que usa la tanda (mis_empresas, cambiar_empresa,
--      conta_despacho_clientes, _cuenta_activa), con su md5: las mismas.
select clave, valor from (
  select 1 o, 'Columna user_profiles.advisor_account_id' clave,
    (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'user_profiles' and column_name = 'advisor_account_id') valor union all
  select 2, 'Tabla conta_despacho_entrada', (select (to_regclass('public.conta_despacho_entrada') is not null)::int::text) union all
  select 3, 'Funciones nuevas',
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('conta_despacho_entrar', 'conta_despacho_volver', 'conta_despacho_mis_clientes', 'conta_despacho_donde',
                         '_conta_despachos_de_quien_llama', '_conta_bienvenida_heredada', '_conta_despacho_retirar', 'mi_bienvenida_hecha')) union all
  select 4, 'Disparadores nuevos',
    (select count(*)::text from pg_catalog.pg_trigger where not tgisinternal and tgname in ('user_profiles_bienvenida_heredada', 'company_tax_presenter_despacho_retirar')) union all
  select 5, 'user_profiles (todas las cuentas): filas · activas · con bienvenida',
    (select count(*) || ' · ' || count(*) filter (where active) || ' · ' || count(welcome_completed_at) from public.user_profiles) union all
  select 6, 'Permisos vivos de asesoría (todas las cuentas)',
    (select count(*)::text from public.company_tax_presenter where mode = 'advisor' and consented_at is not null and revoked_at is null) union all
  select 7, 'Funciones de antes, md5',
    (select string_agg(p.proname || ' ' || left(md5(pg_catalog.pg_get_functiondef(p.oid)), 8), ', ' order by p.proname)
       from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('mis_empresas', 'cambiar_empresa', 'conta_despacho_clientes', '_cuenta_activa'))
) q order by o;
