-- 20260725T1000_kpi_cocina_umbrales.sql
-- ============================================================================
-- KPI DE COCINA — UMBRALES DE TIEMPO POR LOCAL (kitchen_time_config).
-- ============================================================================
-- Config por local que colorea el chip de tiempo y define el techo de incidencia.
-- Semáforo: verde < green_max · ámbar hasta amber_max · rojo por encima · INCIDENCIA
-- al pasar ceiling. floor_minutes descarta ruidos absurdos.
--
-- YA APLICADA A MANO en producción (25/07/2026). Este fichero la VERSIONA (registro;
-- NO re-ejecutar por db push). Reconstruida EXACTA desde la BBDD: PK location_id, FK
-- ON DELETE CASCADE, CHECK de coherencia de tramos, RLS calcada de
-- delivery_watchdog_config. Verificado: 7 filas = 7 locales (sembrada). Idempotente.
-- ============================================================================

create table if not exists public.kitchen_time_config (
  location_id       uuid        primary key references public.locations(id) on delete cascade,
  enabled           boolean     not null default true,
  green_max_minutes integer     not null default 15,
  amber_max_minutes integer     not null default 25,
  ceiling_minutes   integer     not null default 30,
  floor_minutes     integer     not null default 3,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint kitchen_time_config_tramos_coherentes check (
    floor_minutes >= 0
    and floor_minutes     < green_max_minutes
    and green_max_minutes < amber_max_minutes
    and amber_max_minutes <= ceiling_minutes
  )
);

alter table public.kitchen_time_config enable row level security;

drop policy if exists kitchen_time_config_rw on public.kitchen_time_config;
create policy kitchen_time_config_rw on public.kitchen_time_config
  for all
  using (
    current_user_is_admin()
    or exists (
      select 1 from public.locations l
      where l.id = kitchen_time_config.location_id
        and current_user_is_admin_or_manager_of(l.account_id)
    )
  )
  with check (
    current_user_is_admin()
    or exists (
      select 1 from public.locations l
      where l.id = kitchen_time_config.location_id
        and current_user_is_admin_or_manager_of(l.account_id)
    )
  );

-- Semilla por local (idempotente): defaults para cada local que aún no tenga fila.
insert into public.kitchen_time_config (location_id)
select id from public.locations
on conflict (location_id) do nothing;
