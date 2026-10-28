-- scripts/conta/produccion/cuentas/l1a-correcciones-e-informe.sql
--
-- L1a · PR 2 (28/10) · LO QUE CUENTA LA TANDA (0705 y 0706), antes y después.
-- SOLO LEE, y solo el catálogo (pg_proc, pg_trigger, tablas y columnas): nada
-- crece solo. La 0700 y su cerrojo salieron al PR 2b (respuesta 5 de Julio).
select clave, valor from (
  select 1 o, 'huellas de las cuatro funciones de corrección que cambia' clave,
    (select string_agg(p.proname || ' ' || left(md5(pg_get_functiondef(p.oid)), 8), ' · ' order by p.proname) from pg_proc p
      where p.pronamespace = 'public'::regnamespace and p.proname in ('edit_clock_entry', 'void_clock_entry', 'resolve_clock_correction', 'request_clock_correction')) valor union all
  select 2, 'funciones nuevas (conformidad, firma, informe, enlace, para revisar)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('responder_correccion', 'firmar_registro_mes', 'informe_registro_jornada', '_informe_registro_jornada', 'crear_enlace_inspeccion',
                        'revocar_enlace_inspeccion', 'informe_por_enlace', 'jornadas_para_revisar', '_puede_corregir', '_huella_registro_mes', '_mes_madrid',
                        '_clock_audit_conformidad', '_registro_firma_invalidar'))::text union all
  select 3, 'tablas nuevas (firma del mes, enlace)',
    (select count(*) from (values ('public.registro_jornada_firma'), ('public.registro_jornada_enlace')) x(t) where to_regclass(x.t) is not null)::text union all
  select 4, 'columnas nuevas del rastro (conformidad, peticion_id)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'clock_entry_audit'
      and column_name in ('conformidad', 'conformidad_at', 'conformidad_nota', 'peticion_id'))::text union all
  select 5, 'disparadores nuevos (conformidad en el rastro, firma sin valor)',
    (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_clock_audit_conformidad', 'trg_registro_firma_invalidar'))::text
) t order by o;
