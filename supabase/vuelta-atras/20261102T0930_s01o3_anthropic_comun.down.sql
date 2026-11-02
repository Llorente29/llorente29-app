-- supabase/vuelta-atras/20261102T0930_s01o3_anthropic_comun.down.sql
--
-- Vuelta atrás de la 0141: Anthropic deja de ser común.
update public.supplier set default_common = false, updated_at = now()
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'ff2629d5-e6d1-4093-98dd-1b00b3fe9cf8';
