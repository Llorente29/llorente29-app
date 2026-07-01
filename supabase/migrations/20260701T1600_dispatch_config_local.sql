-- supabase/migrations/20260701T1600_dispatch_config_local.sql
--
-- SELECTOR DE ENVÍO POR LOCAL (auto/manual + broker) + despacho ampliado.
--
-- (1) Config del local: dispatch_mode (auto/manual) + dispatch_broker.
--     Es la "verdad" del modo de despacho; el trigger la lee (una verdad por cosa).
--     Hueco preparado para jelp/uber_direct/shipday (aún sin adaptador).
--
-- (2) Trigger de auto-despacho reescrito:
--     - Guardarraíl por service_type = 'own_delivery' (reparto propio), NO por source.
--       Así cubre Shop y Last/Glovo/Uber/JE cuando el reparto es propio, y NUNCA
--       los platform_delivery (esos los lleva la plataforma).
--     - Dispara en INSERT **o** UPDATE: los pedidos de Last nacen 'accepted' (INSERT)
--       y el trigger viejo (solo AFTER UPDATE) no los capturaba.
--     - Sólo despacha si el local está en 'auto' y su broker tiene adaptador (catcher).
--     - Idempotente: no re-despacha si ya hay carrier_order_id.
--
-- NOTA seguridad (deuda existente, heredada): el secreto interno del trigger sigue
-- embebido; su rotación es un frente aparte ya declarado. No se empeora aquí.

-- (1) Columnas de config en el local.
alter table public.locations
  add column if not exists dispatch_mode   text not null default 'auto'
    check (dispatch_mode in ('auto','manual')),
  add column if not exists dispatch_broker text not null default 'catcher'
    check (dispatch_broker in ('catcher','jelp','uber_direct','shipday'));

-- (2) Reemplazo del trigger cableado a Catcher+Shop por uno multi-broker por local.
drop trigger if exists trg_auto_dispatch_catcher on public.sale;
drop function if exists public.tg_auto_dispatch_catcher();

create or replace function public.tg_auto_dispatch()
returns trigger
language plpgsql
security definer
as $function$
declare
  v_mode   text;
  v_broker text;
  v_secret text := 'fv_catdisp_tnrMMcaI8gALFCitfvzPGsaHgQa3A83w';
  v_url    text := 'https://xzmpnchlguibclvxyynt.supabase.co/functions/v1/catcher-dispatch';
begin
  -- Sólo reparto propio, al aceptar, sin despacho previo, y con transición real
  -- (INSERT que nace aceptado, o UPDATE que pasa a aceptado).
  if new.service_type = 'own_delivery'
     and new.order_status = 'accepted'
     and new.carrier_order_id is null
     and (tg_op = 'INSERT' or old.order_status is distinct from new.order_status)
  then
    select coalesce(l.dispatch_mode, 'auto'), coalesce(l.dispatch_broker, 'catcher')
      into v_mode, v_broker
    from public.locations l
    where l.id = new.location_id;

    -- Automático + broker con adaptador construido → despacha solo.
    -- (Manual → no dispara: se despacha a mano desde el pedido.
    --  Otros brokers → aún sin adaptador: quedan manuales hasta tenerlo.)
    if v_mode = 'auto' and v_broker = 'catcher' then
      perform net.http_post(
        url     := v_url,
        headers := jsonb_build_object(
          'Content-Type',              'application/json',
          'x-catcher-dispatch-secret', v_secret
        ),
        body    := jsonb_build_object('sale_id', new.id, 'internal', true)
      );
    end if;
  end if;
  return new;
end;
$function$;

create trigger trg_auto_dispatch
after insert or update on public.sale
for each row execute function public.tg_auto_dispatch();
