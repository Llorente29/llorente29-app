-- 20260721T1900_dispatch_mode_off.sql
-- Interruptor de despacho de 3 posiciones. Añade el modo 'off' (Folvy NO despacha;
-- lo hace Last u otro externo). Requiere ampliar el CHECK y que la RPC lo acepte.

-- 1) CHECK: permitir 'off'.
ALTER TABLE public.locations DROP CONSTRAINT IF EXISTS locations_dispatch_mode_check;
ALTER TABLE public.locations ADD CONSTRAINT locations_dispatch_mode_check
  CHECK (dispatch_mode IN ('auto','manual','off'));

-- 2) RPC de guardado: aceptar 'off' (antes solo 'auto'/'manual' → lo ignoraba).
CREATE OR REPLACE FUNCTION public.set_location_dispatch(p_location_id uuid, p_mode text, p_broker text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update locations l set
    dispatch_mode  = case when p_mode  in ('auto','manual','off')  then p_mode  else l.dispatch_mode  end,
    dispatch_broker= case when p_broker in ('catcher','own_fleet') then p_broker else l.dispatch_broker end
  where l.id=p_location_id and l.account_id = any(current_user_account_ids())
    and current_user_is_admin_or_manager_of(l.account_id);
end; $function$;
