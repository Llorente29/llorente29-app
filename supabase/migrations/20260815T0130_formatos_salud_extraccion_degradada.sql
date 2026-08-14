-- ----------------------------------------------------------------------------
-- Folvy - 20260815T0130
-- Formatos (Tramo D.4): vigía de la fuente en la capa SALUD de Pendientes
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- Ley 1.bis, nota de la vigía: "toda esta ley cuelga de una extracción de IA
-- cuyo prompt vive en una edge function... se añade un indicador a la capa
-- SALUD: % de líneas de OCR con pack_size y supplier_code presentes,
-- semanal. Si alguien toca el prompt y la fuente se degrada, se ve, no se
-- descubre a las cinco semanas."
--
-- Nuevo kind 'formatos_extraccion_degradada' en pending_board, capa 'salud'
-- (mismo patrón que 'stock_negativo': agregado, no por entidad, solo
-- aparece cuando hay algo que mirar). Cobertura por local, últimos 7 días.
-- Umbral: <90% de líneas con ambos campos presentes. Línea base real
-- 14/08: 682/699 = 97,6% con código en todo el histórico -- 90% deja
-- margen sin silenciar una degradación real del prompt.
--
-- Verificado en vivo: cobertura real de los últimos 7 días = 100% en los
-- dos locales con recepciones -- el indicador correctamente no aparece
-- (silencioso cuando está sano, que es la mitad del contrato).
-- ----------------------------------------------------------------------------

create or replace function public.pending_board(p_account_id uuid)
 RETURNS TABLE(pending_kind text, layer text, area text, location_id uuid, location_name text, items integer, detail jsonb, sort_weight integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_profile_id uuid;
  v_user_role text;
  c_pct_minimo_sano constant numeric := 90;
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'pending_board: cuenta % no pertenece al usuario', p_account_id;
  end if;

  set local statement_timeout = '3s';

  select up.id, up.role into v_user_profile_id, v_user_role
  from public.user_profiles up
  where up.user_id = auth.uid() and up.account_id = p_account_id and up.active = true
  limit 1;

  if v_user_profile_id is null then
    return;
  end if;

  return query
  with scoped_locations as (
    select l.id, l.name
    from public.locations l
    where l.account_id = p_account_id and l.active = true
      and (
        v_user_role = 'admin'
        or exists (
          select 1 from public.manager_locations ml
          where ml.user_profile_id = v_user_profile_id and ml.location_id = l.id
        )
      )
  ),
  dismissed as (
    select d.pending_kind, d.location_id, d.entity_id
    from public.pending_dismissal d
    where d.account_id = p_account_id
      and (
        (d.action = 'posponer' and d.until > now())
        or d.action = 'descartar'
      )
  ),
  raw as (
    select r.pending_kind, r.entity_id, r.location_id, r.entity_at
    from public.pending_raw_entities(p_account_id) r
    join scoped_locations sl on sl.id = r.location_id
    where not exists (
      select 1 from dismissed d
      where d.pending_kind = r.pending_kind
        and d.location_id = r.location_id
        and (d.entity_id = r.entity_id or d.entity_id is null)
    )
  ),
  counted as (
    select r.pending_kind, r.location_id, count(*)::integer as items, min(r.entity_at) as oldest_at
    from raw r
    group by r.pending_kind, r.location_id
  ),
  kinds as (
    select * from (values
      ('recepcion_esperando_oficina', 'ahora',  'almacen', 'show_recepcion',   10),
      ('albaran_genero_sin_casar',    'ahora',  'almacen', 'show_recepcion',   20),
      ('pedido_vencido',              'ahora',  'almacen', 'show_pedidos',     30),
      ('albaran_borrador_atascado',   'semana', 'almacen', 'show_recepcion',   40),
      ('albaran_sin_pedido',          'semana', 'almacen', 'show_recepcion',   45),
      ('pedido_borrador_atascado',    'semana', 'almacen', 'show_pedidos',     50),
      ('recuento_abierto',            'semana', 'almacen', 'show_inventarios', 60),
      ('recuento_sin_aprobar',        'semana', 'almacen', 'show_inventarios', 70),
      ('linea_sin_coste',             'semana', 'almacen', 'show_costes',      80)
    ) as k(pending_kind, layer, area, perm_key, sort_weight)
  )
  select
    c.pending_kind, k.layer, k.area, c.location_id, sl.name,
    c.items, jsonb_build_object('oldest_at', c.oldest_at), k.sort_weight
  from counted c
  join kinds k on k.pending_kind = c.pending_kind
  join scoped_locations sl on sl.id = c.location_id
  where public.has_permission(p_account_id, k.perm_key)

  union all

  select
    'stock_negativo', 'salud', 'almacen', sl.id, sl.name,
    count(*)::integer, jsonb_build_object(), 90
  from public.recipe_item_location_stock rils
  join scoped_locations sl on sl.id = rils.location_id
  where rils.account_id = p_account_id and rils.qty_on_hand < 0
    and public.has_permission(p_account_id, 'show_inventory')
  group by sl.id, sl.name

  union all

  select
    'formatos_extraccion_degradada', 'salud', 'almacen', sl.id, sl.name,
    v.faltan::integer,
    jsonb_build_object('pct_ok', v.pct_ok, 'total_semana', v.total),
    95
  from scoped_locations sl
  cross join lateral (
    select
      count(*) as total,
      count(*) filter (where (ln->>'pack_size') is null or nullif(ln->>'supplier_code','') is null) as faltan,
      round(100.0 * count(*) filter (where (ln->>'pack_size') is not null and nullif(ln->>'supplier_code','') is not null) / nullif(count(*),0), 1) as pct_ok
    from public.goods_receipt gr
    join public.goods_receipt_ai_session s on s.id = gr.ai_session_id
    cross join lateral jsonb_array_elements(s.parsed_result->'lines') as ln
    where gr.account_id = p_account_id and gr.location_id = sl.id
      and gr.created_at > now() - interval '7 days'
  ) v
  where public.has_permission(p_account_id, 'show_recepcion')
    and v.total > 0 and v.pct_ok < c_pct_minimo_sano;
end;
$function$;
