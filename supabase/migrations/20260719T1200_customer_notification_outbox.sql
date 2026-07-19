-- 20260719T1200_customer_notification_outbox.sql
-- Capa de notificación al cliente (WhatsApp) — LADO CAPTURA (outbox).
-- Encola el evento "en camino" del reparto propio en customer_notification.
-- NO envía: el drenador + edge customer-notify -> Meta Cloud API van en migración aparte.
-- Idempotente y transaccional.

BEGIN;

-- 0) Enlace de seguimiento configurable por cuenta (default general)
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS track_base_url text;

-- 1) Outbox de notificaciones al cliente (calco del patrón ctb_notification_queue)
CREATE TABLE IF NOT EXISTS public.customer_notification (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id             uuid NOT NULL REFERENCES public.sale(id) ON DELETE CASCADE,
  account_id          uuid NOT NULL,
  event               text NOT NULL,
  channel             text NOT NULL DEFAULT 'whatsapp',
  to_phone            text,
  to_email            text,
  template            text,
  lang                text NOT NULL DEFAULT 'es',
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status              text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','sent','failed','skipped')),
  skip_reason         text,
  attempts            int  NOT NULL DEFAULT 0,
  provider_message_id text,
  error               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- idempotencia: un mensaje por (venta, evento, canal)
CREATE UNIQUE INDEX IF NOT EXISTS ux_customer_notification_event
  ON public.customer_notification (sale_id, event, channel);
CREATE INDEX IF NOT EXISTS ix_customer_notification_status
  ON public.customer_notification (status) WHERE status IN ('pending','failed');

ALTER TABLE public.customer_notification ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cn_select ON public.customer_notification;
CREATE POLICY cn_select ON public.customer_notification
  FOR SELECT USING (
    current_user_is_admin() OR current_user_is_admin_or_manager_of(account_id)
  );

-- 2) Normalizador de teléfono a E.164 (dígitos con prefijo país, sin '+')
CREATE OR REPLACE FUNCTION public.fv_e164_or_null(p text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE v text;
BEGIN
  v := regexp_replace(coalesce(p,''), '\D', '', 'g');
  IF v = '' THEN RETURN NULL; END IF;
  IF left(v,2) = '00' THEN v := substr(v,3); END IF;               -- 0034... -> 34...
  IF length(v) = 9 AND substr(v,1,1) IN ('6','7') THEN            -- móvil ES sin prefijo
     v := '34' || v;
  END IF;
  IF length(v) BETWEEN 11 AND 15 THEN RETURN v; END IF;           -- ya con prefijo país
  RETURN NULL;                                                    -- fijo/incompleto -> no enviable
END;
$fn$;

-- 3) enqueue: compone y encola (o marca 'skipped' con motivo, para auditoría)
CREATE OR REPLACE FUNCTION public.enqueue_customer_notification(p_sale_id uuid, p_event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  s      record;
  v_base text;
  v_phone text;
  v_track text;
  v_brand text;
BEGIN
  SELECT sl.id, sl.account_id, sl.brand_id, sl.service_type, sl.source,
         sl.customer_name, sl.customer_phone, sl.public_token,
         sl.eta_delivery, sl.rider_name
    INTO s
    FROM public.sale sl WHERE sl.id = p_sale_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF s.service_type <> 'own_delivery' THEN RETURN; END IF;   -- salvaguarda: solo reparto propio

  SELECT coalesce(a.track_base_url, 'https://app.folvy.app') INTO v_base
    FROM public.accounts a WHERE a.id = s.account_id;
  v_base := coalesce(v_base, 'https://app.folvy.app');

  v_phone := public.fv_e164_or_null(s.customer_phone);
  SELECT b.name INTO v_brand FROM public.brand b WHERE b.id = s.brand_id;

  IF s.public_token IS NOT NULL AND s.public_token <> '' THEN
     v_track := v_base || '/seguir/' || s.public_token;
  END IF;

  IF v_phone IS NULL OR v_track IS NULL THEN
     INSERT INTO public.customer_notification
       (sale_id, account_id, event, channel, to_phone, template, lang, payload, status, skip_reason)
     VALUES (s.id, s.account_id, p_event, 'whatsapp', v_phone, 'pedido_en_camino', 'es',
             jsonb_build_object('customer_name', s.customer_name, 'brand', v_brand,
                                'rider_name', s.rider_name, 'eta', s.eta_delivery, 'track_url', v_track),
             'skipped',
             CASE WHEN v_phone IS NULL THEN 'sin_telefono_valido' ELSE 'sin_public_token' END)
     ON CONFLICT (sale_id, event, channel) DO NOTHING;
     RETURN;
  END IF;

  INSERT INTO public.customer_notification
    (sale_id, account_id, event, channel, to_phone, template, lang, payload, status)
  VALUES (s.id, s.account_id, p_event, 'whatsapp', v_phone, 'pedido_en_camino', 'es',
          jsonb_build_object('customer_name', s.customer_name, 'brand', v_brand,
                             'rider_name', s.rider_name, 'eta', s.eta_delivery, 'track_url', v_track),
          'pending')
  ON CONFLICT (sale_id, event, channel) DO NOTHING;
END;
$fn$;

-- 4) public_token para own_delivery (necesario para el enlace) — se genera si falta
CREATE OR REPLACE FUNCTION public.tg_ensure_public_token()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF new.service_type = 'own_delivery'
     AND (new.public_token IS NULL OR new.public_token = '') THEN
     new.public_token := replace(gen_random_uuid()::text, '-', '');
  END IF;
  RETURN new;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_ensure_public_token ON public.sale;
CREATE TRIGGER trg_ensure_public_token
  BEFORE INSERT OR UPDATE ON public.sale
  FOR EACH ROW EXECUTE FUNCTION public.tg_ensure_public_token();

-- 5) Enganche "en camino" — FLOTA PROPIA (delivery_assignment)
CREATE OR REPLACE FUNCTION public.tg_notify_on_way_da()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF new.state IN ('picked_up','in_delivery')
     AND (tg_op = 'INSERT' OR old.state IS DISTINCT FROM new.state) THEN
     PERFORM public.enqueue_customer_notification(new.sale_id, 'pedido_en_camino');
  END IF;
  RETURN new;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_notify_on_way_da ON public.delivery_assignment;
CREATE TRIGGER trg_notify_on_way_da
  AFTER INSERT OR UPDATE ON public.delivery_assignment
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_on_way_da();

-- 6) Enganche "en camino" — CATCHER (sale.delivery_state -> in_delivery)
CREATE OR REPLACE FUNCTION public.tg_notify_on_way_sale()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
BEGIN
  IF new.service_type = 'own_delivery'
     AND new.delivery_state = 'in_delivery'
     AND old.delivery_state IS DISTINCT FROM new.delivery_state THEN
     PERFORM public.enqueue_customer_notification(new.id, 'pedido_en_camino');
  END IF;
  RETURN new;
END;
$fn$;
DROP TRIGGER IF EXISTS trg_notify_on_way_sale ON public.sale;
CREATE TRIGGER trg_notify_on_way_sale
  AFTER UPDATE ON public.sale
  FOR EACH ROW EXECUTE FUNCTION public.tg_notify_on_way_sale();

-- 7) Backfill de public_token a los own_delivery existentes (no dispara despacho:
--    order_status no cambia; delivery_state no cambia -> sin efectos colaterales)
UPDATE public.sale
   SET public_token = replace(gen_random_uuid()::text, '-', '')
 WHERE service_type = 'own_delivery'
   AND (public_token IS NULL OR public_token = '');

COMMIT;
