-- supabase/migrations/20260724T2320_reparto_vigia_tiempo.sql
-- ============================================================================
-- CAPA 4 — VIGÍA POR TIEMPO del reparto (red independiente de la plataforma).
-- ============================================================================
-- Caza pedidos de reparto PARADOS demasiado tiempo aunque Catcher no avise. Escribe
-- en la MISMA superficie de alarma que Capa 2 (delivery_alarm_*), así que salta el
-- mismo banner+sonido en cocina. Umbrales POR LOCAL, editables en Ajustes.
--   · "en reparto"  > 45 min  (desde handed_to_courier_at)  -> stalled_in_delivery
--   · "sin cerrar"  > 90 min  (desde que entró)             -> stalled_unclosed
--
-- CIMIENTO COMPARTIDO: sale.handed_to_courier_at, sellado al pasar a in_delivery
-- (cubre reparto propio y plataforma en un solo sitio). Sirve también a un futuro
-- KPI de tiempos de cocina. Vigía = función SQL pura + cron (sin Edge: la alarma es
-- un UPDATE, no un email). DDL sin BEGIN/COMMIT. Idempotente.
-- ============================================================================

-- ── 1. Cimiento: sello "desde cuándo está en reparto" ────────────────────────
alter table public.sale add column if not exists handed_to_courier_at timestamptz;

create or replace function public.tg_sale_seal_handed_to_courier()
returns trigger
language plpgsql
as $$
begin
  -- BEFORE UPDATE: al TRANSICIONAR delivery_state a 'in_delivery', sella la hora una
  -- sola vez (no se re-sella si vuelve a pasar por in_delivery). Cubre reparto propio
  -- (trigger espejo) y plataforma/Catcher (webhook), que es donde se escribe delivery_state.
  if new.delivery_state is distinct from old.delivery_state
     and new.delivery_state = 'in_delivery'
     and new.handed_to_courier_at is null then
    new.handed_to_courier_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sale_seal_handed_to_courier on public.sale;
create trigger trg_sale_seal_handed_to_courier
  before update on public.sale
  for each row
  execute function public.tg_sale_seal_handed_to_courier();

-- ── 2. Config de umbrales POR LOCAL (editable en Ajustes) ────────────────────
create table if not exists public.delivery_watchdog_config (
  location_id                   uuid PRIMARY KEY REFERENCES public.locations(id) ON DELETE CASCADE,
  enabled                       boolean   NOT NULL DEFAULT true,
  in_delivery_threshold_minutes integer   NOT NULL DEFAULT 45,   -- "en reparto"
  unsealed_threshold_minutes    integer   NOT NULL DEFAULT 90,   -- "sin cerrar"
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);
comment on table public.delivery_watchdog_config is 'Umbrales del vigía de reparto por local (min "en reparto" / "sin cerrar").';

alter table public.delivery_watchdog_config enable row level security;
-- Lectura y escritura para admin de plataforma o admin/manager de la cuenta del local.
create policy dwc_rw on public.delivery_watchdog_config
  for all
  using (
    current_user_is_admin()
    or exists (select 1 from public.locations l
                where l.id = location_id and current_user_is_admin_or_manager_of(l.account_id))
  )
  with check (
    current_user_is_admin()
    or exists (select 1 from public.locations l
                where l.id = location_id and current_user_is_admin_or_manager_of(l.account_id))
  );

-- ── 3. El vigía: levanta la alarma de Capa 2 en pedidos parados ──────────────
-- Función pura (SECURITY DEFINER, la llama el cron con service_role → salta RLS).
-- Solo levanta si NO hay ya una alarma viva (delivery_alarm_at IS NULL) → no re-dispara
-- ni spamea; la alarma persiste hasta "Enterado". Ventana sana de 24 h.
create or replace function public.delivery_watchdog_scan()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with cfg as (
    select l.id as location_id,
           coalesce(w.enabled, true)                        as enabled,
           coalesce(w.in_delivery_threshold_minutes, 45)    as in_del,
           coalesce(w.unsealed_threshold_minutes, 90)       as unsealed
    from public.locations l
    left join public.delivery_watchdog_config w on w.location_id = l.id
  ),
  stalled as (
    select s.id,
           case
             when s.delivery_state = 'in_delivery'
                  and s.handed_to_courier_at is not null
                  and now() - s.handed_to_courier_at > make_interval(mins => c.in_del)
               then 'stalled_in_delivery'
             when s.order_status not in ('completed','rejected','cancelled','delivery_failed')
                  and now() - coalesce(s.opened_at, s.sold_at, s.created_at) > make_interval(mins => c.unsealed)
               then 'stalled_unclosed'
             else null
           end as kind
    from public.sale s
    join cfg c on c.location_id = s.location_id and c.enabled
    where s.delivery_alarm_at is null                          -- aún sin alarma viva
      and s.order_status not in ('rejected','cancelled')       -- no molestar con muertos deliberados
      and (s.carrier_code is not null or s.delivery_state is not null)  -- solo pedidos de REPARTO
      and coalesce(s.opened_at, s.sold_at, s.created_at) > now() - interval '24 hours'
  )
  update public.sale s
     set delivery_alarm_at     = now(),
         delivery_alarm_kind    = st.kind,
         delivery_alarm_ack_at  = null,
         updated_at             = now()
    from stalled st
   where s.id = st.id
     and st.kind is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ── 4. Cron: cada 5 min (idempotente por nombre). Sin Edge (UPDATE directo). ──
select cron.schedule(
  'delivery-watchdog',
  '*/5 * * * *',
  $cron$ select public.delivery_watchdog_scan(); $cron$
);
