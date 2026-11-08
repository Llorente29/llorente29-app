-- scripts/conta/produccion/cuentas/g04-pantalla-rapida.sql
--
-- G04 · LO QUE CUENTA LA TANDA de la 2308, antes y después. SOLO LEE.
--   1. Las cuatro funciones de lectura: 0 → 4.
--   2. Las cuatro tablas que sustituyen en la pantalla, con su RLS: siguen (4 → 4).
-- Los tiempos no van aquí (cambian solos de una vez a otra y el ensayo de la
-- vuelta atrás exige que la cuenta salga igual): se miden aparte, como
-- authenticated, y van en el parte del PR.
select clave, valor from (
  select 1 o, 'Funciones conta_lista_gc_cobros, _gc_mandatos, _gc_suscripciones y _fichas' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('conta_lista_gc_cobros', 'conta_lista_gc_mandatos', 'conta_lista_gc_suscripciones', 'conta_lista_fichas')) valor union all
  select 2, 'Tablas conta_gc_cobro, conta_gc_mandato, conta_gc_suscripcion y conta_gestoria_cliente con RLS',
    (select count(*)::text from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relrowsecurity
      and relname in ('conta_gc_cobro', 'conta_gc_mandato', 'conta_gc_suscripcion', 'conta_gestoria_cliente'))
) q order by o;
