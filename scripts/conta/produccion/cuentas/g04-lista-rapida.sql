-- scripts/conta/produccion/cuentas/g04-lista-rapida.sql
--
-- G04 · LO QUE CUENTA LA TANDA de la 2209, antes y después. SOLO LEE.
--   1. Las dos funciones de lectura: 0 → 2.
--   2. Las dos vistas que sustituyen en la pantalla: siguen (2 → 2).
-- Los tiempos no van aquí (cambian solos de una vez a otra y el ensayo de la
-- vuelta atrás exige que la cuenta salga igual): se miden aparte, como
-- authenticated, y van en el parte del PR.
select clave, valor from (
  select 1 o, 'Funciones conta_lista_clientes y conta_lista_que_hacer' clave,
    (select count(*)::text from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('conta_lista_clientes', 'conta_lista_que_hacer')) valor union all
  select 2, 'Vistas conta_consulta_cliente_empresa y conta_consulta_que_hacer',
    (select count(*)::text from pg_catalog.pg_class where relnamespace = 'public'::regnamespace and relname in ('conta_consulta_cliente_empresa', 'conta_consulta_que_hacer'))
) q order by o;
