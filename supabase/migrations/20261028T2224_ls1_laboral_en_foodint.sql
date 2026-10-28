-- supabase/migrations/20261028T2224_ls1_laboral_en_foodint.sql
--
-- LS1 (28/10/2026) · Laboral en Sumied, encendido en Foodint (Julio, 28/10:
-- «Interruptor encendido en Foodint»). SOLO AÑADE una fila de feature_flags
-- (`conta_laboral`, la llave de Sumied › Laboral), como la plataforma da los
-- demás interruptores ('manual_grant').
--
-- Medido antes en producción (28/10, solo lectura): Foodint no tiene fila de
-- `conta_laboral` (tiene `conta` y `conta_impuestos`). Si ya la tuviera, no se
-- toca (`do nothing`): quien la puso manda. Sin Foodint (staging), no hace
-- nada. Se puede pasar dos veces.
--
-- Vuelta atrás: supabase/vuelta-atras/20261028T2224_ls1_laboral_en_foodint.down.sql

insert into public.feature_flags (account_id, feature_key, enabled, source, grant_reason)
select a.id, 'conta_laboral', true, 'manual_grant', 'LS1 (28/10/2026): Laboral en Sumied, encendido en Foodint (Julio)'
  from public.accounts a
 where a.id = '51ad1792-6629-4ef7-833a-b57b09a86710'
on conflict (account_id, feature_key) do nothing;
