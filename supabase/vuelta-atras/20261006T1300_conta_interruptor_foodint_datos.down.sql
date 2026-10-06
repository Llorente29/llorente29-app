-- ============================================================================
-- Vuelta atrás de 20261006T1300_conta_interruptor_foodint_datos.sql: apaga
-- «Folvy Conta» para Foodint quitando la fila 'conta' que puso la tanda
-- (manual_grant). No toca ninguna otra fila de feature_flags.
-- Lo que haya hecho Foodint dentro del módulo (su empresa, su plan) NO se
-- borra: solo deja de verse la pestaña.
-- ============================================================================

delete from public.feature_flags
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and feature_key = 'conta'
   and source = 'manual_grant';
