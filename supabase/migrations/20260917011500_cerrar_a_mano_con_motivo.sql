-- ============================================================================
-- CERRAR A MANO, CON MOTIVO · 17/09/2026 · 🔴 NO APLICADA: espera el sí de Julio
--
-- «El cliente no abre, el rider se queda sin batería, se entregó y nadie lo
-- marcó.» Pedidos que se quedan vivos para siempre porque el aviso que los
-- cerraría no va a llegar nunca.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LO QUE YA HAY, MIRADO ANTES DE ESCRIBIR NADA (lo pedía el encargo):
--
--   · `set_order_status_by_token(token, venta, 'completed')` — EXISTE, comprueba
--     cuenta Y local, y al poner 'completed' dispara
--     `trg_sale_close_on_complete` → `close_sale`. **Es el camino único**, el
--     mismo que usa el botón «Completar» de Pedidos. Esta RPC no inventa otro:
--     hace exactamente ese UPDATE.
--   · `cancel_sale(venta, motivo)` — EXISTE y escribe `sale.cancel_reason`,
--     pero **no sirve**: pone `status='cancelled'` y llama a
--     `revert_sale_consumption`. Cerrar a mano no es anular: la comida se hizo
--     y el stock salió. Usar `cancel_reason` para esto dejaría filas cerradas
--     con un «motivo de anulación» y cualquiera que las cuente las leería como
--     anuladas. Medido: hoy hay 26 ventas con `cancel_reason`, y las 26 son
--     anulaciones de verdad.
--   · No hay ninguna tabla de eventos de pedido donde meterlo: `local_event` es
--     de eventos de demanda (fiestas, obras), 38 filas, nada que ver.
--
-- Por eso se añaden DOS COLUMNAS NUEVAS, no se recicla una que significa otra
-- cosa. Es la decisión que hay que aprobar.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- LA BANDA DE SERVICIO · este `alter table` **SÍ** toma `ACCESS EXCLUSIVE` sobre
-- `sale`, que es la tabla del camino del pedido. No cumple la condición 2, así
-- que **se aplica fuera de la banda, después de las 23:45**, aunque añadir una
-- columna anulable sin valor por defecto sea sólo metadatos en PostgreSQL 11+ y
-- dure milisegundos: el cierre es exclusivo igual, y si cae detrás de una
-- consulta larga la cola se traga los pedidos que entren mientras.
--
-- VOLVER ATRÁS:
--   drop function if exists public.cerrar_a_mano_by_token(text, uuid, text, text);
--   alter table sale drop column if exists manual_close_reason;
--   alter table sale drop column if exists manual_close_note;
--   alter table sale drop column if exists manual_closed_at;
-- ============================================================================

alter table public.sale add column if not exists manual_close_reason text;
alter table public.sale add column if not exists manual_close_note   text;
alter table public.sale add column if not exists manual_closed_at    timestamptz;

comment on column public.sale.manual_close_reason is
  'Por qué se cerró a mano desde el Pase: cliente_no_abre | rider_no_puede | '
  'entregado_sin_marcar | otro. NULL = se cerró solo, por el camino normal.';
comment on column public.sale.manual_close_note is
  'El texto libre, obligatorio cuando el motivo es «otro».';
comment on column public.sale.manual_closed_at is
  'Cuándo se cerró a mano. Distinto de closed_at, que lo pone close_sale.';

create or replace function public.cerrar_a_mano_by_token(
  p_device_token text,
  p_sale_id      uuid,
  p_motivo       text,
  p_texto        text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device kds_device;
  v_sale   sale;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'cerrar_a_mano_by_token: token de dispositivo no válido';
  end if;

  -- Cuenta Y local, como `pase_ficha`. Un token de Alcalá no cierra un pedido
  -- de Villaverde ni aunque se le pase el uuid.
  select s.* into v_sale
    from sale s
   where s.id          = p_sale_id
     and s.account_id  = v_device.account_id
     and s.location_id = v_device.location_id
     for update;

  if v_sale.id is null then
    raise exception 'cerrar_a_mano_by_token: ese pedido no es de este local';
  end if;

  if p_motivo not in ('cliente_no_abre','rider_no_puede','entregado_sin_marcar','otro') then
    raise exception 'cerrar_a_mano_by_token: motivo no válido %', p_motivo;
  end if;

  -- «Otro» sin texto no se guarda: un motivo que no se puede contar y que
  -- además no se explica no sirve para nada dentro de un mes.
  if p_motivo = 'otro' and coalesce(btrim(p_texto), '') = '' then
    raise exception 'cerrar_a_mano_by_token: «otro» necesita un texto';
  end if;

  -- 🔴 YA CERRADO: no se vuelve a cerrar ni se pisa el motivo de antes. Se
  -- devuelve lo que hay, y el front lo dice. Dos dedos en la misma tablet es
  -- un caso real, no una hipótesis.
  if v_sale.status = 'closed' or coalesce(v_sale.order_status,'') = 'completed' then
    return jsonb_build_object(
      'ya_estaba', true,
      'motivo',    v_sale.manual_close_reason,
      'closed_at', v_sale.closed_at);
  end if;

  -- 1 · El motivo PRIMERO, en la misma transacción: si el cierre fallara, no
  --     queda un pedido cerrado sin decir por qué; y si fallara esto, no se
  --     cierra nada.
  update sale
     set manual_close_reason = p_motivo,
         manual_close_note   = nullif(btrim(p_texto), ''),
         manual_closed_at    = now(),
         updated_at          = now()
   where id = p_sale_id;

  -- 2 · Y el cierre por el CAMINO ÚNICO. De aquí lo coge
  --     `trg_sale_close_on_complete` → `close_sale`, igual que siempre.
  update sale
     set order_status = 'completed',
         updated_at   = now()
   where id = p_sale_id;

  select s.* into v_sale from sale s where s.id = p_sale_id;

  return jsonb_build_object(
    'ya_estaba', false,
    'motivo',    p_motivo,
    'closed_at', v_sale.closed_at);
end;
$$;

revoke all on function public.cerrar_a_mano_by_token(text, uuid, text, text) from public;
grant execute on function public.cerrar_a_mano_by_token(text, uuid, text, text)
  to anon, authenticated, service_role;

comment on function public.cerrar_a_mano_by_token(text, uuid, text, text) is
  'Cierra un pedido a mano desde el Pase, con motivo, en una sola transacción. '
  'No abre un camino de cierre nuevo: pone order_status=completed, que es el de '
  'siempre. No revierte consumo: la comida se hizo.';
