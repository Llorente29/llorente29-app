-- supabase/migrations/20261031T1705_s01f_auditoria_interruptor.sql
--
-- cambia: public.platform_audit_log · prueba: supabase/staging/sql/20261031_s01f_interruptores_prueba.sql
--
-- S01f · La auditoría de la plataforma admite un tipo de evento más:
-- «account_feature_changed», el cambio de un interruptor de Sumied de una
-- cuenta (contabilidad, impuestos o laboral). Decisión de Julio (31/10,
-- respuesta a): tipo propio, para poder filtrarlo en AuditoriaPage, y no
-- mezclado con «account_modules_changed», que es la suscripción.
--
-- Solo AMPLÍA el CHECK: los 21 tipos de antes siguen valiendo. La tabla es
-- pequeña (24 filas el 31/10) y no está en el camino del pedido.

alter table public.platform_audit_log
  drop constraint platform_audit_log_event_type_valid,
  add constraint platform_audit_log_event_type_valid check (event_type = any (array[
    'account_created', 'account_suspended', 'account_unsuspended', 'account_archived', 'account_unarchived',
    'account_deleted', 'account_restored', 'account_status_changed', 'account_modules_changed',
    'impersonation_started', 'impersonation_ended', 'admin_created', 'admin_suspended', 'admin_reactivated',
    'admin_role_changed', 'admin_2fa_reset', 'admin_permissions_changed', 'seed_data_modified',
    'system_config_changed', 'global_notification_sent', 'permission_set_modified',
    'account_feature_changed'
  ]::text[]));
