-- scripts/conta/produccion/cuentas/g04-pantalla-rapida.sql
--
-- G04 · LO QUE CUENTA LA TANDA de la 2308, antes y después. SOLO LEE.
--   1. Las tres funciones de la pantalla: 0 → 3.
--   2. Las tablas de GoCardless y de la ficha que la pantalla deja de leer
--      enteras, con su RLS: siguen (4 → 4).
-- Los tiempos no van aquí (cambian solos de una vez a otra y el ensayo de la
-- vuelta atrás exige que la cuenta salga igual): se miden aparte, como
-- authenticated, y van en el parte del PR.
select clave, valor from (
  select 1 o, 'Funciones conta_pantalla_clientes, conta_pantalla_ficha y conta_pantalla_asignar' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('conta_pantalla_clientes', 'conta_pantalla_ficha', 'conta_pantalla_asignar')) valor union all
  select 2, 'Tablas conta_gc_cobro, conta_gc_mandato, conta_gc_suscripcion y conta_gestoria_cliente con RLS',
    (select count(*)::text from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
      and relname in ('conta_gc_cobro', 'conta_gc_mandato', 'conta_gc_suscripcion', 'conta_gestoria_cliente'))
) q order by o;
