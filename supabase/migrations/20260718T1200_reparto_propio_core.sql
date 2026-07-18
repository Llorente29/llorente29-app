-- supabase/migrations/20260718T1200_reparto_propio_core.sql
-- T1 — Núcleo de Reparto Propio (flota propia + asignación + reglas + quotes).
-- ADITIVO: no toca tg_auto_dispatch ni la Edge de Catcher (eso es T2).
-- RLS calcado del patrón operativo (kds_device): belongs_to_account (lectura)
-- + current_user_is_admin_or_manager_of (escritura). Acceso por token (PWA
-- repartidor / tracking cliente) llegará por RPC SECURITY DEFINER en T3.

BEGIN;

-- ── Helper: touch updated_at ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_reparto_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ── 1. courier ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.courier (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id         uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  employee_id        uuid REFERENCES public.employees(id) ON DELETE SET NULL,
  kind               text NOT NULL CHECK (kind IN ('employee','freelance')),
  name               text NOT NULL,
  phone              text,
  transport_type     text CHECK (transport_type IN ('moto','bici','coche','a_pie')),
  access_token       text UNIQUE,
  assigned_locations uuid[] NOT NULL DEFAULT '{}',
  active             boolean NOT NULL DEFAULT true,
  on_shift           boolean NOT NULL DEFAULT false,
  last_lat           numeric,
  last_lng           numeric,
  last_seen_at       timestamptz,
  cost_model         text NOT NULL DEFAULT 'per_order'
                       CHECK (cost_model IN ('salary','hourly','per_order','per_km')),
  cost_value         numeric,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT courier_kind_employee CHECK ((kind = 'employee') = (employee_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS courier_account_idx  ON public.courier (account_id);
CREATE INDEX IF NOT EXISTS courier_employee_idx ON public.courier (employee_id);
CREATE INDEX IF NOT EXISTS courier_onshift_idx  ON public.courier (account_id, on_shift) WHERE active;

DROP TRIGGER IF EXISTS trg_courier_touch ON public.courier;
CREATE TRIGGER trg_courier_touch BEFORE UPDATE ON public.courier
  FOR EACH ROW EXECUTE FUNCTION public.tg_reparto_touch_updated_at();

-- ── 2. delivery_assignment ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.delivery_assignment (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id         uuid NOT NULL REFERENCES public.sale(id) ON DELETE CASCADE,
  courier_id      uuid REFERENCES public.courier(id) ON DELETE SET NULL,
  account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  location_id     uuid REFERENCES public.locations(id),
  state           text NOT NULL DEFAULT 'offered'
                    CHECK (state IN ('offered','accepted','picked_up','in_delivery','delivered','failed','canceled')),
  assigned_by     text NOT NULL DEFAULT 'dispatcher'
                    CHECK (assigned_by IN ('dispatcher','manual','auto')),
  sequence        int,
  transport_price numeric,
  offered_at      timestamptz DEFAULT now(),
  accepted_at     timestamptz,
  picked_up_at    timestamptz,
  in_delivery_at  timestamptz,
  delivered_at    timestamptz,
  failed_at       timestamptz,
  failed_reason   text,
  proof_type      text CHECK (proof_type IN ('photo','signature','pin','none')),
  proof_url       text,
  proof_note      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS da_sale_idx    ON public.delivery_assignment (sale_id);
CREATE INDEX IF NOT EXISTS da_courier_idx ON public.delivery_assignment (courier_id);
CREATE INDEX IF NOT EXISTS da_acc_state_idx ON public.delivery_assignment (account_id, state);

DROP TRIGGER IF EXISTS trg_da_touch ON public.delivery_assignment;
CREATE TRIGGER trg_da_touch BEFORE UPDATE ON public.delivery_assignment
  FOR EACH ROW EXECUTE FUNCTION public.tg_reparto_touch_updated_at();

-- ── 3. dispatch_rule ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dispatch_rule (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  location_id      uuid REFERENCES public.locations(id),
  priority         int NOT NULL DEFAULT 100,
  zone_id          uuid REFERENCES public.delivery_zone(id),
  postal_codes     text[],
  time_from        time,
  time_to          time,
  weekdays         int[],
  min_total        numeric,
  max_total        numeric,
  margin_floor_pct numeric,
  then_carrier     text NOT NULL,
  fallback_carrier text,
  strategy         text NOT NULL DEFAULT 'own_first'
                     CHECK (strategy IN ('own_first','cheapest','fastest','weighted')),
  is_active        boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dr_acc_prio_idx ON public.dispatch_rule (account_id, priority) WHERE is_active;

DROP TRIGGER IF EXISTS trg_dr_touch ON public.dispatch_rule;
CREATE TRIGGER trg_dr_touch BEFORE UPDATE ON public.dispatch_rule
  FOR EACH ROW EXECUTE FUNCTION public.tg_reparto_touch_updated_at();

-- ── 4. delivery_quote ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.delivery_quote (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id     uuid NOT NULL REFERENCES public.sale(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  carrier     text NOT NULL,
  fee         numeric,
  currency    text DEFAULT 'EUR',
  pickup_eta  timestamptz,
  dropoff_etd timestamptz,
  vehicle     text,
  serviceable boolean,
  chosen      boolean NOT NULL DEFAULT false,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dq_sale_idx ON public.delivery_quote (sale_id);

-- ── 5. Trigger ESPEJO: delivery_assignment -> sale ──────────────────────────
CREATE OR REPLACE FUNCTION public.tg_mirror_delivery_assignment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_state text;
  v_name  text;
  v_phone text;
  v_veh   text;
BEGIN
  v_state := CASE NEW.state
    WHEN 'offered'     THEN 'matching'
    WHEN 'accepted'    THEN 'matched'
    WHEN 'picked_up'   THEN 'in_delivery'
    WHEN 'in_delivery' THEN 'in_delivery'
    WHEN 'delivered'   THEN 'delivered'
    WHEN 'failed'      THEN 'failed'
    WHEN 'canceled'    THEN 'canceled'
    ELSE NEW.state
  END;

  IF NEW.courier_id IS NOT NULL THEN
    SELECT c.name, c.phone, c.transport_type
      INTO v_name, v_phone, v_veh
      FROM public.courier c WHERE c.id = NEW.courier_id;
  END IF;

  UPDATE public.sale s SET
    carrier_code       = 'own_fleet',
    delivery_state     = v_state,
    rider_name         = COALESCE(v_name, s.rider_name),
    rider_phone        = COALESCE(v_phone, s.rider_phone),
    rider_transport_type = COALESCE(v_veh, s.rider_transport_type),
    has_courier        = (NEW.courier_id IS NOT NULL),
    transport_price    = COALESCE(NEW.transport_price, s.transport_price),
    dispatch_error     = NULL
  WHERE s.id = NEW.sale_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mirror_delivery_assignment ON public.delivery_assignment;
CREATE TRIGGER trg_mirror_delivery_assignment
  AFTER INSERT OR UPDATE ON public.delivery_assignment
  FOR EACH ROW EXECUTE FUNCTION public.tg_mirror_delivery_assignment();

-- ── 6. RLS (patrón operativo, como kds_device) ──────────────────────────────
ALTER TABLE public.courier             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispatch_rule       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_quote      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS courier_select ON public.courier;
CREATE POLICY courier_select ON public.courier FOR SELECT
  USING (belongs_to_account(account_id));
DROP POLICY IF EXISTS courier_write ON public.courier;
CREATE POLICY courier_write ON public.courier FOR ALL
  USING (current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin_or_manager_of(account_id));

DROP POLICY IF EXISTS da_select ON public.delivery_assignment;
CREATE POLICY da_select ON public.delivery_assignment FOR SELECT
  USING (belongs_to_account(account_id));
DROP POLICY IF EXISTS da_write ON public.delivery_assignment;
CREATE POLICY da_write ON public.delivery_assignment FOR ALL
  USING (current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin_or_manager_of(account_id));

DROP POLICY IF EXISTS dr_select ON public.dispatch_rule;
CREATE POLICY dr_select ON public.dispatch_rule FOR SELECT
  USING (belongs_to_account(account_id));
DROP POLICY IF EXISTS dr_write ON public.dispatch_rule;
CREATE POLICY dr_write ON public.dispatch_rule FOR ALL
  USING (current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin_or_manager_of(account_id));

DROP POLICY IF EXISTS dq_select ON public.delivery_quote;
CREATE POLICY dq_select ON public.delivery_quote FOR SELECT
  USING (belongs_to_account(account_id));
DROP POLICY IF EXISTS dq_write ON public.delivery_quote;
CREATE POLICY dq_write ON public.delivery_quote FOR ALL
  USING (current_user_is_admin_or_manager_of(account_id))
  WITH CHECK (current_user_is_admin_or_manager_of(account_id));

COMMIT;
