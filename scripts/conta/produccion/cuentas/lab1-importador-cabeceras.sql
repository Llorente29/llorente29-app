-- scripts/conta/produccion/cuentas/lab1-importador-cabeceras.sql
--
-- LAB1 · tanda 1 (29/10) · LO QUE CUENTA LA TANDA (0850), antes y después.
-- SOLO LEE, y solo el catálogo: nada crece solo.
select clave, valor from (
  select 1 o, 'tablas del importador (antes 0, después 2)' clave,
    (select count(*) from (values ('public.lab_import_lote'), ('public.lab_import_fila')) x(t) where to_regclass(x.t) is not null)::text valor union all
  select 2, 'lab_import_leer_cabeceras (antes no, después sí)',
    (to_regprocedure('public.lab_import_leer_cabeceras(uuid,text,text,jsonb,jsonb)') is not null)::text union all
  select 3, 'políticas de las dos tablas (antes 0, después 2: solo leer, solo el administrador)',
    (select count(*) from pg_policy where polrelid in (select c.oid from pg_class c where c.relnamespace = 'public'::regnamespace
       and c.relname in ('lab_import_lote', 'lab_import_fila')))::text
) t order by o;
