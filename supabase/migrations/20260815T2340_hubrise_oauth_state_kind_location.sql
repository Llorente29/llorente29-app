-- 20260815T2340_hubrise_oauth_state_kind_location.sql
-- ENCARGO CODE — módulo de conexión HubRise, 2.1 punto 4 (15/08/2026).
--
-- hubrise_oauth_state gana `kind` ('writer'|'location') y `location_id`
-- (Folvy, nullable, NOT NULL solo cuando kind='location'). Permite que
-- hubrise-oauth-start inicie un flujo de LOCATION (scope location[orders.write])
-- ademas del de siempre (writer, scope de cuenta) sin romper el flujo actual:
-- kind por defecto 'writer', location_id null -- una fila insertada exactamente
-- como hoy (sin threading estos parametros) sigue siendo valida y se comporta
-- igual.
--
-- location_id referencia public.locations(id) -- mismo patron que
-- external_integration.location_id (20260815T1930).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='hubrise_oauth_state' and column_name='kind'
  ) then
    alter table public.hubrise_oauth_state add column kind text not null default 'writer';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='hubrise_oauth_state' and column_name='location_id'
  ) then
    alter table public.hubrise_oauth_state
      add column location_id uuid references public.locations(id);
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'hubrise_oauth_state_kind_chk'
  ) then
    alter table public.hubrise_oauth_state
      add constraint hubrise_oauth_state_kind_chk
      check (kind in ('writer', 'location'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'hubrise_oauth_state_location_kind_chk'
  ) then
    alter table public.hubrise_oauth_state
      add constraint hubrise_oauth_state_location_kind_chk
      check (
        (kind = 'location' and location_id is not null)
        or (kind = 'writer' and location_id is null)
      );
  end if;
end $$;
