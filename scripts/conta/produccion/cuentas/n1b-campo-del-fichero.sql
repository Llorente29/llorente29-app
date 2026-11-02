-- scripts/conta/produccion/cuentas/n1b-campo-del-fichero.sql
--
-- N1 · respuesta 2 (01/11) · LO QUE CUENTA LA TANDA (2154), antes y después.
-- SOLO LEE, y solo el catálogo: nada crece solo.
-- quieta: _lab_campo cambia de cuerpo con la misma firma; no hay filas que cuenten.
select clave, valor from (
  select 1 o, '_lab_campo busca también por el código entre paréntesis (antes 0, después 1)' clave,
    (position('position(' in pg_get_functiondef('public._lab_campo(uuid,text,text)'::regprocedure)) > 0)::int::text valor
) t order by o;
