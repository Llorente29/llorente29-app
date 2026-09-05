-- social_n2_usage tiene account_id y NO tiene RLS: anon podía leer/escribir cross-tenant.
revoke all on table public.social_n2_usage from anon;
-- football_team_city es referencia pública: quitar solo la escritura a anon, dejar SELECT.
revoke insert, update, delete, truncate, references, trigger on table public.football_team_city from anon;