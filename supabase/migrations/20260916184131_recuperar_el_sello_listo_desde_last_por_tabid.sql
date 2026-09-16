-- ============================================================================
-- RECUPERAR EL «LISTO» DESDE LA ANALÍTICA DE LAST, POR tabId · 16/09/2026
-- Aplicada en producción el 16/09 a las 18:41:31 UTC = 20:41:31 de Madrid.
--
-- Julio leyó en `DeliveryOrderStatuses` de Last el `readyToPickupStatus` de las
-- ocho ventas cuyo sello se perdió hoy, y las casó por `tabId`. Esto no elige
-- una hora: la lee. Cada una sale de su propia comanda, y las cinco que todavía
-- tenían empuje en `net._http_response` coinciden con él AL SEGUNDO.
--
-- EL ANCLA es `sale.external_tab_ref`, que es el mismo `tab.id` de Last. Los
-- ocho `tabId` casan por prefijo con el que ya teníamos guardado: la pareja
-- está confirmada por los dos lados, no solo por el que la propone.
--
-- ES UN PROCEDIMIENTO A MANO Y NO UNA TAREA AUTOMÁTICA, por decisión explícita:
-- automatizarlo sería otra pieza. Se guarda para que exista cuando vuelva a
-- hacer falta, en vez de rehacer el SQL con prisa.
--
-- SUS TRES GUARDAS, y las tres CUENTAN lo que paran en vez de callárselo:
--   1. `account_id` siempre (regla 9).
--   2. Solo escribe si `ready_at` está VACÍO. Una hora buena no se pisa nunca.
--   3. La hora tiene que caber entre el aceptado y el cierre. Un par mal casado
--      da una hora imposible, y eso es lo que hay que cazar ANTES de escribirlo.
--      Un sello inventado es peor que un sello ausente.
--
-- EL RASTRO: `sello_listo_recuperado_log`, una fila por intento, también los
-- que NO escriben. Un arreglo de datos sin rastro no se puede auditar.
--
-- LO QUE SE ESCRIBIÓ (las ocho, todas «escrito», ninguna parada por las guardas):
--   G496 11:45:34 · G430 11:45:36 · U996 12:17:25 · G042 12:50:09
--   U997 13:15:32 · U998 13:15:36 · G448 13:15:36 · G858 13:35:33   (UTC)
--
-- EL ANTES Y EL DESPUÉS: las ocho con `ready_at` y NADA MÁS cambiado.
-- `status` closed, `order_status` completed, `closed_at`, `handed_to_courier_at`
-- y `delivered_at` idénticos, 0 notas de salto. Y el consumo NO se tocó, medido
-- y no supuesto: en las ocho, el último movimiento escrito sigue siendo el de su
-- hora de cierre. El motor ni siquiera llegó a llamarse —
-- `tg_sale_consumption_on_complete` pide un cambio de `status`/`order_status`/
-- `is_active`, y aquí solo se movió `ready_at`.
--
-- VOLVER ATRÁS, en una sentencia (deja el log, que es el rastro de que pasó):
--   update sale s set ready_at = null
--     from public.sello_listo_recuperado_log g
--    where g.sale_id = s.id and g.resultado = 'escrito'
--      and s.ready_at = g.ready_at_escrito;
-- ============================================================================

create table if not exists public.sello_listo_recuperado_log (
  id               uuid primary key default gen_random_uuid(),
  recuperado_at    timestamptz not null default now(),
  account_id       uuid        not null,
  sale_id          uuid,
  external_tab_ref text        not null,
  pos_short_code   text,
  ready_at_escrito timestamptz,
  resultado        text        not null,
  nota             text        not null
);

comment on table public.sello_listo_recuperado_log is
  'Rastro de cada «Listo» devuelto a una venta desde la analitica de Last. Una fila por intento, tambien los que NO escriben: un arreglo de datos que no deja rastro no se puede auditar.';

create or replace function public.recuperar_sello_listo(
  p_account_id uuid,
  p_pares      jsonb,          -- [{"tab_id":"...","listo":"2026-09-16T11:45:34Z"}, ...]
  p_origen     text default 'analitica de Last (readyToPickupStatus), precision de segundo'
) returns table (
  pos_short_code   text,
  external_tab_ref text,
  resultado        text,
  ready_at_escrito timestamptz,
  nota             text
)
language plpgsql security definer set search_path = public as $$
declare
  r        record;
  v_sale   sale%rowtype;
  v_listo  timestamptz;
  v_res    text;
  v_nota   text;
begin
  if p_account_id is null then raise exception 'sin cuenta no se ancla nada'; end if;

  for r in select x->>'tab_id' as tab_id, (x->>'listo')::timestamptz as listo
             from jsonb_array_elements(p_pares) x
  loop
    v_listo := r.listo;
    select * into v_sale from sale s
     where s.account_id = p_account_id
       and s.external_tab_ref = r.tab_id;

    if not found then
      v_res  := 'no hay venta con esa comanda';
      v_nota := format('tabId %s: ninguna venta de esta cuenta lo lleva en external_tab_ref', r.tab_id);
    elsif v_sale.ready_at is not null then
      v_res  := 'ya tenia hora, no se toca';
      v_nota := format('ya tenia ready_at %s; no se pisa', v_sale.ready_at);
    elsif v_sale.accepted_at is not null and v_listo < v_sale.accepted_at then
      v_res  := 'hora imposible: antes de aceptarse';
      v_nota := format('el «Listo» %s es anterior al aceptado %s', v_listo, v_sale.accepted_at);
    elsif v_sale.closed_at is not null and v_listo > v_sale.closed_at then
      v_res  := 'hora imposible: posterior al cierre';
      v_nota := format('el «Listo» %s es posterior al cierre %s', v_listo, v_sale.closed_at);
    else
      update sale set ready_at = v_listo
       where id = v_sale.id and ready_at is null;
      if found then
        v_res  := 'escrito';
        v_nota := format('«Listo» recuperado de %s: %s', p_origen, v_listo);
      else
        v_res  := 'ya tenia hora, no se toca';
        v_nota := 'alguien la escribio entre la lectura y la escritura';
      end if;
    end if;

    insert into public.sello_listo_recuperado_log(
      account_id, sale_id, external_tab_ref, pos_short_code, ready_at_escrito, resultado, nota)
    values (p_account_id, v_sale.id, r.tab_id, v_sale.pos_short_code,
            case when v_res = 'escrito' then v_listo end, v_res, v_nota);

    pos_short_code   := v_sale.pos_short_code;
    external_tab_ref := r.tab_id;
    resultado        := v_res;
    ready_at_escrito := case when v_res = 'escrito' then v_listo end;
    nota             := v_nota;
    return next;
  end loop;
end $$;

revoke all on function public.recuperar_sello_listo(uuid, jsonb, text) from public, anon, authenticated;
