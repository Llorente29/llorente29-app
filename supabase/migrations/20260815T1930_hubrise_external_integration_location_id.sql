-- 20260815T1930_hubrise_external_integration_location_id.sql
-- ENCARGO CODE — módulo de conexión HubRise, FASE 1.2.
-- Aplicada por MCP (verificada 2026-08-15: columna+FK, función, trigger y
-- backfill confirmados de forma independiente vía information_schema/
-- pg_constraint/pg_trigger/consulta directa).
--
-- location_id (FK a locations) en external_integration. Hoy se casa por el
-- string external_location_id; external_location_map YA resuelve
-- (account_id, source, external_location_id) -> locations.id (es la misma
-- fuente que usa hubrise-webhook.resolveLocation). Reusamos esa fuente aquí
-- para no duplicar el casado.
--
-- Backfill verificado: las 5 filas hubrise resolvieron su location_id
-- (Foodint Alcalá / Folvy Interno Alcalá); las filas lastapp sin
-- external_location_id quedan en null (correcto, no hay nada que casar).

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='external_integration' and column_name='location_id'
  ) then
    alter table public.external_integration
      add column location_id uuid references public.locations(id);
  end if;
end $$;

create or replace function public.trg_external_integration_fill_location_id()
returns trigger
language plpgsql
as $$
declare
  should_resolve boolean;
begin
  if tg_op = 'INSERT' then
    should_resolve := true;
  else
    should_resolve := (new.external_location_id is distinct from old.external_location_id)
      or (new.account_id is distinct from old.account_id)
      or (new.source is distinct from old.source);
  end if;

  if new.external_location_id is null then
    new.location_id := null;
    return new;
  end if;

  if should_resolve then
    select elm.location_id into new.location_id
    from public.external_location_map elm
    where elm.account_id = new.account_id
      and elm.source = new.source
      and elm.external_location_id = new.external_location_id
      and elm.is_active = true
    limit 1;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ei_fill_location_id on public.external_integration;
create trigger trg_ei_fill_location_id
before insert or update on public.external_integration
for each row
execute function public.trg_external_integration_fill_location_id();

-- Backfill de las filas existentes (no depende del trigger).
update public.external_integration ei
set location_id = elm.location_id
from public.external_location_map elm
where ei.location_id is null
  and ei.external_location_id is not null
  and elm.account_id = ei.account_id
  and elm.source = ei.source
  and elm.external_location_id = ei.external_location_id
  and elm.is_active = true;
