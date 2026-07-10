-- 20260708T2500_cimiento_eventos_por_local.sql
--
-- CIMIENTO del frente #3 (eventos por CIUDAD DEL LOCAL, genérico para toda España).
-- Additivo, no rompe nada:
--   · local_event.location_id (nullable): null = evento de toda la cuenta (como hoy el
--     meteo); con valor = evento de ESE local. Permite que un partido en Madrid empuje
--     solo el local de Madrid, no el de Ciudad Real.
--   · locations.city: la ciudad del local (se rellena en la ficha del local). Es lo que
--     resuelve "ciudad → equipo" en el recolector de deportes.
--
-- El CHECK de local_event.event_type YA incluye 'sports' (verificado) → no se toca.

alter table public.local_event
  add column if not exists location_id uuid references public.locations(id) on delete cascade;

create index if not exists idx_local_event_location on public.local_event(location_id);

alter table public.locations
  add column if not exists city text;
