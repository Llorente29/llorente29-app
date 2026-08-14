-- ENCARGO CODE (14/08) "Recepción: el IVA del cuadre y el enlace con el
-- pedido", Tramo B. El cálculo de candidatos vivía en el cliente
-- (GoodsReceiptForm.tsx), en la pantalla que el nuevo flujo (asistente →
-- oficina) ya no usa — de ahí que ALB-00115 se quedara sin enlazar aunque
-- el candidato (PED-00040) estuviera delante, mismo proveedor+local+fecha.
--
-- Verificado contra los 3 casos reales antes de escribir el umbral:
--   ALB-00113 (BODEGA DE VALLECAS, Alcalá) → 0 candidatos → silencio
--   ALB-00114 (CLOUDTOWN, Carabanchel)     → 0 candidatos → silencio
--   ALB-00115 (CLOUDTOWN, Alcalá)          → 1 candidato (PED-00040) → enlaza
-- El caso de 1 candidato no necesita el score (mismo criterio que ya
-- probó el cliente: "candidato único = enlaza solo SIEMPRE"). El score de
-- solape+fecha solo desempata 2+ candidatos — no hay caso real de eso hoy
-- para calibrar contra datos; se porta la MISMA fórmula ya usada en
-- producción en el cliente (lineScore*0.7 + dateScore*0.3, dominante si
-- top>=0.5 y top-second>=0.25), no una nueva inventada.

-- ─────────────────────────────────────────────────────────────────────
-- Candidatos de un albarán: filtro duro (proveedor+local+pedido abierto)
-- + score de solape de líneas y cercanía de fecha. Un solo sitio,
-- reutilizado por el enlace automático, la vigía y el barrido — para que
-- nunca puedan divergir sobre qué es "un candidato plausible".
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._goods_receipt_order_candidates(p_receipt_id uuid)
returns table(order_id uuid, order_code text, expected_date date, score numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  -- Mismos valores por defecto que ya corrían en producción en el cliente
  -- (GoodsReceiptForm.tsx, supplySettings.dockPendingWindowBeforeDays/
  -- AfterDays) — no se inventan nuevos. SIN esta ventana como filtro DURO
  -- (no solo como decaimiento del score), un proveedor con UN pedido
  -- abierto "candidatea" contra TODO su histórico de recepciones — lo vi
  -- en vivo: CLOUDTOWN llevaba semanas sin ningún pedido abierto nuevo,
  -- y las 36 recepciones desde el 06/08 hasta hoy "candidateaban" contra
  -- el mismo PED-00040 (abierto el 13/08). Con la ventana como filtro,
  -- solo entran las de dentro de rango — el resto, silencio de verdad.
  c_window_before_days constant integer := 7;
  c_window_after_days  constant integer := 3;
  c_date_window_days constant integer := 10;
  c_line_weight       constant numeric := 0.7;
  c_date_weight       constant numeric := 0.3;
  v_receipt goods_receipt%rowtype;
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found or v_receipt.supplier_id is null then
    return;
  end if;

  return query
  with candidates as (
    select po.id, po.code, po.expected_date
    from purchase_order po
    where po.account_id = v_receipt.account_id
      and po.supplier_id = v_receipt.supplier_id
      and po.location_id = v_receipt.location_id
      and po.status in ('enviado', 'recibido_parcial')
      and coalesce(v_receipt.received_at, now())::date
          between po.expected_date - c_window_before_days
              and po.expected_date + c_window_after_days
  ),
  receipt_words as (
    select array_agg(distinct w) as words
    from goods_receipt_line grl,
         lateral regexp_split_to_table(
           lower(regexp_replace(unaccent(grl.product_name), '[^a-z0-9]+', ' ', 'g')), '\s+'
         ) as w
    where grl.goods_receipt_id = p_receipt_id and length(w) >= 3
  ),
  scored as (
    select
      c.id, c.code, c.expected_date,
      coalesce((
        select avg(
          case when exists (
            select 1
            from purchase_order_line pol,
                 lateral regexp_split_to_table(
                   lower(regexp_replace(unaccent(pol.product_name), '[^a-z0-9]+', ' ', 'g')), '\s+'
                 ) as pw
            where pol.purchase_order_id = c.id and length(pw) >= 3 and pw = ow
          ) then 1.0 else 0.0 end
        )
        from unnest((select words from receipt_words)) as ow
      ), 0) as line_score,
      greatest(0, 1 - abs(extract(day from (coalesce(v_receipt.received_at, now()) - c.expected_date::timestamptz))) / c_date_window_days) as date_score
    from candidates c
  )
  select scored.id, scored.code, scored.expected_date, round((scored.line_score * c_line_weight + scored.date_score * c_date_weight)::numeric, 4)
  from scored;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Enlace automático "en caliente". Solo si goods_receipt.purchase_order_id
-- es null (nunca pisa un enlace ya decidido, ni a mano ni por el sistema).
-- 0 candidatos → null, silencio. 1 candidato → enlaza siempre. 2+ →
-- enlaza solo si hay un dominante claro; si no, se queda sin enlazar y lo
-- recoge la vigía (pending_kind albaran_sin_pedido).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.auto_link_goods_receipt_to_order(p_receipt_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  c_score_threshold constant numeric := 0.5;
  c_score_margin    constant numeric := 0.25;
  v_current_order_id uuid;
  v_top record;
  v_second record;
  v_count integer;
begin
  select purchase_order_id into v_current_order_id from goods_receipt where id = p_receipt_id;
  if v_current_order_id is not null then
    return null;
  end if;

  select count(*) into v_count from public._goods_receipt_order_candidates(p_receipt_id);

  if v_count = 0 then
    return null;
  elsif v_count = 1 then
    select order_id into v_top from public._goods_receipt_order_candidates(p_receipt_id) limit 1;
    update goods_receipt set purchase_order_id = v_top.order_id, updated_at = now() where id = p_receipt_id;
    return v_top.order_id;
  end if;

  select order_id, score into v_top
    from public._goods_receipt_order_candidates(p_receipt_id) order by score desc limit 1;
  select score into v_second
    from public._goods_receipt_order_candidates(p_receipt_id) order by score desc offset 1 limit 1;

  if v_top.score >= c_score_threshold and (v_top.score - coalesce(v_second.score, 0)) >= c_score_margin then
    update goods_receipt set purchase_order_id = v_top.order_id, updated_at = now() where id = p_receipt_id;
    return v_top.order_id;
  end if;

  return null; -- ambiguo: se queda para la vigía, no se decide solo
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Cablear el enlace automático en los dos caminos que cierran una
-- recepción (§B.2: "en el camino borrador → confirmado, para no dejar
-- huecos"). CREATE OR REPLACE sobre las funciones ya vivas — se añade el
-- intento de enlace ANTES del recompute que ya existía, sin tocar el
-- resto del cuerpo.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.receive_goods_receipt(p_receipt_id uuid)
 returns TABLE(posted_lines integer, skipped_lines integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_receipt goods_receipt%rowtype;
  v_posted  integer := 0;
  v_skipped integer := 0;
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found then
    raise exception 'receive_goods_receipt: albarán % no existe', p_receipt_id;
  end if;
  if not belongs_to_account(v_receipt.account_id) then
    raise exception 'receive_goods_receipt: sin acceso al albarán %', p_receipt_id;
  end if;
  if v_receipt.status <> 'borrador' then
    raise exception 'receive_goods_receipt: el albarán % no está en borrador (está %)',
      p_receipt_id, v_receipt.status;
  end if;

  select p.posted_lines, p.skipped_lines into v_posted, v_skipped
    from public._post_goods_receipt_lines(p_receipt_id) p;

  update goods_receipt
    set status = 'recibido', received_at = coalesce(received_at, now()),
        needs_review = (v_skipped > 0), updated_at = now()
    where id = p_receipt_id;

  -- ENCARGO CODE (14/08) fix/recepcion-iva-y-enlace-pedido, §B.2 — enlace
  -- automático "en caliente" si todavía no tiene pedido.
  if v_receipt.purchase_order_id is null then
    v_receipt.purchase_order_id := public.auto_link_goods_receipt_to_order(p_receipt_id);
  end if;

  if v_receipt.purchase_order_id is not null then
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

create or replace function public.confirm_goods_receipt(p_receipt_id uuid)
 returns TABLE(posted_lines integer, skipped_lines integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_receipt   goods_receipt%rowtype;
  v_user      uuid;
  v_user_name text;
  v_posted    integer := 0;
  v_skipped   integer := 0;
  v_notify    text;
  v_has_diff  boolean;
  v_undecided integer;
begin
  select * into v_receipt from goods_receipt where id = p_receipt_id;
  if not found then
    raise exception 'confirm_goods_receipt: albarán % no existe', p_receipt_id;
  end if;
  if not belongs_to_account(v_receipt.account_id) then
    raise exception 'confirm_goods_receipt: sin acceso al albarán %', p_receipt_id;
  end if;
  if v_receipt.status not in ('borrador', 'recibido') then
    raise exception 'confirm_goods_receipt: el albarán % no está en borrador ni recibido (está %)',
      p_receipt_id, v_receipt.status;
  end if;

  if v_receipt.status = 'recibido' then
    select count(*) into v_undecided
      from goods_receipt_line
     where goods_receipt_id = p_receipt_id
       and not not_goods
       and (recipe_item_id is null or qty_in_base is null or qty_in_base <= 0);
    if v_undecided > 0 then
      raise exception 'confirm_goods_receipt: quedan % línea(s) sin decidir en % — cada una tiene '
        'que entrar al almacén o marcarse como que no es mercancía', v_undecided, v_receipt.code;
    end if;
  end if;

  v_user := auth.uid();
  select display_name into v_user_name from user_profiles where id = v_user;

  if v_receipt.status = 'borrador' then
    select p.posted_lines, p.skipped_lines into v_posted, v_skipped
      from public._post_goods_receipt_lines(p_receipt_id) p;
  end if;

  update goods_receipt
    set status = 'confirmado', received_at = coalesce(received_at, now()),
        needs_review = exists (
          select 1 from goods_receipt_line
           where goods_receipt_id = p_receipt_id
             and not not_goods
             and (recipe_item_id is null or qty_in_base is null or qty_in_base <= 0)
        ),
        updated_at = now()
    where id = p_receipt_id;

  -- ENCARGO CODE (14/08) fix/recepcion-iva-y-enlace-pedido, §B.2 — mismo
  -- enlace automático que receive_goods_receipt, para no dejar huecos en
  -- el camino borrador → confirmado directo (compatibilidad con lo que no
  -- pasa por el asistente).
  if v_receipt.purchase_order_id is null then
    v_receipt.purchase_order_id := public.auto_link_goods_receipt_to_order(p_receipt_id);
  end if;

  if v_receipt.purchase_order_id is not null then
    perform recompute_purchase_order_status(v_receipt.purchase_order_id);
  end if;

  v_notify := null;
  if v_receipt.supplier_id is not null then
    select notify_group into v_notify from supplier where id = v_receipt.supplier_id;
  end if;
  if v_notify = 'ctb' then
    select exists (
      select 1 from goods_receipt_line
      where goods_receipt_id = p_receipt_id
        and discrepancy_reason is not null
        and btrim(discrepancy_reason) <> ''
    ) into v_has_diff;

    insert into ctb_notification_queue (
      account_id, goods_receipt_id, location_id, supplier_id,
      notify_group, has_differences, status
    )
    values (
      v_receipt.account_id, p_receipt_id, v_receipt.location_id, v_receipt.supplier_id,
      v_notify, coalesce(v_has_diff, false), 'pendiente'
    )
    on conflict (goods_receipt_id) do update
      set has_differences = excluded.has_differences,
          location_id     = excluded.location_id,
          supplier_id     = excluded.supplier_id,
          updated_at      = now();
  end if;

  posted_lines := v_posted; skipped_lines := v_skipped;
  return next;
end;
$function$;

-- ─────────────────────────────────────────────────────────────────────
-- "Sí, es este" — confirmación humana de un candidato propuesto por la
-- vigía. Valida que el pedido SÍ es uno de los candidatos reales de este
-- albarán (defensa en profundidad: el cliente no puede enlazar a
-- cualquier pedido con esta función).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.confirm_goods_receipt_order_link(p_account_id uuid, p_receipt_id uuid, p_order_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_receipt goods_receipt%rowtype;
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'confirm_goods_receipt_order_link: cuenta % no pertenece al usuario', p_account_id;
  end if;

  select * into v_receipt from goods_receipt where id = p_receipt_id and account_id = p_account_id;
  if not found then
    raise exception 'confirm_goods_receipt_order_link: albarán % no existe en esta cuenta', p_receipt_id;
  end if;

  if not exists (
    select 1 from public._goods_receipt_order_candidates(p_receipt_id) c where c.order_id = p_order_id
  ) then
    raise exception 'confirm_goods_receipt_order_link: el pedido % no es un candidato real de este albarán', p_order_id;
  end if;

  update goods_receipt set purchase_order_id = p_order_id, updated_at = now() where id = p_receipt_id;
  perform recompute_purchase_order_status(p_order_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Detalle para el "al abrirla, la lista" de la vigía albaran_sin_pedido:
-- un albarán por fila con su mejor candidato. _goods_receipt_order_candidates
-- no lleva belongs_to_account (es interna, prefijo _), esta sí — es la que
-- puede llamar el cliente.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.pending_albaran_sin_pedido_detail(p_account_id uuid, p_location_id uuid)
returns table(
  receipt_id uuid, receipt_code text, supplier_name text, received_at timestamptz,
  candidate_order_id uuid, candidate_order_code text, candidate_expected_date date, candidate_score numeric
)
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'pending_albaran_sin_pedido_detail: cuenta % no pertenece al usuario', p_account_id;
  end if;

  return query
  select gr.id, gr.code, s.name, gr.received_at,
         c.order_id, c.order_code, c.expected_date, c.score
  from goods_receipt gr
  join supplier s on s.id = gr.supplier_id
  join lateral (
    select * from public._goods_receipt_order_candidates(gr.id) order by score desc limit 1
  ) c on true
  where gr.account_id = p_account_id
    and gr.location_id = p_location_id
    and gr.purchase_order_id is null
    and gr.status in ('recibido', 'confirmado')
  order by gr.received_at desc;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- Vigía: pending_kind nuevo 'albaran_sin_pedido' en pending_raw_entities
-- (Fase 1 de Pendientes, ya mergeada). Solo aparece si el albarán SÍ tiene
-- al menos un candidato plausible — "si no hay ningún candidato, silencio"
-- (§B.2.3). No es una tabla de propuestas aparte: pending_board recalcula
-- en vivo cada vez, así que "el barrido" y "la vigía" son la misma
-- consulta — no hay estado que pueda desincronizarse entre los dos.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.pending_raw_entities(p_account_id uuid)
returns table(pending_kind text, entity_id uuid, location_id uuid, entity_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  return query
  select 'recepcion_esperando_oficina', gr.id, gr.location_id, gr.received_at
  from goods_receipt gr
  where gr.account_id = p_account_id and gr.status = 'recibido'

  union all
  select 'albaran_genero_sin_casar', gr.id, gr.location_id, gr.received_at
  from goods_receipt gr
  where gr.account_id = p_account_id and gr.status = 'confirmado' and gr.needs_review

  union all
  select 'pedido_vencido', po.id, po.location_id, po.expected_date::timestamptz
  from purchase_order po
  where po.account_id = p_account_id and po.status = 'enviado' and po.expected_date < current_date

  union all
  select 'albaran_borrador_atascado', gr.id, gr.location_id, gr.created_at
  from goods_receipt gr
  where gr.account_id = p_account_id and gr.status = 'borrador' and gr.created_at < now() - interval '2 days'

  union all
  select 'pedido_borrador_atascado', po.id, po.location_id, po.created_at
  from purchase_order po
  where po.account_id = p_account_id and po.status = 'borrador' and po.created_at < now() - interval '7 days'

  union all
  select 'recuento_abierto', ic.id, ic.location_id, ic.created_at
  from inventory_count ic
  where ic.account_id = p_account_id and ic.closed_at is null and ic.status <> 'anulado'

  union all
  select 'recuento_sin_aprobar', ic.id, ic.location_id, ic.closed_at
  from inventory_count ic
  where ic.account_id = p_account_id and ic.closed_at is not null and ic.approved_at is null and ic.status <> 'anulado'

  union all
  select 'linea_sin_coste', sm.id, sm.location_id, sm.created_at
  from stock_movement sm
  where sm.account_id = p_account_id and sm.source_type = 'goods_receipt_line' and sm.unit_cost is null

  union all
  select 'albaran_sin_pedido', gr.id, gr.location_id, gr.received_at
  from goods_receipt gr
  where gr.account_id = p_account_id
    and gr.purchase_order_id is null
    and gr.status in ('recibido', 'confirmado')
    and exists (select 1 from public._goods_receipt_order_candidates(gr.id));
end;
$$;

-- Añade el pending_kind al tablero (mismo permiso que las recepciones:
-- show_recepcion; capa semana, entre albaran_borrador_atascado y
-- pedido_borrador_atascado).
create or replace function public.pending_board(p_account_id uuid)
returns table(
  pending_kind   text,
  layer          text,
  area           text,
  location_id    uuid,
  location_name  text,
  items          integer,
  detail         jsonb,
  sort_weight    integer
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_profile_id uuid;
  v_user_role text;
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
  group by sl.id, sl.name;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- dismiss_pending gana p_entity_id (opcional, default null = comportamiento
-- de siempre) para poder descartar UNA entidad concreta, no el tipo entero
-- en el local — necesario para "No, es una compra suelta" (§B.2.3): esa
-- respuesta es por albarán, no debe apagar el vigía para los demás.
--
-- 🔴 CREATE OR REPLACE con un parámetro nuevo (aunque tenga default) NO
-- sustituye la firma vieja de 6 argumentos — crea una SEGUNDA función
-- sobrecargada y deja la vieja viva y llamable. Se DROPea la firma
-- anterior explícitamente antes de crear la nueva, y se verifica
-- count=1 al cierre de esta migración.
-- ─────────────────────────────────────────────────────────────────────
drop function if exists public.dismiss_pending(uuid, text, uuid, text, text, text);

create or replace function public.dismiss_pending(
  p_account_id uuid,
  p_pending_kind text,
  p_location_id uuid,
  p_action text,
  p_preset text default null,
  p_reason text default null,
  p_entity_id uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_profile_id uuid;
  v_user_id uuid;
  v_user_name text;
  v_until timestamptz;
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'dismiss_pending: cuenta % no pertenece al usuario', p_account_id;
  end if;

  if p_action not in ('posponer', 'descartar') then
    raise exception 'dismiss_pending: action invalida %', p_action;
  end if;

  select up.id, up.user_id, up.display_name into v_user_profile_id, v_user_id, v_user_name
  from public.user_profiles up
  where up.user_id = auth.uid() and up.account_id = p_account_id and up.active = true
  limit 1;

  if v_user_profile_id is null then
    raise exception 'dismiss_pending: sin perfil activo en esta cuenta';
  end if;

  if p_action = 'posponer' then
    if p_preset not in ('manana', 'semana', 'mes') then
      raise exception 'dismiss_pending: preset invalido para posponer';
    end if;
    v_until := case p_preset
      when 'manana' then (current_date + 1)::timestamptz
      when 'semana' then (current_date + 7)::timestamptz
      else (current_date + interval '1 month')::timestamptz
    end;

    insert into public.pending_dismissal (account_id, location_id, pending_kind, entity_id, action, until, created_by, created_by_name)
    select p_account_id, p_location_id, p_pending_kind, r.entity_id, 'posponer', v_until, v_user_id, v_user_name
    from public.pending_raw_entities(p_account_id) r
    where r.pending_kind = p_pending_kind and r.location_id = p_location_id;

  else
    if p_reason is null or length(trim(p_reason)) = 0 then
      raise exception 'dismiss_pending: descartar exige motivo';
    end if;
    insert into public.pending_dismissal (account_id, location_id, pending_kind, entity_id, action, reason, created_by, created_by_name)
    values (p_account_id, p_location_id, p_pending_kind, p_entity_id, 'descartar', p_reason, v_user_id, v_user_name);
  end if;
end;
$$;

do $$
declare
  v_dismiss_count integer;
begin
  if to_regprocedure('public._goods_receipt_order_candidates(uuid)') is null then
    raise exception 'falta _goods_receipt_order_candidates';
  end if;
  if to_regprocedure('public.auto_link_goods_receipt_to_order(uuid)') is null then
    raise exception 'falta auto_link_goods_receipt_to_order';
  end if;
  if to_regprocedure('public.confirm_goods_receipt_order_link(uuid,uuid,uuid)') is null then
    raise exception 'falta confirm_goods_receipt_order_link';
  end if;
  if to_regprocedure('public.pending_albaran_sin_pedido_detail(uuid,uuid)') is null then
    raise exception 'falta pending_albaran_sin_pedido_detail';
  end if;

  select count(*) into v_dismiss_count from pg_proc where proname = 'dismiss_pending';
  if v_dismiss_count <> 1 then
    raise exception 'dismiss_pending: esperaba 1 sobrecarga, hay % — el drop de la firma vieja no funcionó', v_dismiss_count;
  end if;
end $$;
