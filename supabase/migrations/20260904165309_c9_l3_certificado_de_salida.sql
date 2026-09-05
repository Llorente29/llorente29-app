-- C9 · Lote 3 §5 (04/09/2026). El certificado de salida.
--
-- SOLO LEE. No escribe nada, no toca el camino vivo, y es `stable`.
--
-- LA REGLA DURA: EL CERTIFICADO NO RELLENA LO QUE NO TIENE. Cada hora sale de
-- un registro real y lleva escrito DE CUAL. Lo que no existe se imprime como
-- «no disponible» con el motivo, nunca en blanco y nunca inventado. Por eso
-- cada paso es un objeto {paso, hora, fuente, estado, nota} y no un timestamp
-- suelto: un timestamp suelto no puede decir que no existe.
--
-- ⚠️ `sale.ready_at` NO ES PRUEBA FUERTE, y el certificado lo dice cada vez.
-- Esta medido que ~35 % de los pedidos se marcan EN RAFAGA: alguien pulsa
-- varios seguidos y todos comparten minuto. Ese sello dice cuando alguien
-- PULSO, no cuando el pedido estuvo listo. Hasta que L0a aporte el acuse de la
-- plataforma, se imprime como «sello del sistema, sin acuse de la plataforma».
-- Ademas el certificado MIDE la rafaga de ese pedido concreto -- cuantos otros
-- se marcaron en los 60 s de alrededor -- para que el aviso sea un numero y no
-- una advertencia generica. Prometer mas de lo que ese sello sostiene es lo que
-- costo el informe AWTP.
--
-- LO QUE HOY NO EXISTE, y por eso sale «no disponible» en todos los pedidos:
--   sale_step_event  la tabla NO ESTA CREADA (B53/L0a sin aplicar). Es la que
--                    traeria el acuse de la plataforma.
--   sale_capture     existe y esta VACIA: no hay tablet capturando todavia.
--   sale_verification existe y esta VACIA: no hay lector desplegado.
-- Cuando aparezcan, el certificado los recoge solo, sin tocar esta funcion mas
-- que para quitar la comprobacion de existencia de sale_step_event.

create or replace function public.certificado_de_salida(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_s              record;
  v_pasos          jsonb := '[]'::jsonb;
  v_unidades       jsonb;
  v_foto           jsonb;
  v_verif          jsonb;
  v_avisos         jsonb := '[]'::jsonb;
  v_marcas         text;
  v_n_marcas       int;
  v_rafaga         int;
  v_hay_step_event boolean;
  v_impresiones    jsonb;
  v_n_tokens       int;
  v_n_escaneadas   int;
  v_primer_token   timestamptz;

  -- Un paso del certificado. `p_hora` nulo => «no disponible» con su motivo.
  function_dummy   int;
begin
  select s.*, l.name as local_nombre
    into v_s
    from public.sale s
    join public.locations l on l.id = s.location_id
   where s.id = p_sale_id;

  if v_s.id is null then
    return jsonb_build_object('error', 'pedido_no_encontrado', 'sale_id', p_sale_id);
  end if;

  -- ── Marcas del pedido (puede ser multimarca) ─────────────────────────────
  select count(distinct coalesce(mi.brand_id, v_s.brand_id)),
         string_agg(distinct b.name, ' + ')
    into v_n_marcas, v_marcas
    from public.sale_line sl
    left join public.menu_item mi on mi.id = sl.menu_item_id
    left join public.brand b on b.id = coalesce(mi.brand_id, v_s.brand_id)
   where sl.sale_id = p_sale_id;

  -- ── La rafaga: cuantos OTROS pedidos del mismo local comparten el minuto ──
  if v_s.ready_at is not null then
    select count(*) into v_rafaga
      from public.sale o
     where o.location_id = v_s.location_id
       and o.id <> v_s.id
       and o.ready_at between v_s.ready_at - interval '60 seconds'
                          and v_s.ready_at + interval '60 seconds';
  else
    v_rafaga := null;
  end if;

  v_hay_step_event := exists (
    select 1 from information_schema.tables
     where table_schema='public' and table_name='sale_step_event');

  -- ── Los pasos, cada uno con su fuente ────────────────────────────────────
  v_pasos := jsonb_build_array(
    jsonb_build_object('paso','Pedido recibido','hora', v_s.created_at,
      'fuente','sale.created_at',
      'estado', case when v_s.created_at is null then 'no_disponible' else 'ok' end),
    jsonb_build_object('paso','Aceptado','hora', v_s.accepted_at,
      'fuente','sale.accepted_at',
      'estado', case when v_s.accepted_at is null then 'no_disponible' else 'ok' end,
      'nota', case when v_s.accepted_at is null then 'La venta no tiene hora de aceptacion registrada.' end),
    jsonb_build_object('paso','Marcado listo','hora', v_s.ready_at,
      'fuente','sale.ready_at',
      'estado', case when v_s.ready_at is null then 'no_disponible' else 'ok' end,
      'fuerza','debil',
      'nota', case
        when v_s.ready_at is null then 'La venta no tiene hora de «listo» registrada.'
        when coalesce(v_rafaga,0) > 0 then
          format('Sello del sistema, SIN acuse de la plataforma. Se marcaron %s pedido(s) mas en el mismo minuto en este local: esta hora dice cuando alguien PULSO, no cuando el pedido estuvo listo.', v_rafaga)
        else 'Sello del sistema, SIN acuse de la plataforma. Dice cuando alguien pulso «Listo».'
      end),
    jsonb_build_object('paso','Acuse de la plataforma','hora', null,
      'fuente','sale_step_event',
      'estado','no_disponible',
      'nota', case when v_hay_step_event
                   then 'No hay acuse registrado para este pedido.'
                   else 'La tabla sale_step_event todavia no existe (B53/L0a sin aplicar). Hasta entonces no hay acuse de plataforma para ningun pedido.' end),
    jsonb_build_object('paso','Entregado al repartidor','hora', v_s.handed_to_courier_at,
      'fuente','sale.handed_to_courier_at',
      'estado', case when v_s.handed_to_courier_at is null then 'no_disponible' else 'ok' end,
      'nota', case when v_s.handed_to_courier_at is null then 'Sin hora de entrega al repartidor registrada.' end),
    jsonb_build_object('paso','Entregado al cliente','hora', v_s.delivered_at,
      'fuente','sale.delivered_at',
      'estado', case when v_s.delivered_at is null then 'no_disponible' else 'ok' end,
      'nota', case when v_s.delivered_at is null then 'Sin hora de entrega al cliente registrada (habitual en reparto de plataforma).' end)
  );

  -- ── Impresiones: registro real, con su estado ────────────────────────────
  select coalesce(jsonb_agg(jsonb_build_object(
           'documento', j.doc_type, 'estado_trabajo', j.status,
           'creado', j.created_at, 'enviado', j.sent_at, 'terminado', j.done_at,
           'intentos', j.attempts, 'ultimo_error', j.last_error
         ) order by j.created_at), '[]'::jsonb)
    into v_impresiones
    from public.print_job j
   where j.sale_id = p_sale_id;

  -- ── Etiquetas: una fila por unidad, con su escaneo ───────────────────────
  select count(*), count(*) filter (where t.scanned_at is not null), min(t.created_at)
    into v_n_tokens, v_n_escaneadas, v_primer_token
    from public.label_token t where t.sale_id = p_sale_id;

  if coalesce(v_n_tokens,0) = 0 then
    v_unidades := jsonb_build_object(
      'estado','no_disponible',
      'fuente','label_token',
      'nota','Este pedido no tiene etiquetas acuñadas. O se imprimio antes de que existiera label_token (C9 L1, 04/09), o no se imprimieron etiquetas.');
  else
    select jsonb_build_object(
             'estado','ok',
             'fuente','label_token',
             'total', v_n_tokens,
             'escaneadas', v_n_escaneadas,
             'primera_acuñada', v_primer_token,
             'detalle', jsonb_agg(x.fila order by x.orden))
      into v_unidades
      from (
        select jsonb_build_object(
                 'unidad', case when t.line_id is null then 'bolsa de bebidas'
                                else coalesce(sl.product_name,'(linea sin nombre)') end,
                 'n', t.unit_no,
                 'token', t.token,
                 'acuñada', t.created_at,
                 'escaneada', t.scanned_at,
                 'veces', t.scan_count) as fila,
               coalesce(t.unit_no, 999) as orden
          from public.label_token t
          left join public.sale_line sl on sl.id = t.line_id
         where t.sale_id = p_sale_id
      ) x;
  end if;

  -- ── La foto, con su sha256 ───────────────────────────────────────────────
  select case when count(*) = 0 then
           jsonb_build_object('estado','no_disponible','fuente','sale_capture',
             'nota','No hay ninguna foto de este pedido. La captura (C9 L2 §4) todavia no esta en la tablet.')
         else
           jsonb_build_object('estado','ok','fuente','sale_capture',
             'fotos', jsonb_agg(jsonb_build_object(
               'tipo', c.kind, 'hecha', c.captured_at, 'recibida', c.received_at,
               'en_diferido', (c.received_at - c.captured_at) > interval '60 seconds',
               'sha256', coalesce(c.sha256, 'no disponible'),
               'medidas', case when c.width is null then 'no disponible'
                               else c.width || 'x' || c.height end,
               'bytes', c.bytes,
               'purgada', c.purged_at)))
         end
    into v_foto
    from public.sale_capture c where c.sale_id = p_sale_id;

  -- ── La verificacion ──────────────────────────────────────────────────────
  select case when count(*) = 0 then
           jsonb_build_object('estado','no_disponible','fuente','sale_verification',
             'nota','Este pedido no se ha verificado. El lector de L3 todavia no esta desplegado.')
         else
           jsonb_build_object('estado','ok','fuente','sale_verification',
             'intentos', jsonb_agg(jsonb_build_object(
               'modo', v.modo, 'cuando', v.verificado_at,
               'esperadas', v.unidades_esperadas, 'leidas', v.unidades_leidas,
               'completo', v.completo, 'faltantes', v.faltantes,
               'salio_igual', v.salio_igual, 'motivo', v.motivo_excepcion,
               'firmado_por', v.excepcion_por_nombre) order by v.verificado_at))
         end
    into v_verif
    from public.sale_verification v where v.sale_id = p_sale_id;

  -- ── Avisos: lo que este certificado NO prueba ────────────────────────────
  if v_s.ready_at is not null and coalesce(v_rafaga,0) > 0 then
    v_avisos := v_avisos || to_jsonb(format(
      'La hora de «listo» de este pedido comparte minuto con otros %s. Es un sello de sistema, no una prueba de cuando estuvo listo.', v_rafaga));
  end if;
  if not v_hay_step_event then
    v_avisos := v_avisos || to_jsonb(
      'Sin acuse de plataforma: sale_step_event no existe todavia. Ninguna hora de este certificado esta confirmada por Uber ni por Glovo.'::text);
  end if;
  if coalesce(v_n_tokens,0) = 0 then
    v_avisos := v_avisos || to_jsonb(
      'Sin etiquetas identificables: no se puede afirmar QUE unidades salieron, solo cuantas se pidieron.'::text);
  end if;
  if v_foto->>'estado' = 'no_disponible' then
    v_avisos := v_avisos || to_jsonb(
      'Sin foto: este certificado documenta horas, no contenido.'::text);
  end if;

  return jsonb_build_object(
    'certificado', 'salida de pedido',
    'generado', now(),
    'aviso_general', 'Cada hora sale de un registro real y lleva escrita su fuente. Lo que pone «no disponible» es que NO EXISTE el dato, no que sea cero.',
    'pedido', jsonb_build_object(
      'sale_id', v_s.id,
      'codigo', coalesce(v_s.pos_short_code, v_s.external_tab_ref, 'no disponible'),
      'codigo_plataforma', coalesce(v_s.platform_order_code, 'no disponible'),
      'canal', coalesce(v_s.external_channel_text, 'no disponible'),
      'local', v_s.local_nombre,
      'marcas', coalesce(v_marcas, 'no disponible'),
      'multimarca', coalesce(v_n_marcas, 0) > 1,
      'estado', coalesce(v_s.order_status, 'no disponible'),
      'cliente', case when v_s.customer_name is null then 'no disponible'
                      else split_part(v_s.customer_name, ' ', 1) end),
    'pasos', v_pasos,
    'impresiones', v_impresiones,
    'unidades', v_unidades,
    'foto', v_foto,
    'verificacion', v_verif,
    'avisos', v_avisos
  );
end;
$function$;

comment on function public.certificado_de_salida(uuid) is
  'C9 L3 §5: el certificado de salida de un pedido. SOLO LEE. Cada hora lleva su fuente; lo que no existe sale como «no disponible» con el motivo, nunca en blanco ni inventado. La hora de «listo» se marca siempre como sello debil y se mide la rafaga del pedido concreto.';

revoke all on function public.certificado_de_salida(uuid) from public, anon;
grant execute on function public.certificado_de_salida(uuid) to authenticated, service_role;

do $verif$
begin
  if has_function_privilege('anon','public.certificado_de_salida(uuid)','EXECUTE') then
    raise exception 'C9 L3: el certificado esta abierto a anon.';
  end if;
end
$verif$;
