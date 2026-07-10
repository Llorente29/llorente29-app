-- 20260708T2600_sports_teams_y_key.sql
--
-- Frente #3 (deportes): base para el recolector sports-events.
--  · football_team_city: equipo → ciudad (poblada por el recolector desde API-Football,
--    que da venue.city de cada equipo). GLOBAL (no por cuenta): es dato de referencia
--    del mundo, no de un cliente. Ampliable a más ligas cambiando el seed del recolector.
--  · read_apifootball_key(): lee la key del Vault sin exponerla (el Edge la usa; nunca
--    va al código ni al chat). SECURITY DEFINER, solo service_role.

create table if not exists public.football_team_city (
  team_id    integer primary key,
  team_name  text not null,
  city       text,
  league     text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_football_team_city_city on public.football_team_city(lower(city));

create or replace function public.read_apifootball_key()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'apifootball_key' limit 1;
$$;

revoke all on function public.read_apifootball_key() from public;
grant execute on function public.read_apifootball_key() to service_role;
