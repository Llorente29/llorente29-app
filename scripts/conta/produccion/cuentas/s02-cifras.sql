-- scripts/conta/produccion/cuentas/s02-cifras.sql
--
-- S02 · PR 3 · LO QUE CUENTA LA TANDA «LAS CIFRAS» (0490), antes y después.
-- SOLO LEE. Antes: sin las tres funciones, y el calendario con su md5 de
-- producción (cuerpo 480da33a…). Después: con las tres y el calendario con su
-- md5 nuevo. Y que no se mueve nada de Foodint de lo que leen (la tanda no
-- toca filas): sus movimientos del banco por aclarar o propuestos, sus
-- asientos sin validar y sus extractos. Lo de Foodint, con su cuenta (regla 9).
select clave, valor from (
  select 1 o, 'función conta_pendientes' clave, (to_regprocedure('public.conta_pendientes(uuid)') is not null)::text valor union all
  select 2, 'función conta_saldo_bancos', (to_regprocedure('public.conta_saldo_bancos(uuid,date)') is not null)::text union all
  select 3, 'función conta_saldos_terceros', (to_regprocedure('public.conta_saldos_terceros(uuid,date)') is not null)::text union all
  select 4, 'md5 cuerpo conta_impuesto_calendario', (select md5(prosrc) from pg_proc where oid = to_regprocedure('public.conta_impuesto_calendario(uuid,date)')) union all
  select 5, 'movimientos del banco de Foodint propuestos o por aclarar',
         (select count(*) from public.bank_movement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status in ('propuesto', 'por_aclarar', 'pendiente', 'posible_repetido'))::text union all
  select 6, 'asientos de Foodint sin validar',
         (select count(*) from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and status in ('propuesto', 'borrador'))::text union all
  select 7, 'extractos de Foodint', (select count(*) from public.bank_statement where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710')::text
) t order by o;
