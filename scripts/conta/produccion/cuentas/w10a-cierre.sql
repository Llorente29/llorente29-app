-- scripts/conta/produccion/cuentas/w10a-cierre.sql
--
-- W10a · cierre (29/10) · LO QUE CUENTA LA TANDA (1053), antes y después.
-- SOLO LEE. Ningún valor: filas y huellas cortas.
select clave, valor from (
  select 1 o, 'respaldo de la 1630 (trg_sale_push_status)' clave,
    -- quieta: esa fila solo la escribe la 1630 y solo la borra la 1053
    (select count(*) from public.funcion_respaldo where firma = 'public.trg_sale_push_status()'
       and migracion = '20261028T1630_w10a_order_advance_secreto_del_vault')::text valor union all
  select 2, 'respaldos con un secreto fv_',
    -- quieta: funcion_respaldo solo la escriben las migraciones
    (select count(*) from public.funcion_respaldo where definicion ~ '\mfv_[a-z0-9]+_[A-Za-z0-9]{16,}\M')::text union all
  select 3, 'huella corta de trg_sale_push_status',
    left(md5(pg_get_functiondef('public.trg_sale_push_status()'::regprocedure)), 8)
) t order by o;
