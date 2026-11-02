-- scripts/conta/produccion/cuentas/lab2-importador-filas.sql
--
-- LAB2 · tanda 2 (30/10) · LO QUE CUENTA LA TANDA (0950), antes y después.
-- SOLO LEE, y solo el catálogo: nada crece solo.
select clave, valor from (
  select 1 o, 'funciones de las filas (antes 0, después 2)' clave,
    (select count(*) from (values ('public.lab_import_cargar_filas(uuid,text,integer,jsonb)'),
                                  ('public.lab_import_terminar_filas(uuid,jsonb)')) x(f)
      where to_regprocedure(x.f) is not null)::text valor
) t order by o;
