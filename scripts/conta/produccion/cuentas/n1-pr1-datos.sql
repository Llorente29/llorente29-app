-- scripts/conta/produccion/cuentas/n1-pr1-datos.sql
--
-- N1 · PR 1 (01/11) · LO QUE CUENTA LA TANDA (1937, 1938 y 1939), antes y
-- después. SOLO LEE, y solo el catálogo: nada crece solo (las tablas nacen
-- vacías; el volcado lo lanza el administrador desde la pantalla, después).
select clave, valor from (
  select 1 o, 'tablas de Laboral (antes 0, después 11)' clave,
    (select count(*) from (values ('public.lab_permiso'), ('public.lab_persona'), ('public.lab_convenio'), ('public.lab_convenio_tabla'),
                                  ('public.lab_concepto'), ('public.lab_contrato'), ('public.lab_contrato_condicion'),
                                  ('public.lab_persona_concepto'), ('public.lab_modelo_145'), ('public.lab_cambio'),
                                  ('public.lab_centro_local')) x(t)
      where to_regclass(x.t) is not null)::text valor
  union all
  select 2, 'funciones del permiso y del volcado (antes 0, después 6)',
    (select count(*) from (values ('public.current_user_ve_laboral(uuid)'), ('public.lab_dar_permiso(uuid,uuid)'),
                                  ('public.lab_quitar_permiso(uuid,uuid)'), ('public.lab_centros_del_lote(uuid)'),
                                  ('public.lab_confirmar_centro(uuid,text,uuid)'), ('public.lab_volcar_lote(uuid)')) x(f)
      where to_regprocedure(x.f) is not null)::text
  union all
  select 3, 'columnas nuevas de documents (antes 0, después 8)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'documents'
        and column_name in ('carpeta', 'origen', 'caduca_el', 'visible_trabajador', 'firmado_at', 'firmado_por', 'firma', 'archivado_at'))::text
  union all
  select 4, 'empleados_datos_privados con el permiso de Laboral (antes 0, después 1)',
    (position('current_user_ve_laboral' in pg_get_functiondef('public.empleados_datos_privados(uuid)'::regprocedure)) > 0)::int::text
) t order by o;
