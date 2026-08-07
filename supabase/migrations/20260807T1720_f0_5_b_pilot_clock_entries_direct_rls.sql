-- Aplicada: 2026-08-07 por MCP. Verificada en front (Control Horario carga los 86 fichajes).
-- F0.5 Etapa B (piloto) · clock_entries: RLS por account_id directo (equivalente exacto del join).
drop policy if exists clock_entries_read   on public.clock_entries;
drop policy if exists clock_entries_insert on public.clock_entries;
drop policy if exists clock_entries_modify on public.clock_entries;
drop policy if exists clock_entries_delete on public.clock_entries;
create policy clock_entries_read   on public.clock_entries as permissive for select to authenticated using (account_id = any(current_user_account_ids()));
create policy clock_entries_insert on public.clock_entries as permissive for insert to authenticated with check (account_id = any(current_user_account_ids()));
create policy clock_entries_modify on public.clock_entries as permissive for update to authenticated using (current_user_is_admin_of(account_id)) with check (current_user_is_admin_of(account_id));
create policy clock_entries_delete on public.clock_entries as permissive for delete to authenticated using (current_user_is_admin_of(account_id));
