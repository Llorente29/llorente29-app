-- scripts/conta/produccion/cuentas/n1c-centro-de-folvy.sql
--
-- N1 · respuesta 3 (01/11) · LO QUE CUENTA LA TANDA (2248), antes y después.
-- SOLO LEE, y solo el catálogo: las dos funciones cambian de cuerpo con la
-- misma firma. Las personas, los contratos y los avisos cambian cuando el
-- administrador vuelve a «Pasar a las fichas», no con la tanda.
-- quieta: ninguna fila cambia al aplicar; el volcado lo lanza el administrador después.
select clave, valor from (
  select 1 o, 'funciones con «Sin centro en Cegid» (antes 0, después 2)' clave,
    ((position('__sin_centro__' in pg_get_functiondef('public.lab_centros_del_lote(uuid)'::regprocedure)) > 0)::int
     + (position('__sin_centro__' in pg_get_functiondef('public.lab_volcar_lote(uuid)'::regprocedure)) > 0)::int)::text valor
) t order by o;
