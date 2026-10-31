-- supabase/vuelta-atras/20261031T1705_s01f_auditoria_interruptor.down.sql
--
-- Vuelta atrás de 20261031T1705_s01f_auditoria_interruptor.sql: el CHECK
-- vuelve a los 21 tipos de antes. La auditoría no se puede borrar
-- (trg_platform_audit_immutable): si ya hay apuntes «account_feature_changed»,
-- el CHECK de antes vuelve como NOT VALID, que no mira las filas que ya hay y
-- sí las nuevas. Así la vuelta atrás nunca falla por un apunte que no se puede quitar.

do $$
declare
  v_lista text := $l$'account_created', 'account_suspended', 'account_unsuspended', 'account_archived', 'account_unarchived',
    'account_deleted', 'account_restored', 'account_status_changed', 'account_modules_changed',
    'impersonation_started', 'impersonation_ended', 'admin_created', 'admin_suspended', 'admin_reactivated',
    'admin_role_changed', 'admin_2fa_reset', 'admin_permissions_changed', 'seed_data_modified',
    'system_config_changed', 'global_notification_sent', 'permission_set_modified'$l$;
  v_hay boolean;
begin
  select exists (select 1 from public.platform_audit_log where event_type = 'account_feature_changed') into v_hay;
  execute 'alter table public.platform_audit_log drop constraint platform_audit_log_event_type_valid';
  execute format('alter table public.platform_audit_log add constraint platform_audit_log_event_type_valid check (event_type = any (array[%s]::text[]))%s',
                 v_lista, case when v_hay then ' not valid' else '' end);
end $$;
