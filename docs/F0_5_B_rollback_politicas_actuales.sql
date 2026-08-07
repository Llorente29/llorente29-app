-- RED DE SEGURIDAD F0.5 Etapa B (capturada 2026-08-07 ANTES de reescribir).
-- Si el front deja de cargar tras cambiar políticas: ejecutar este fichero para volver al estado previo.
-- Refleja las 44 políticas RLS vivas de las 15 tablas núcleo de Team en el momento de la captura.

drop policy if exists clock_entries_delete on public.clock_entries;
create policy clock_entries_delete on public.clock_entries as permissive for delete to authenticated
  using ((EXISTS ( SELECT 1 FROM (employees e JOIN locations l ON ((l.id = e.location_id)))
  WHERE ((e.id = clock_entries.employee_id) AND current_user_is_admin_of(l.account_id)))));

drop policy if exists clock_entries_insert on public.clock_entries;
create policy clock_entries_insert on public.clock_entries as permissive for insert to authenticated
  with check ((EXISTS ( SELECT 1 FROM (employees e JOIN locations l ON ((l.id = e.location_id)))
  WHERE ((e.id = clock_entries.employee_id) AND (l.account_id = ANY (current_user_account_ids()))))));

drop policy if exists clock_entries_read on public.clock_entries;
create policy clock_entries_read on public.clock_entries as permissive for select to authenticated
  using ((EXISTS ( SELECT 1 FROM (employees e JOIN locations l ON ((l.id = e.location_id)))
  WHERE ((e.id = clock_entries.employee_id) AND (l.account_id = ANY (current_user_account_ids()))))));

drop policy if exists clock_entries_modify on public.clock_entries;
create policy clock_entries_modify on public.clock_entries as permissive for update to authenticated
  using ((EXISTS ( SELECT 1 FROM (employees e JOIN locations l ON ((l.id = e.location_id)))
  WHERE ((e.id = clock_entries.employee_id) AND current_user_is_admin_of(l.account_id)))))
  with check ((EXISTS ( SELECT 1 FROM (employees e JOIN locations l ON ((l.id = e.location_id)))
  WHERE ((e.id = clock_entries.employee_id) AND current_user_is_admin_of(l.account_id)))));

-- NOTA: el resto de las 15 tablas (course_attempt, employee_availability, employee_notifications,
-- employees, manager_permissions, monthly_balance_closures, open_shift_requests, open_shifts,
-- schedules, shift_swap_requests, shift_templates, training_path_progress, vacations) conservan sus
-- políticas actuales sin tocar hasta que lleguen su turno. Se capturan igual antes de cada bloque.
-- El generador para recapturar en cualquier momento (antes de tocar más tablas):
--   select string_agg(...) from pg_policies where tablename in (...);  (ver conversación 07/08)
