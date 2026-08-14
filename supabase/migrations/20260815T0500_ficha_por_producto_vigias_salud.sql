-- ----------------------------------------------------------------------------
-- Folvy - 20260815T0500
-- Ficha por producto (Tramo E): tres vigías nuevos en SALUD
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- "Cero de estos tres números se resuelve solo: cada uno tiene un humano al
-- final." Mismo patrón agregado que stock_negativo -- no por entidad, solo
-- cuenta, capa 'salud', visible solo cuando hay algo que mirar (count > 0).
--
--   ficha_contradice_historico -- fichas activas cuyo formato NO coincide
--     con la mediana de sus propias líneas reales (>=3 usos). Es la consulta
--     que destapó los 7 hallazgos del 14/08 y los 21 del Tramo C,
--     convertida en permanente y recalculada en vivo cada vez.
--   codigo_ambiguo -- códigos de proveedor con más de un artículo en fichas
--     ACTIVAS hoy.
--   fichas_sin_verificar -- fichas source='albaran' con verified_at aún null.
--
-- Ninguno de los tres tiene location_id propio (article_supplier es de
-- CUENTA, no de local) -- simplificación declarada: se cruzan con cada
-- local visible para el usuario, así que el mismo número aparece una vez
-- por local (verificado en vivo: Foodint Alcalá y Foodint Carabanchel
-- muestran el mismo 15/3/18).
--
-- Verificado en vivo (usuario admin real): ficha_contradice_historico=15,
-- codigo_ambiguo=3, fichas_sin_verificar=18 -- coincide exacto con el
-- cálculo directo hecho fuera de pending_board antes de tocar la función.
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
    and v.total > 0 and v.pct_ok < c_pct_minimo_sano

  union all

  select 'ficha_contradice_historico', 'salud', 'almacen', sl.id, sl.name,
    v.n::integer, jsonb_build_object(), 96
  from scoped_locations sl
  cross join lateral (
    select count(*) as n
    from (
      select a.id
      from public.article_supplier a
      join public.recipe_item_purchase_format f on f.id = a.purchase_format_id and f.is_active
      join (
        select gr.supplier_id, grl.supplier_code,
          percentile_cont(0.5) within group (order by grl.qty_in_base / grl.qty_received) as mediana,
          count(*) as n
        from public.goods_receipt_line grl
        join public.goods_receipt gr on gr.id = grl.goods_receipt_id
        where gr.account_id = p_account_id and grl.supplier_code is not null
          and grl.qty_received is not null and grl.qty_received > 0 and grl.qty_in_base is not null
        group by gr.supplier_id, grl.supplier_code
        having count(*) >= 3
      ) h on h.supplier_id = a.supplier_id and h.supplier_code = a.supplier_code
      where a.account_id = p_account_id and a.is_active
        and abs(f.qty_in_base - h.mediana) >= 0.01
    ) x
  ) v
  where public.has_permission(p_account_id, 'show_costes') and v.n > 0

  union all

  select 'codigo_ambiguo', 'salud', 'almacen', sl.id, sl.name,
    v.n::integer, jsonb_build_object(), 97
  from scoped_locations sl
  cross join lateral (
    select count(*) as n
    from (
      select supplier_id, supplier_code
      from public.article_supplier
      where account_id = p_account_id and supplier_code is not null and is_active
      group by supplier_id, supplier_code
      having count(distinct recipe_item_id) > 1
    ) x
  ) v
  where public.has_permission(p_account_id, 'show_recepcion') and v.n > 0

  union all

  select 'fichas_sin_verificar', 'salud', 'almacen', sl.id, sl.name,
    v.n::integer, jsonb_build_object(), 98
  from scoped_locations sl
  cross join lateral (
    select count(*) as n
    from public.article_supplier a
    where a.account_id = p_account_id and a.source = 'albaran' and a.verified_at is null and a.is_active
  ) v
  where public.has_permission(p_account_id, 'show_recepcion') and v.n > 0;
end;
$function$;
