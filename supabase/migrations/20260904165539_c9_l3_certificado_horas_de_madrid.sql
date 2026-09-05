-- C9 · Lote 3 §5, corregido en el momento (04/09/2026).
--
-- TRES FALLOS DE LA PRIMERA VERSION, vistos al generar el primer certificado
-- real en vez de al revisar el codigo:
--
-- 1. LAS HORAS SALIAN EN UTC. Es la regla 4, y aqui es cara: este documento se
--    adjunta a una reclamacion. Un certificado que dice «12:21» de un pedido que
--    en Madrid entro a las 14:21 no es un detalle de formato, es una fecha
--    equivocada en una disputa con dinero. Ahora cada paso lleva `hora_madrid`
--    ya formateada, y `hora_utc` al lado con el sufijo escrito, para que no haya
--    que adivinar cual es cual.
-- 2. LOS PASOS SIN NOTA IMPRIMIAN `"nota": null`. Un campo en blanco es lo que
--    la regla dura prohibe: o dice algo, o la clave no esta.
-- 3. Una variable muerta que se quedo en el declare.
--
-- El ayudante `_certificado_paso` va aparte porque plpgsql NO admite funciones
-- anidadas -- se intento y lo rechazo el parser.

create or replace function public._certificado_paso(
  p_nombre text, p_hora timestamptz, p_fuente text,
  p_nota text default null, p_fuerza text default null)
returns jsonb
language sql
immutable
as $function$
  -- `jsonb_strip_nulls` es lo que cumple la regla dura: una clave sin valor
  -- desaparece en vez de imprimirse en blanco. `hora_madrid` nula solo ocurre
  -- cuando el estado ya dice «no_disponible» y la nota explica por que.
  select jsonb_strip_nulls(jsonb_build_object(
    'paso',        p_nombre,
    'fuente',      p_fuente,
    'estado',      case when p_hora is null then 'no_disponible' else 'ok' end,
    'hora_madrid', case when p_hora is null then null
                        else to_char(p_hora at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI:SS') end,
    'hora_utc',    case when p_hora is null then null
                        else to_char(p_hora at time zone 'UTC', 'DD/MM/YYYY HH24:MI:SS') || ' UTC' end,
    'fuerza',      p_fuerza,
    'nota',        p_nota));
$function$;

comment on function public._certificado_paso(text, timestamptz, text, text, text) is
  'C9 L3 §5: un paso del certificado. Da la hora en Madrid (regla 4) y en UTC etiquetada. Sin hora -> «no_disponible» con motivo; sin nota -> la clave no aparece, nunca en blanco.';

create or replace function public.certificado_de_salida(p_sale_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_s              record;
  v_pasos          jsonb;
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
begin
  select s.*, l.name as local_nombre
    into v_s
    from public.sale s
    join public.locations l on l.id = s.location_id
   where s.id = p_sale_id;

  if v_s.id is null then
    return jsonb_build_object('error', 'pedido_no_encontrado', 'sale_id', p_sale_id);
  end if;

  select count(distinct coalesce(mi.brand_id, v_s.brand_id)),
         string_agg(distinct b.name, ' + ')
    into v_n_marcas, v_marcas
    from public.sale_line sl
    left join public.menu_item mi on mi.id = sl.menu_item_id
    left join public.brand b on b.id = coalesce(mi.brand_id, v_s.brand_id)
   where sl.sale_id = p_sale_id;

  -- La rafaga, MEDIDA para este pedido: cuantos otros del mismo local comparten
  -- el minuto. Convierte un aviso generico en un numero.
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

  v_pasos := jsonb_build_array(
    public._certificado_paso('Pedido recibido', v_s.created_at, 'sale.created_at'),
    public._certificado_paso('Aceptado', v_s.accepted_at, 'sale.accepted_at',
      case when v_s.accepted_at is null then 'La venta no tiene hora de aceptacion registrada.' end),
    public._certificado_paso('Marcado listo', v_s.ready_at, 'sale.ready_at',
      case
        when v_s.ready_at is null then 'La venta no tiene hora de «listo» registrada.'
        when coalesce(v_rafaga,0) > 0 then
          format('Sello del sistema, SIN acuse de la plataforma. Se marcaron %s pedido(s) mas en el mismo minuto en este local: esta hora dice cuando alguien PULSO, no cuando el pedido estuvo listo.', v_rafaga)
        else 'Sello del sistema, SIN acuse de la plataforma. Dice cuando alguien pulso «Listo».'
      end,
      case when v_s.ready_at is not null then 'debil' end),
    public._certificado_paso('Acuse de la plataforma', null, 'sale_step_event',
      case when v_hay_step_event
           then 'No hay acuse registrado para este pedido.'
           else 'La tabla sale_step_event todavia no existe (B53/L0a sin aplicar). Hasta entonces no hay acuse de plataforma para ningun pedido.' end),
    public._certificado_paso('Entregado al repartidor', v_s.handed_to_courier_at, 'sale.handed_to_courier_at',
      case when v_s.handed_to_courier_at is null then 'Sin hora de entrega al repartidor registrada.' end),
    public._certificado_paso('Entregado al cliente', v_s.delivered_at, 'sale.delivered_at',
      case when v_s.delivered_at is null then 'Sin hora de entrega al cliente registrada (habitual en reparto de plataforma).' end)
  );

  select coalesce(jsonb_agg(jsonb_build_object(
           'documento', j.doc_type, 'estado_trabajo', j.status,
           'creado_madrid', to_char(j.created_at at time zone 'Europe/Madrid','DD/MM HH24:MI:SS'),
           'enviado_madrid', case when j.sent_at is null then 'no disponible'
                                  else to_char(j.sent_at at time zone 'Europe/Madrid','DD/MM HH24:MI:SS') end,
           'terminado_madrid', case when j.done_at is null then 'no disponible'
                                    else to_char(j.done_at at time zone 'Europe/Madrid','DD/MM HH24:MI:SS') end,
           'intentos', j.attempts,
           'ultimo_error', coalesce(j.last_error, 'ninguno')
         ) order by j.created_at), '[]'::jsonb)
    into v_impresiones
    from public.print_job j
   where j.sale_id = p_sale_id;

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
             'primera_acunada_madrid', to_char(v_primer_token at time zone 'Europe/Madrid','DD/MM HH24:MI:SS'),
             'detalle', jsonb_agg(x.fila order by x.orden))
      into v_unidades
      from (
        select jsonb_build_object(
                 'unidad', case when t.line_id is null then 'bolsa de bebidas'
                                else coalesce(sl.product_name,'(linea sin nombre)') end,
                 'n', coalesce(t.unit_no::text, '-'),
                 'token', t.token,
                 'acunada_madrid', to_char(t.created_at at time zone 'Europe/Madrid','DD/MM HH24:MI:SS'),
                 'escaneada_madrid', case when t.scanned_at is null then 'no disponible'
                                          else to_char(t.scanned_at at time zone 'Europe/Madrid','DD/MM HH24:MI:SS') end,
                 'veces', t.scan_count) as fila,
               coalesce(t.unit_no, 999) as orden
          from public.label_token t
          left join public.sale_line sl on sl.id = t.line_id
         where t.sale_id = p_sale_id
      ) x;
  end if;

  select case when count(*) = 0 then
           jsonb_build_object('estado','no_disponible','fuente','sale_capture',
             'nota','No hay ninguna foto de este pedido. La captura (C9 L2 §4) todavia no esta en la tablet.')
         else
           jsonb_build_object('estado','ok','fuente','sale_capture',
             'fotos', jsonb_agg(jsonb_build_object(
               'tipo', c.kind,
               'hecha_madrid', to_char(c.captured_at at time zone 'Europe/Madrid','DD/MM/YYYY HH24:MI:SS'),
               'recibida_madrid', to_char(c.received_at at time zone 'Europe/Madrid','DD/MM/YYYY HH24:MI:SS'),
               'en_diferido', (c.received_at - c.captured_at) > interval '60 seconds',
               'sha256', coalesce(c.sha256, 'no disponible'),
               'medidas', case when c.width is null then 'no disponible'
                               else c.width || 'x' || c.height end,
               'bytes', coalesce(c.bytes::text, 'no disponible'),
               'purgada_madrid', case when c.purged_at is null then 'no purgada'
                                      else to_char(c.purged_at at time zone 'Europe/Madrid','DD/MM/YYYY HH24:MI:SS') end)))
         end
    into v_foto
    from public.sale_capture c where c.sale_id = p_sale_id;

  select case when count(*) = 0 then
           jsonb_build_object('estado','no_disponible','fuente','sale_verification',
             'nota','Este pedido no se ha verificado. El lector de L3 todavia no esta desplegado.')
         else
           jsonb_build_object('estado','ok','fuente','sale_verification',
             'intentos', jsonb_agg(jsonb_build_object(
               'modo', v.modo,
               'cuando_madrid', to_char(v.verificado_at at time zone 'Europe/Madrid','DD/MM/YYYY HH24:MI:SS'),
               'esperadas', v.unidades_esperadas, 'leidas', v.unidades_leidas,
               'completo', v.completo, 'faltantes', v.faltantes,
               'salio_igual', v.salio_igual,
               'motivo', coalesce(v.motivo_excepcion, 'no aplica'),
               'firmado_por', coalesce(v.excepcion_por_nombre, 'no aplica')) order by v.verificado_at))
         end
    into v_verif
    from public.sale_verification v where v.sale_id = p_sale_id;

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
    'generado_madrid', to_char(now() at time zone 'Europe/Madrid','DD/MM/YYYY HH24:MI:SS'),
    'zona_horaria', 'Todas las horas en Europe/Madrid salvo las marcadas UTC.',
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

revoke all on function public._certificado_paso(text, timestamptz, text, text, text) from public, anon;
revoke all on function public.certificado_de_salida(uuid) from public, anon;
grant execute on function public.certificado_de_salida(uuid) to authenticated, service_role;

do $verif$
declare v_c jsonb; v_id uuid;
begin
  select id into v_id from public.sale
   where account_id='51ad1792-6629-4ef7-833a-b57b09a86710' order by created_at desc limit 1;
  if v_id is null then return; end if;

  select public.certificado_de_salida(v_id) into v_c;

  -- Ni un campo en blanco: si un paso no tiene nota, la clave no existe.
  if exists (select 1 from jsonb_array_elements(v_c->'pasos') p
              where p ? 'nota' and p->>'nota' is null) then
    raise exception 'C9 L3: hay pasos con la nota en blanco.';
  end if;
  -- Todo paso «no disponible» tiene que decir por que.
  if exists (select 1 from jsonb_array_elements(v_c->'pasos') p
              where p->>'estado' = 'no_disponible' and coalesce(p->>'nota','') = '') then
    raise exception 'C9 L3: hay un paso «no disponible» sin motivo escrito.';
  end if;
  -- Regla 4: toda hora visible va en Madrid.
  if exists (select 1 from jsonb_array_elements(v_c->'pasos') p
              where p->>'estado' = 'ok' and not (p ? 'hora_madrid')) then
    raise exception 'C9 L3: hay un paso con hora que no la da en Europe/Madrid.';
  end if;
  -- Y el «listo», cuando existe, SIEMPRE va marcado como sello debil.
  if exists (select 1 from jsonb_array_elements(v_c->'pasos') p
              where p->>'paso' = 'Marcado listo' and p->>'estado' = 'ok'
                and coalesce(p->>'fuerza','') <> 'debil') then
    raise exception 'C9 L3: el «marcado listo» no va etiquetado como sello debil.';
  end if;
end
$verif$;
