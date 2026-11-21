-- scripts/conta/produccion/cuentas/s01p-documento-sin-leer.sql
--
-- S01p·18.2 · punto 3 · El documento sin leer · LO QUE CUENTA LA TANDA, antes y después. SOLO LEE.
--   1. La bandeja de Foodint por estado: igual antes y después (la tanda no elimina nada: lo hace Julio desde la pantalla).
--   2. La actividad de la bandeja de Foodint: cuántas, igual antes y después.
select clave, valor from (
  -- quieta: la tanda no mueve ninguna llegada
  select 1 o, 'Foodint · bandeja por estado' clave,
    (select string_agg(k || '=' || n, ' · ' order by k) from (
       select status k, count(*)::text n from public.document_inbox where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' group by 1) x) valor
  union all
  -- corte: la actividad de la bandeja de Foodint anterior al 13/11/2026 10:00 de Madrid
  select 2, 'Foodint · actividad de la bandeja',
    (select count(*)::text from public.document_activity where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and created_at < timestamptz '2026-11-13 10:00+01')
) t order by o;
