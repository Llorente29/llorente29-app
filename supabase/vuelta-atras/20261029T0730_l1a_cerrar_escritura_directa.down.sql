-- supabase/vuelta-atras/20261029T0730_l1a_cerrar_escritura_directa.down.sql
--
-- Deja clock_entries y export_gestoria_mensual como estaban antes de la 0730
-- (producción, medido el 29/10/2026): las tres políticas de escritura con su texto
-- exacto, los privilegios de tabla y la función con su huella
-- (_restaurar_funcion la compara).

grant insert, update, delete, truncate on public.clock_entries to authenticated, anon;
drop policy if exists clock_entries_insert on public.clock_entries;
drop policy if exists clock_entries_modify on public.clock_entries;
drop policy if exists clock_entries_delete on public.clock_entries;
create policy clock_entries_insert on public.clock_entries for insert to authenticated
  with check (current_user_is_admin_or_manager_of(account_id) or current_user_is_employee(employee_id, account_id));
create policy clock_entries_modify on public.clock_entries for update to authenticated
  using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));
create policy clock_entries_delete on public.clock_entries for delete to authenticated
  using (current_user_is_admin_of(account_id));

select public._restaurar_funcion('public.export_gestoria_mensual(uuid,date,date)', '20261029T0730_l1a_cerrar_escritura_directa');
