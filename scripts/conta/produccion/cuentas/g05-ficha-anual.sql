-- scripts/conta/produccion/cuentas/g05-ficha-anual.sql
--
-- G05 · La cifra de GoCardless del mes en la ficha y Clientes (nº 82) · LO QUE
-- CUENTA LA TANDA, antes y después. SOLO LEE. La misma vara a los dos lados
-- (regla 31). Medido antes el 10/11 a las 12:19 UTC. Lo que tiene que pasar:
--   1. conta_gocardless_del_mes existe: false → true.
--   2. conta_lista_clientes sigue igual (la de antes, sin tocar): true → true.
--   3. Suscripciones de GoCardless (todas las cuentas, leídas hasta el corte): quieta.
select clave, valor from (
  select 1 o, 'conta_gocardless_del_mes existe' clave,
    (to_regprocedure('public.conta_gocardless_del_mes(uuid,text)') is not null)::text valor union all
  select 2, 'conta_lista_clientes existe',
    (to_regprocedure('public.conta_lista_clientes(uuid)') is not null)::text union all
  select 3, 'Suscripciones de GoCardless (todas las cuentas, hasta el corte)',
    (select count(*)::text from public.conta_gc_suscripcion where leido_at < timestamptz '2026-11-10 12:00:00+00')
) q order by o;
