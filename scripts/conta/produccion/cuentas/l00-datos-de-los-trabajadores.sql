-- scripts/conta/produccion/cuentas/l00-datos-de-los-trabajadores.sql
--
-- L00 · Respuesta 1 · cerrar los datos de los trabajadores · LO QUE CUENTA LA
-- TANDA, antes y después. SOLO LEE. De tabla entera a propósito (regla 9): son
-- permisos y estructura, de todas las cuentas a la vez. No cuenta fichajes ni
-- filas vivas (se mueven solas mientras se aplica).
select clave, valor from (
  select 1 o, 'almacén de documentos público' clave,
    (select case when b.public then 'sí' else 'no' end from storage.buckets b where b.id = 'employee-documents') valor union all
  select 2, 'políticas del almacén de documentos',
    (select coalesce(string_agg(p.policyname, ',' order by p.policyname), '(ninguna)') from pg_policies p
      where p.schemaname = 'storage' and p.tablename = 'objects'
        and (coalesce(p.qual, '') || coalesce(p.with_check, '')) ~ 'employee-documents') union all
  select 3, 'ficheros del almacén de documentos',
    (select count(*)::text from storage.objects o where o.bucket_id = 'employee-documents') union all
  select 4, 'lecturas de personal abiertas a toda la cuenta',
    (select count(*)::text from pg_policies p where p.schemaname = 'public' and p.cmd = 'SELECT'
      and p.tablename in ('employees','clock_entries','vacations','payroll_cost','payroll_inbox','documents','clock_entry_audit','clock_correction_request','employee_notifications','monthly_balance_closures')
      and p.qual ~ 'current_user_account_ids' and p.qual !~ 'current_user_is_employee|current_user_is_admin_or_manager_of') union all
  select 5, 'fichar exige ser tú o el encargado',
    (select case when p.with_check ~ 'current_user_is_employee' then 'sí' else 'no' end from pg_policies p
      where p.schemaname = 'public' and p.tablename = 'clock_entries' and p.policyname = 'clock_entries_insert') union all
  select 6, 'PIN en claro en employees',
    (select count(*)::text from public.employees e where nullif(btrim(e.pin), '') is not null) union all
  select 7, 'PIN guardados aparte',
    (select case when to_regclass('public.employee_kiosk_pin') is null then 'no existe'
            else (xpath('/row/n/text()', query_to_xml('select count(*) n from public.employee_kiosk_pin', false, true, '')))[1]::text end) union all
  select 8, 'disparadores nuevos de fichar',
    (select coalesce(string_agg(t.tgname, ',' order by t.tgname), '(ninguno)') from pg_trigger t
      where t.tgrelid = 'public.clock_entries'::regclass and t.tgname in ('trg_clock_a_quien_y_hora', 'clock_entry_audit_alta')) union all
  select 9, 'huella de employee_clock_status',
    (select string_agg(left(md5(p.prosrc), 8), ',') from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'employee_clock_status') union all
  select 10, 'funciones sin guarda que se llaman con sesión',
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
      and p.proname in ('migrate_locations_and_staff','location_labor_cost','location_economics','close_month_balance')
      and has_function_privilege('authenticated', p.oid, 'execute')) union all
  select 11, 'compañeros de trabajo (función)',
    (select case when to_regprocedure('public.companeros_de_trabajo(uuid[])') is null then 'no existe' else 'existe' end)
) t order by o;
