-- 20260719T1600_customer_notify_per_location_and_cron.sql
-- Interruptor por local del aviso WhatsApp + encendido en Foodint Alcalá (prod) + cron drenador.
-- Aplicada en producción el 19/07/2026.

BEGIN;

-- 1) Interruptor por local (apagado por defecto)
ALTER TABLE public.locations
  ADD COLUMN IF NOT EXISTS customer_notify_enabled boolean NOT NULL DEFAULT false;

-- 2) enqueue: gatea por local habilitado (solo avisa donde está encendido)
CREATE OR REPLACE FUNCTION public.enqueue_customer_notification(p_sale_id uuid, p_event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  s         record;
  v_base    text;
  v_phone   text;
  v_track   text;
  v_brand   text;
  v_enabled boolean;
BEGIN
  SELECT sl.id, sl.account_id, sl.brand_id, sl.location_id, sl.service_type, sl.source,
         sl.customer_name, sl.customer_phone, sl.public_token, sl.eta_delivery, sl.rider_name
    INTO s FROM public.sale sl WHERE sl.id = p_sale_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF s.service_type <> 'own_delivery' THEN RETURN; END IF;

  -- Interruptor por local
  SELECT coalesce(l.customer_notify_enabled, false) INTO v_enabled
    FROM public.locations l WHERE l.id = s.location_id;
  IF NOT coalesce(v_enabled, false) THEN RETURN; END IF;

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

-- 3) Encender SOLO en Foodint Alcalá (producción, cuenta Foodint 51ad1792...)
UPDATE public.locations SET customer_notify_enabled = true
 WHERE id = '38158159-cd71-4056-950b-53425afac1ce';

COMMIT;

-- 4) Cron drenador (cada minuto)
select cron.unschedule('customer-notify-drain')
 where exists (select 1 from cron.job where jobname = 'customer-notify-drain');
select cron.schedule('customer-notify-drain', '* * * * *', $cron$
  select net.http_post(
    url := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/customer-notify',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := '{}'::jsonb
  );
$cron$);
