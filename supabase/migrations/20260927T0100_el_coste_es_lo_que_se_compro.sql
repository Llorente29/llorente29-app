-- ============================================================================
-- El coste es lo que se compró: `average_weighted` deja de ser una bandera sin
-- rama, y los que la llevaban pasan a decir lo que de verdad calculan
-- ----------------------------------------------------------------------------
-- 26/09/2026. Encargo «El coste del artículo pasa a media ponderada, y 68
-- artículos llevan meses creyendo que ya la tenían».
--
-- PROPUESTA, SIN APLICAR. Toca un CHECK de `recipe_item` (ACCESS EXCLUSIVE
-- sobre una tabla que el pedido lee en cada línea: `_sale_line_raw_consumption`,
-- `compute_sale_line_cost`). Va FUERA DE BANDA, después de las 00:30.
--
-- ── LA CAUSA, LEÍDA EN LO DESPLEGADO (26/09 17:49 Madrid) ──────────────────
-- `kitchen_recompute_raw_cost` (md5 f1ae243e8129bded94eba67aa26c4348) solo
-- distingue 'fixed'. 'last_purchase', 'average_weighted' y 'average_window'
-- caen en la misma rama: el last_price del proveedor con estrella.
--
-- ── LO QUE SE MIDIÓ ANTES DE ESCRIBIR (26/09 ~18:00, todo con account_id) ──
-- Artículos raw/tool/packaging, activos y sin archivar:
--   Foodint (51ad1792…)        average_weighted 68 (58 raw + 10 packaging)
--                              last_purchase    66 · fixed 52
--   Folvy Interno (plantilla)  average_weighted 159 · last_purchase 24 · fixed 12
--   Kitchen Grill LstQ (susp.) average_window   56
-- Con archivados, Foodint lleva 75 average_weighted (7 archivados/inactivos).
--
-- `recipe_item.cost_window_days` = 30 en TODAS las filas de todas las cuentas
-- y no lo lee ninguna función de coste. `kitchen_settings.cost_window_days_default`
-- = 30 en las 3 cuentas, tampoco lo lee nadie más que `onboard_account` al
-- sembrar. `kitchen_settings.cost_strategy_default` = 'avg_window' en las 3.
-- `onboard_account` siembra SIEMPRE 'average_window' (su CASE cae ahí en el ELSE).
--
-- La pasada de las 04:00 (`kitchen-recompute-nightly` → cron_kitchen_recompute_all
-- → kitchen_recompute_all) recalcula SOLO recetas y platos. Las materias primas
-- solo se recalculan cuando se toca su article_supplier.
--
-- ── EL CAMINO DEL PEDIDO (banda) — contado, no supuesto ────────────────────
-- Quién llama a kitchen_recompute_raw_cost: trg_article_supplier_recompute_cost
-- (recepción), void_goods_receipt, classify_unmapped_product (solo la llama
-- commit_ai_action), _kitchen_recompute_item_unguarded (UI y la pasada de las
-- 04:00). Crons: 1 (kitchen-recompute-nightly). Disparadores de venta: 0.
-- No está en el camino del pedido. PERO esta migración cambia el CHECK de
-- recipe_item, y eso sí toma ACCESS EXCLUSIVE sobre una tabla del camino:
-- falla la condición 2. Espera a las 00:30.
--
-- ── LO QUE HACE, POR ORDEN ────────────────────────────────────────────────
--  1. `_article_weighted_cost`: el cálculo, sin escribir nada. Una sola vara
--     para el motor, la ficha, la aprobación y la lista de revisión.
--  2. `recipe_item_cost_rollout`: la memoria de quién estaba marcado como media
--     y en qué grupo cae, medido con la función de (1).
--  3. Los que decían 'average_weighted' o 'average_window' pasan a
--     'last_purchase', QUE ES LO QUE YA CALCULAN. Cambio neutro en coste:
--     ningún computed_cost se mueve en esta migración.
--  4. 'average_window' sale de los dos CHECK. La ventana es UNA por cuenta:
--     kitchen_settings.cost_window_days_default = 90. El campo por artículo se
--     vacía (NULL) y se comenta como retirado.
--  5. El motor con la rama nueva, y las cuatro puertas: el albarán (disparador
--     que ya existía + uno nuevo al cambiar el estado del albarán o corregir
--     una línea), la pasada nocturna, la aprobación y la ficha.
--  6. Encender es un acto aparte, con nombre: `approve_average_cost` (uno a
--     uno, lo que hace Julio con su tabla delante) y
--     `encender_coste_medio_quietos` (los que no se mueven ni un céntimo).
--     NINGUNO se enciende en esta migración.
-- ============================================================================

begin;

-- ─── 1 · EL CÁLCULO, SIN ESCRIBIR ─────────────────────────────────────────
-- coste = Σ doc_amount ÷ Σ qty_in_base de las líneas de los últimos N días
-- (N = kitchen_settings.cost_window_days_default, 90 si no hay fila).
--
-- Una línea cuenta si: su albarán está 'recibido' o 'confirmado' (ni borrador
-- ni anulado), la línea entró al almacén (tiene su movimiento 'recepcion'), no
-- es «no mercancía», qty_in_base > 0 y doc_amount no es NULL.
--
-- El guardia: se calcula la mediana del €/unidad de las líneas de la ventana
-- con importe positivo. Una línea que se sale más de 3× por arriba o por abajo
-- NO entra en la media, y va marcada con su motivo. Una línea con importe <= 0
-- (abono, regalo) tampoco entra, y también va marcada. El albarán no se toca.
--
-- Cascada: 2+ líneas que entran → 'media'. 1 → 'poco_dato'. 0 → la última
-- compra conocida de cualquier fecha → 'ultima_conocida'. Nunca comprado →
-- 'sin_compras' y coste NULL: quien llama decide conservar el anterior.
create or replace function public._article_weighted_cost(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_item    recipe_item%rowtype;
  v_days    integer;
  v_hoy     date;
  v_desde   date;
  v_lineas  jsonb;
  v_n       integer;
  v_desc    integer;
  v_amt     numeric;
  v_qty     numeric;
  v_med     numeric;
  v_last    record;
  v_metodo  text;
  v_coste   numeric;
  v_ultima  jsonb := null;
begin
  select * into v_item from recipe_item where id = p_item_id;
  if not found then
    raise exception '_article_weighted_cost: item % no existe', p_item_id;
  end if;

  select ks.cost_window_days_default into v_days
    from kitchen_settings ks where ks.account_id = v_item.account_id;
  v_days  := coalesce(v_days, 90);
  v_hoy   := (now() at time zone 'Europe/Madrid')::date;
  v_desde := v_hoy - v_days;

  with elig as (
    select grl.id, gr.code, gr.receipt_date, s.name as proveedor, grl.product_name,
           grl.qty_in_base as q, grl.doc_amount as a,
           grl.doc_amount / grl.qty_in_base as eur
      from goods_receipt_line grl
      join goods_receipt gr
        on gr.id = grl.goods_receipt_id and gr.account_id = v_item.account_id
      left join supplier s on s.id = gr.supplier_id
     where grl.recipe_item_id = p_item_id
       and grl.account_id     = v_item.account_id
       and gr.status in ('recibido', 'confirmado')
       and not grl.not_goods
       and grl.qty_in_base > 0
       and grl.doc_amount is not null
       and gr.receipt_date >= v_desde
       and exists (select 1 from stock_movement sm
                    where sm.source_type = 'goods_receipt_line'
                      and sm.source_id   = grl.id
                      and sm.movement_type = 'recepcion')
  ), med as (
    select percentile_cont(0.5) within group (order by eur) as m from elig where a > 0
  ), marcadas as (
    select e.*,
           case when e.a <= 0                          then 'importe_no_positivo'
                when med.m > 0 and e.eur > 3 * med.m   then 'mas_de_3x_la_mediana'
                when med.m > 0 and e.eur < med.m / 3   then 'menos_de_un_tercio_de_la_mediana'
           end as motivo
      from elig e cross join med
  )
  select coalesce(jsonb_agg(jsonb_build_object(
             'linea_id', id, 'albaran', code, 'fecha', receipt_date,
             'proveedor', proveedor, 'producto', product_name,
             'cantidad', q, 'importe', a, 'eur_unidad', eur,
             'entra', motivo is null, 'motivo', motivo)
           order by receipt_date desc, code), '[]'::jsonb),
         count(*),
         count(*) filter (where motivo is not null),
         sum(a) filter (where motivo is null),
         sum(q) filter (where motivo is null),
         (select m from med)
    into v_lineas, v_n, v_desc, v_amt, v_qty, v_med
    from marcadas;

  if v_n - v_desc >= 2 then
    v_metodo := 'media';
    v_coste  := v_amt / v_qty;
  elsif v_n - v_desc = 1 then
    v_metodo := 'poco_dato';
    v_coste  := v_amt / v_qty;
  else
    select gr.code, gr.receipt_date, grl.doc_amount / grl.qty_in_base as eur
      into v_last
      from goods_receipt_line grl
      join goods_receipt gr
        on gr.id = grl.goods_receipt_id and gr.account_id = v_item.account_id
     where grl.recipe_item_id = p_item_id
       and grl.account_id     = v_item.account_id
       and gr.status in ('recibido', 'confirmado')
       and not grl.not_goods
       and grl.qty_in_base > 0
       and grl.doc_amount > 0
       and exists (select 1 from stock_movement sm
                    where sm.source_type = 'goods_receipt_line'
                      and sm.source_id   = grl.id
                      and sm.movement_type = 'recepcion')
     order by gr.receipt_date desc, grl.created_at desc
     limit 1;
    if found then
      v_metodo := 'ultima_conocida';
      v_coste  := v_last.eur;
      v_ultima := jsonb_build_object('albaran', v_last.code, 'fecha', v_last.receipt_date,
                                     'eur_unidad', v_last.eur);
    else
      v_metodo := 'sin_compras';
      v_coste  := null;
    end if;
  end if;

  return jsonb_build_object(
    'recipe_item_id',  p_item_id,
    'ventana_dias',    v_days,
    'desde',           v_desde,
    'metodo',          v_metodo,
    'coste',           v_coste,
    'lineas_ventana',  v_n,
    'descartadas',     v_desc,
    'pct_descartadas', case when v_n > 0 then round(100.0 * v_desc / v_n, 1) else 0 end,
    'cantidad',        v_qty,
    'importe',         v_amt,
    'mediana',         v_med,
    'ultima_compra',   v_ultima,
    'lineas',          v_lineas);
end;
$function$;

revoke all on function public._article_weighted_cost(uuid) from public, anon, authenticated;

-- La ventana de 90 días ANTES de clasificar: hoy vale 30 en las tres cuentas,
-- y el paso 2 mide con esta misma función. Clasificar con 30 y encender con 90
-- sería medir el antes y el después con dos varas (regla 31).
-- 'last_purchase' ya es válido con el CHECK viejo de kitchen_settings.
update public.kitchen_settings
   set cost_strategy_default    = 'last_purchase',
       cost_window_days_default = 90,
       updated_at               = now();

-- ─── 2 · LA MEMORIA: QUIÉN ESTABA MARCADO Y EN QUÉ GRUPO CAE ──────────────
-- Sin esta tabla, el paso 3 borraría la única huella de que estos artículos
-- se quisieron a media. Se escribe una vez aquí; después solo la tocan
-- approve_average_cost y encender_coste_medio_quietos.
create table public.recipe_item_cost_rollout (
  recipe_item_id     uuid primary key references public.recipe_item(id) on delete cascade,
  account_id         uuid not null references public.accounts(id) on delete cascade,
  estrategia_marcada text not null,
  grupo              text not null check (grupo in
                       ('quieto', 'se_mueve', 'imposible', 'sin_compras',
                        'plantilla', 'archivado', 'ventana_retirada')),
  coste_antes        numeric,
  coste_media        numeric,
  metodo_media       text,
  pct_cambio         numeric,
  lineas             integer,
  descartadas        integer,
  pct_descartadas    numeric,
  medido_at          timestamptz not null default now(),
  estado             text not null default 'pendiente'
                       check (estado in ('pendiente', 'encendido', 'no_aplica')),
  decidido_at        timestamptz,
  decidido_by        uuid,
  decidido_by_name   text
);
create index recipe_item_cost_rollout_account on public.recipe_item_cost_rollout (account_id, estado);

alter table public.recipe_item_cost_rollout enable row level security;
create policy recipe_item_cost_rollout_select on public.recipe_item_cost_rollout
  for select using (public.belongs_to_account(account_id));

comment on table public.recipe_item_cost_rollout is
  'Artículos que el 27/09/2026 estaban marcados average_weighted/average_window y '
  'calculaban last_purchase. Guarda el grupo medido con _article_weighted_cost y '
  'si Julio los ha encendido. Se escribe solo desde approve_average_cost.';

-- Los dos «imposibles» van por id (regla 9: por nombre hay homónimos en la
-- plantilla). No huelen a ALB-00103, como decía el encargo: son formatos
-- pequeños casados a compras grandes. Ver el parte.
--   675ab77c-5787-41e4-96c4-8fc298ee3a5e  Servilletas 30 x 40
--       ALB-00056 y ALB-00084: «CAJA DE 4500 UNIDADES» casada al formato
--       Paquete (150 ud) → 150 ud en vez de 4.500. Son 2 de las 3 líneas de la
--       ventana, así que el guardia descarta la BUENA (ALB-00105, 0,0092 €/ud).
--   cb5c716f-5908-458a-9925-915d95f27a8d  Aceite de Oliva Suave 0,4º
--       ALB-00045: «GARRAFA 5 LT» casada al formato Botella 250 ml (archivado)
--       → 250 ml en vez de 5.000. Única línea de la ventana.
insert into public.recipe_item_cost_rollout (
  recipe_item_id, account_id, estrategia_marcada, grupo,
  coste_antes, coste_media, metodo_media, pct_cambio,
  lineas, descartadas, pct_descartadas, estado)
select ri.id, ri.account_id, ri.cost_strategy, g.grupo,
       ri.computed_cost, (b->>'coste')::numeric, b->>'metodo',
       case when ri.computed_cost > 0 and b->>'coste' is not null
            then round(100 * ((b->>'coste')::numeric / ri.computed_cost - 1), 3) end,
       (b->>'lineas_ventana')::int, (b->>'descartadas')::int, (b->>'pct_descartadas')::numeric,
       case when g.grupo in ('plantilla', 'archivado', 'ventana_retirada')
            then 'no_aplica' else 'pendiente' end
  from public.recipe_item ri
  cross join lateral (select public._article_weighted_cost(ri.id) as b) x
  cross join lateral (select case
      when ri.cost_strategy = 'average_window'                          then 'ventana_retirada'
      when ri.account_id = '00000000-0000-0000-0000-000000000001'       then 'plantilla'
      when not ri.is_active or ri.archived_at is not null               then 'archivado'
      when ri.id in ('675ab77c-5787-41e4-96c4-8fc298ee3a5e',
                     'cb5c716f-5908-458a-9925-915d95f27a8d')             then 'imposible'
      when b->>'metodo' in ('ultima_conocida', 'sin_compras')           then 'sin_compras'
      when ri.computed_cost > 0
       and abs((b->>'coste')::numeric / ri.computed_cost - 1) < 0.000001 then 'quieto'
      else 'se_mueve' end as grupo) g
 where ri.cost_strategy in ('average_weighted', 'average_window')
   and ri.type in ('raw', 'tool', 'packaging');

-- ─── 3 · LA BANDERA DICE LO QUE CALCULA ───────────────────────────────────
-- Neutro en coste: last_purchase es exactamente la rama por la que ya pasaban.
update public.recipe_item
   set cost_strategy = 'last_purchase'
 where cost_strategy in ('average_weighted', 'average_window');

-- ─── 4 · UNA VENTANA, UN SITIO; 'average_window' FUERA ────────────────────
alter table public.recipe_item drop constraint recipe_item_cost_strategy_valid;
alter table public.recipe_item add constraint recipe_item_cost_strategy_valid
  check (cost_strategy = any (array['fixed', 'last_purchase', 'average_weighted']));

alter table public.kitchen_settings drop constraint kitchen_settings_cost_strategy_default_check;
alter table public.kitchen_settings add constraint kitchen_settings_cost_strategy_default_check
  check (cost_strategy_default = any (array['average_weighted', 'last_purchase', 'fixed']));
alter table public.kitchen_settings add constraint kitchen_settings_cost_window_days_default_range
  check (cost_window_days_default between 7 and 365);

comment on column public.kitchen_settings.cost_window_days_default is
  'Días de compras que entran en el coste medio ponderado (average_weighted). '
  'LA ventana de la cuenta: la lee _article_weighted_cost y nadie más.';

update public.recipe_item set cost_window_days = null where cost_window_days is not null;
comment on column public.recipe_item.cost_window_days is
  'RETIRADO el 27/09/2026. No lo lee ninguna función de coste. La ventana es '
  'kitchen_settings.cost_window_days_default. Pendiente de borrar la columna.';

-- ─── 5a · EL MOTOR ─────────────────────────────────────────────────────────
-- Misma firma que antes (uuid → numeric): CREATE OR REPLACE no crea sobrecarga
-- (regla 2 del CLAUDE.md). El guardia de cuenta se queda en la pública; la
-- pasada nocturna y los disparadores usan la interna, que no depende de
-- auth.uid() (a las 04:00 no hay usuario y belongs_to_account daría false).
create or replace function public._kitchen_recompute_raw_cost_unguarded(p_item_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item   recipe_item%rowtype;
  v_link   article_supplier%rowtype;
  v_cost   numeric;
  v_basis  jsonb;
  v_metodo text;
  v_sello  jsonb;
begin
  select * into v_item from recipe_item where id = p_item_id;
  if not found then
    raise exception 'kitchen_recompute_raw_cost: item % no existe', p_item_id;
  end if;
  if v_item.type not in ('raw', 'tool', 'packaging') then
    return coalesce(v_item.computed_cost, 0);
  end if;

  if v_item.cost_strategy = 'fixed' then
    v_cost := coalesce(v_item.fixed_cost, 0);
    update recipe_item
       set computed_cost = v_cost, cost_updated_at = now(),
           completeness  = case when completeness ? 'cost_basis'
                                then completeness - 'cost_basis' else completeness end
     where id = p_item_id;
    return v_cost;
  end if;

  -- MEDIA PONDERADA de lo comprado. Ver _article_weighted_cost.
  if v_item.cost_strategy = 'average_weighted' then
    v_basis  := public._article_weighted_cost(p_item_id);
    v_metodo := v_basis->>'metodo';
    v_cost   := (v_basis->>'coste')::numeric;
    -- El sello NO lleva la fecha de corte: si lo llevara cambiaría cada noche
    -- y la fila se reescribiría (y su updated_at) sin que cambie nada.
    v_sello  := jsonb_build_object(
                  'metodo',          v_metodo,
                  'ventana_dias',    v_basis->'ventana_dias',
                  'lineas',          v_basis->'lineas_ventana',
                  'descartadas',     v_basis->'descartadas',
                  'pct_descartadas', v_basis->'pct_descartadas',
                  'cantidad',        v_basis->'cantidad',
                  'importe',         v_basis->'importe',
                  'ultima_compra',   v_basis->'ultima_compra');
    -- Sin compras en la ventana: coste de la última compra conocida (o el que
    -- ya tenía, si nunca se compró) y needs_review. Nunca 0, nunca NULL callado.
    update recipe_item
       set computed_cost   = coalesce(v_cost, computed_cost),
           needs_review    = case when v_metodo in ('ultima_conocida', 'sin_compras')
                                  then true else needs_review end,
           completeness    = coalesce(completeness, '{}'::jsonb)
                             || jsonb_build_object('cost_basis', v_sello),
           cost_updated_at = now()
     where id = p_item_id
       and (   computed_cost is distinct from coalesce(v_cost, computed_cost)
            or completeness->'cost_basis' is distinct from v_sello
            or (v_metodo in ('ultima_conocida', 'sin_compras') and not needs_review));
    return coalesce(v_cost, v_item.computed_cost, v_item.fixed_cost, 0);
  end if;

  -- 'last_purchase': el último precio del proveedor con estrella. Igual que antes.
  select a.* into v_link from article_supplier a
   where a.recipe_item_id = p_item_id and a.is_active and a.last_price is not null
   order by a.is_preferred desc, a.updated_at desc limit 1;
  if found then
    v_cost := v_link.last_price;             -- last_price ES €/base
    update recipe_item
       set computed_cost = v_cost, cost_updated_at = now(),
           completeness  = case when completeness ? 'cost_basis'
                                then completeness - 'cost_basis' else completeness end
     where id = p_item_id;
    return v_cost;
  end if;
  -- Sin precio utilizable: no inventamos, marcamos y conservamos el anterior.
  update recipe_item set needs_review = true, cost_updated_at = now() where id = p_item_id;
  return coalesce(v_item.computed_cost, v_item.fixed_cost, 0);
end;
$function$;

revoke all on function public._kitchen_recompute_raw_cost_unguarded(uuid) from public, anon, authenticated;

create or replace function public.kitchen_recompute_raw_cost(p_item_id uuid)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_account uuid;
begin
  select account_id into v_account from recipe_item where id = p_item_id;
  if not found then
    raise exception 'kitchen_recompute_raw_cost: item % no existe', p_item_id;
  end if;
  if not public.belongs_to_account(v_account) then
    raise exception 'kitchen_recompute_raw_cost: sin acceso al item %', p_item_id;
  end if;
  return public._kitchen_recompute_raw_cost_unguarded(p_item_id);
end;
$function$;

-- ─── 5b · LA PUERTA DEL ALBARÁN ───────────────────────────────────────────
-- El disparador de article_supplier ya recalcula al recibir, pero solo si hay
-- un article_supplier con ESE formato. Y cuando salta, el albarán aún está en
-- 'borrador' (receive_goods_receipt cambia el estado DESPUÉS de postear), así
-- que la línea nueva todavía no cuenta. Estos dos cubren lo que falta: el
-- cambio de estado (recibido, confirmado, anulado) y la corrección de una
-- línea ya recibida. Solo recalculan artículos a media; el resto, como antes.
create or replace function public.tg_goods_receipt_recompute_average()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item uuid;
begin
  if tg_table_name = 'goods_receipt' then
    for v_item in
      select distinct grl.recipe_item_id
        from goods_receipt_line grl
        join recipe_item ri on ri.id = grl.recipe_item_id and ri.account_id = new.account_id
       where grl.goods_receipt_id = new.id
         and ri.cost_strategy = 'average_weighted'
    loop
      perform public._kitchen_recompute_raw_cost_unguarded(v_item);
    end loop;
  else
    if not exists (select 1 from goods_receipt gr
                    where gr.id = new.goods_receipt_id
                      and gr.status in ('recibido', 'confirmado')) then
      return null;
    end if;
    for v_item in
      select ri.id from recipe_item ri
       where ri.id in (new.recipe_item_id, old.recipe_item_id)
         and ri.account_id = new.account_id
         and ri.cost_strategy = 'average_weighted'
    loop
      perform public._kitchen_recompute_raw_cost_unguarded(v_item);
    end loop;
  end if;
  return null;
end;
$function$;

create trigger trg_goods_receipt_recompute_average
  after update of status on public.goods_receipt
  for each row when (old.status is distinct from new.status)
  execute function public.tg_goods_receipt_recompute_average();

create trigger trg_goods_receipt_line_recompute_average
  after update of qty_in_base, doc_amount, recipe_item_id, not_goods on public.goods_receipt_line
  for each row when (   old.qty_in_base    is distinct from new.qty_in_base
                     or old.doc_amount     is distinct from new.doc_amount
                     or old.recipe_item_id is distinct from new.recipe_item_id
                     or old.not_goods      is distinct from new.not_goods)
  execute function public.tg_goods_receipt_recompute_average();

-- ─── 5c · LA PASADA NOCTURNA ──────────────────────────────────────────────
-- Una ventana móvil caduca sola: una compra sale de los 90 días y el coste
-- cambia sin que entre ningún albarán. Esto corre ANTES de recostear platos,
-- dentro del mismo cron de las 04:00, para que los platos lean el coste nuevo.
--
-- Avisa (y solo aquí se filtra, regla 7): los artículos cuyo guardia descarta
-- más del 20 % de las líneas, con sus albaranes. La lista entera, sin umbral,
-- la da article_cost_review. Un fallo tampoco se queda en un raise warning que
-- pg_cron cuenta como éxito (regla 8): va a la cola de avisos.
create or replace function public._cost_average_nightly(p_account_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row      record;
  v_antes    numeric;
  v_despues  numeric;
  v_basis    jsonb;
  v_n        integer := 0;
  v_cambios  jsonb := '[]'::jsonb;
  v_avisos   jsonb := '[]'::jsonb;
  v_fallos   jsonb := '[]'::jsonb;
  v_msg      text;
begin
  for v_row in
    select ri.id, ri.name, ri.computed_cost
      from recipe_item ri
     where ri.account_id = p_account_id
       and ri.cost_strategy = 'average_weighted'
       and ri.type in ('raw', 'tool', 'packaging')
       and ri.is_active and ri.archived_at is null
     order by ri.name
  loop
    begin
      v_antes := v_row.computed_cost;
      perform public._kitchen_recompute_raw_cost_unguarded(v_row.id);
      select computed_cost into v_despues from recipe_item where id = v_row.id;
      v_n := v_n + 1;
      if v_despues is distinct from v_antes then
        v_cambios := v_cambios || jsonb_build_object('nombre', v_row.name,
                       'antes', v_antes, 'despues', v_despues);
      end if;
      v_basis := public._article_weighted_cost(v_row.id);
      if (v_basis->>'pct_descartadas')::numeric > 20 then
        v_avisos := v_avisos || jsonb_build_object(
          'nombre', v_row.name,
          'lineas', v_basis->'lineas_ventana',
          'descartadas', v_basis->'descartadas',
          'albaranes', (select jsonb_agg(distinct l->>'albaran')
                          from jsonb_array_elements(v_basis->'lineas') l
                         where not (l->>'entra')::boolean));
      end if;
    exception when others then
      v_fallos := v_fallos || jsonb_build_object('nombre', v_row.name,
                    'error', sqlerrm, 'sqlstate', sqlstate);
    end;
  end loop;

  if jsonb_array_length(v_avisos) > 0 then
    select string_agg(format('%s: %s de %s líneas fuera de la media (%s)',
             a->>'nombre', a->>'descartadas', a->>'lineas',
             (select string_agg(x, ', ' order by x) from jsonb_array_elements_text(a->'albaranes') x)),
             E'\n' order by a->>'nombre')
      into v_msg from jsonb_array_elements(v_avisos) a;
    perform public.encolar_alerta(
      p_kind            => 'coste_medio_descartes',
      p_subject         => format('Coste medio: %s artículo(s) descartan más del 20 %% de sus compras',
                                  jsonb_array_length(v_avisos)),
      p_message         => 'El guardia deja fuera de la media las líneas que se salen más de 3× '
                           || 'de la mediana del artículo. Cuando son tantas, no es un dato raro: '
                           || 'es que el artículo se recibe con formatos distintos. Revisar el '
                           || 'casado del formato en estos albaranes:' || E'\n\n' || v_msg,
      p_debounce_kind   => 'coste_medio_descartes:' || p_account_id,
      p_debounce_window => interval '20 hours',
      p_account_id      => p_account_id,
      p_severity        => 'aviso');
  end if;

  if jsonb_array_length(v_fallos) > 0 then
    perform public.encolar_alerta(
      p_kind            => 'coste_medio_fallo',
      p_subject         => format('Coste medio: %s artículo(s) no se pudieron recalcular',
                                  jsonb_array_length(v_fallos)),
      p_message         => (select string_agg(f->>'nombre' || ': ' || (f->>'error'), E'\n')
                              from jsonb_array_elements(v_fallos) f),
      p_debounce_kind   => 'coste_medio_fallo:' || p_account_id,
      p_debounce_window => interval '20 hours',
      p_account_id      => p_account_id,
      p_severity        => 'alto');
  end if;

  return jsonb_build_object(
    'recalculados', v_n,
    'cambiados',    jsonb_array_length(v_cambios),
    'cambios',      v_cambios,
    'avisos',       jsonb_array_length(v_avisos),
    'fallos',       v_fallos);
end;
$function$;

revoke all on function public._cost_average_nightly(uuid) from public, anon, authenticated;

create or replace function public.cron_kitchen_recompute_all()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_acc      record;
  v_res      jsonb;
  v_media    jsonb;
  v_out      jsonb := '[]'::jsonb;
  v_started  timestamptz := clock_timestamp();
begin
  for v_acc in
    select a.id, a.name from accounts a
     where a.status = 'active'
       and a.suspended_at is null
       and a.archived_at  is null
       and a.deleted_at   is null
     order by a.name
  loop
    -- (27/09) Primero las materias primas a media (la ventana caduca sola),
    -- después recetas y platos, que leen ese coste.
    begin
      v_media := public._cost_average_nightly(v_acc.id);
    exception when others then
      v_media := jsonb_build_object('fatal', sqlerrm);
      perform public.encolar_alerta(
        p_kind => 'coste_medio_fallo',
        p_subject => format('Coste medio: la pasada nocturna abortó en %s', v_acc.name),
        p_message => sqlerrm,
        p_debounce_kind => 'coste_medio_fatal:' || v_acc.id,
        p_debounce_window => interval '20 hours',
        p_account_id => v_acc.id,
        p_severity => 'alto');
    end;
    begin
      v_res := public.kitchen_recompute_all(v_acc.id);
    exception when others then
      v_res := jsonb_build_object('account_id', v_acc.id, 'fatal', sqlerrm);
      raise warning 'cron_kitchen_recompute_all: cuenta % (%) abortada: %', v_acc.name, v_acc.id, sqlerrm;
    end;
    v_out := v_out || (jsonb_build_object('account', v_acc.name, 'coste_medio', v_media) || v_res);
  end loop;

  return jsonb_build_object(
    'ran_at',      v_started,
    'duration_ms', round(extract(epoch from clock_timestamp() - v_started) * 1000),
    'accounts',    v_out);
end;
$function$;

-- ─── 5d · LA FICHA: DE DÓNDE SALE ─────────────────────────────────────────
-- Para cualquier materia prima, esté o no a media: lo que daría la media, con
-- las líneas que la componen y las que se quedan fuera, y cómo está hoy.
create or replace function public.article_cost_breakdown(p_item_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_item recipe_item%rowtype;
  v_roll recipe_item_cost_rollout%rowtype;
begin
  select * into v_item from recipe_item where id = p_item_id;
  if not found then
    raise exception 'article_cost_breakdown: item % no existe', p_item_id;
  end if;
  if not public.belongs_to_account(v_item.account_id) then
    raise exception 'article_cost_breakdown: sin acceso al item %', p_item_id;
  end if;
  select * into v_roll from recipe_item_cost_rollout where recipe_item_id = p_item_id;
  return public._article_weighted_cost(p_item_id) || jsonb_build_object(
    'estrategia',   v_item.cost_strategy,
    'coste_actual', v_item.computed_cost,
    'rollout', case when v_roll.recipe_item_id is null then null else jsonb_build_object(
                 'grupo', v_roll.grupo, 'estado', v_roll.estado,
                 'coste_antes', v_roll.coste_antes, 'coste_media', v_roll.coste_media,
                 'pct_cambio', v_roll.pct_cambio, 'medido_at', v_roll.medido_at,
                 'decidido_at', v_roll.decidido_at, 'decidido_by_name', v_roll.decidido_by_name)
               end);
end;
$function$;

-- ─── 6 · ENCENDER ES UN ACTO CON NOMBRE ───────────────────────────────────
-- Uno a uno. Devuelve el antes y el después (regla 8: la confirmación lleva
-- contenido). p_solo_si_no_cambia = true no enciende si el coste se movería;
-- lo dice y deja el artículo como estaba.
create or replace function public.approve_average_cost(
  p_item_id uuid, p_solo_si_no_cambia boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item     recipe_item%rowtype;
  v_basis    jsonb;
  v_media    numeric;
  v_despues  numeric;
  v_user     uuid := auth.uid();
  v_name     text;
begin
  select * into v_item from recipe_item where id = p_item_id for update;
  if not found then
    raise exception 'approve_average_cost: item % no existe', p_item_id;
  end if;
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_item.account_id)) then
    raise exception 'approve_average_cost: sin permiso sobre el item %', p_item_id;
  end if;
  if v_item.type not in ('raw', 'tool', 'packaging') then
    raise exception 'approve_average_cost: % no es una materia prima (es %)', v_item.name, v_item.type;
  end if;
  if v_item.cost_strategy = 'average_weighted' then
    return jsonb_build_object('encendido', false, 'nombre', v_item.name,
      'motivo', 'ya estaba a media ponderada', 'coste', v_item.computed_cost);
  end if;

  v_basis := public._article_weighted_cost(p_item_id);
  v_media := (v_basis->>'coste')::numeric;

  -- coalesce: con computed_cost NULL la comparación da NULL, y NOT NULL no es
  -- true — sin él, un artículo sin coste pasaría la guarda y se encendería.
  if p_solo_si_no_cambia and not coalesce(
       v_basis->>'metodo' in ('media', 'poco_dato')
       and v_item.computed_cost > 0
       and abs(v_media / v_item.computed_cost - 1) < 0.000001, false) then
    return jsonb_build_object('encendido', false, 'nombre', v_item.name,
      'motivo', 'el coste se movería', 'antes', v_item.computed_cost,
      'con_media', v_media, 'metodo', v_basis->>'metodo');
  end if;

  update recipe_item set cost_strategy = 'average_weighted' where id = p_item_id;
  v_despues := public._kitchen_recompute_raw_cost_unguarded(p_item_id);

  select display_name into v_name from user_profiles where id = v_user;
  update recipe_item_cost_rollout
     set estado = 'encendido', decidido_at = now(),
         decidido_by = v_user, decidido_by_name = v_name
   where recipe_item_id = p_item_id;

  return jsonb_build_object(
    'encendido',       true,
    'nombre',          v_item.name,
    'antes',           v_item.computed_cost,
    'despues',         v_despues,
    'metodo',          v_basis->>'metodo',
    'lineas',          v_basis->'lineas_ventana',
    'descartadas',     v_basis->'descartadas',
    'pct_descartadas', v_basis->'pct_descartadas',
    'aviso_descartes', (v_basis->>'pct_descartadas')::numeric > 20);
end;
$function$;

-- Los que no se mueven ni un céntimo (grupo 'quieto', medido al migrar), de
-- una vez. Cada uno se vuelve a medir al encender: si entre la migración y
-- ahora ha entrado un albarán que lo mueve, NO se enciende y sale dicho.
create or replace function public.encender_coste_medio_quietos(p_account_id uuid)
returns table(nombre text, encendido boolean, antes numeric, despues numeric,
              lineas integer, descartadas integer, motivo text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_r   record;
  v_res jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'encender_coste_medio_quietos: sin permiso sobre la cuenta %', p_account_id;
  end if;
  for v_r in
    select r.recipe_item_id from recipe_item_cost_rollout r
      join recipe_item ri on ri.id = r.recipe_item_id
     where r.account_id = p_account_id and r.grupo = 'quieto' and r.estado = 'pendiente'
     order by ri.name
  loop
    v_res := public.approve_average_cost(v_r.recipe_item_id, true);
    nombre      := v_res->>'nombre';
    encendido   := (v_res->>'encendido')::boolean;
    antes       := (v_res->>'antes')::numeric;
    despues     := coalesce((v_res->>'despues')::numeric, (v_res->>'con_media')::numeric);
    lineas      := (v_res->>'lineas')::integer;
    descartadas := (v_res->>'descartadas')::integer;
    motivo      := v_res->>'motivo';
    return next;
  end loop;
end;
$function$;

-- ─── 5e · LA LISTA DE REVISIÓN ────────────────────────────────────────────
-- TODOS los artículos a media o pendientes de encender que dejan alguna línea
-- fuera, ordenados por el porcentaje. Sin umbral: esto se abre a propósito
-- (regla 7). El 20 % solo decide qué interrumpe (el aviso nocturno).
create or replace function public.article_cost_review(p_account_id uuid)
returns table(recipe_item_id uuid, nombre text, estrategia text, estado_rollout text,
              grupo text, lineas integer, descartadas integer, pct_descartadas numeric,
              albaranes_fuera text[])
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not public.belongs_to_account(p_account_id) then
    raise exception 'article_cost_review: sin acceso a la cuenta %', p_account_id;
  end if;
  return query
  select ri.id, ri.name, ri.cost_strategy, r.estado, r.grupo,
         (b->>'lineas_ventana')::int, (b->>'descartadas')::int,
         (b->>'pct_descartadas')::numeric,
         array(select distinct l->>'albaran' from jsonb_array_elements(b->'lineas') l
                where not (l->>'entra')::boolean order by 1)
    from recipe_item ri
    left join recipe_item_cost_rollout r on r.recipe_item_id = ri.id
    cross join lateral (select public._article_weighted_cost(ri.id) as b) x
   where ri.account_id = p_account_id
     and ri.type in ('raw', 'tool', 'packaging')
     and ri.is_active and ri.archived_at is null
     and (ri.cost_strategy = 'average_weighted' or r.estado = 'pendiente')
     and (b->>'descartadas')::int > 0
   order by (b->>'pct_descartadas')::numeric desc, ri.name;
end;
$function$;

-- ─── 4b · EL ALTA DE CUENTA NUEVA ─────────────────────────────────────────
-- Sin esto, retirar 'average_window' del CHECK rompe onboard_account: siembra
-- SIEMPRE 'average_window'. Cambian tres cosas y nada más: el valor por
-- defecto que escribe en kitchen_settings ('last_purchase', 90 días) y el
-- CASE, que ya no traduce a un valor que no existe. Qué estrategia deben
-- llevar las cuentas nuevas es una decisión aparte: hoy, last_purchase es lo
-- que calculaban de verdad.
create or replace function public.onboard_account(p_account_id uuid, p_plan_code text default 'professional'::text, p_admin_user_id uuid default null::uuid, p_status text default 'trial'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
DECLARE
  v_plan         billing_plans%ROWTYPE;
  v_status       text;
  v_sub_id       uuid;
  v_loc_id       uuid;
  v_unit_weight  uuid;
  v_unit_volume  uuid;
  v_unit_unit    uuid;
  v_sm           uuid;
  v_tpl          record;
  v_item_id      uuid;
  v_base_unit    uuid;
  v_fam_id       uuid;
  v_n_items      integer := 0;
  v_n_alg        integer := 0;
  v_alg_rows     integer := 0;
  v_n_dish_fam   integer := 0;
  v_n_chan       integer := 0;
  v_result       jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM accounts WHERE id = p_account_id) THEN
    RAISE EXCEPTION 'Cuenta % no existe', p_account_id;
  END IF;
  v_status := CASE WHEN p_status IN ('active','trial') THEN p_status ELSE 'trial' END;

  -- Unidades base GLOBALES por dimensión (account_id IS NULL).
  SELECT id INTO v_unit_weight FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='weight' LIMIT 1;
  SELECT id INTO v_unit_volume FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='volume' LIMIT 1;
  SELECT id INTO v_unit_unit   FROM kitchen_unit WHERE account_id IS NULL AND is_base AND dimension='unit'   LIMIT 1;
  IF v_unit_weight IS NULL OR v_unit_volume IS NULL OR v_unit_unit IS NULL THEN
    RAISE EXCEPTION 'Faltan unidades base globales (weight/volume/unit)';
  END IF;

  -- ── 1) SUSCRIPCIÓN (con estado comercial; idempotente) ──────────────────────
  SELECT * INTO v_plan FROM billing_plans WHERE code = p_plan_code;
  IF v_plan.id IS NULL THEN RAISE EXCEPTION 'Plan % no existe', p_plan_code; END IF;

  SELECT id INTO v_sub_id FROM subscriptions WHERE account_id = p_account_id LIMIT 1;
  IF v_sub_id IS NULL THEN
    INSERT INTO subscriptions (account_id, plan_id, status, billing_cycle,
                               trial_ends_at, current_period_start, current_period_end)
    VALUES (p_account_id, v_plan.id, v_status, COALESCE(v_plan.billing_cycle,'monthly'),
            CASE WHEN v_status='trial'
                 THEN now() + (COALESCE(v_plan.trial_days,14)||' days')::interval
                 ELSE NULL END,
            now(), now() + interval '1 month')
    RETURNING id INTO v_sub_id;

    FOREACH v_sm IN ARRAY COALESCE(v_plan.included_submodules, '{}'::uuid[])
    LOOP
      INSERT INTO subscription_items (subscription_id, submodule_id, status, starts_at)
      VALUES (v_sub_id, v_sm, 'active', now())
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- ── 2) LOCATION POR DEFECTO (su trigger siembra estaciones de cocina) ───────
  SELECT id INTO v_loc_id FROM locations WHERE account_id = p_account_id LIMIT 1;
  IF v_loc_id IS NULL THEN
    INSERT INTO locations (account_id, name, active, is_billable, clock_geofence_mode, clock_radius_m)
    VALUES (p_account_id, 'Principal', true, true, 'warn', 200)
    RETURNING id INTO v_loc_id;
  END IF;

  -- ── 3) KITCHEN_SETTINGS ─────────────────────────────────────────────────────
  -- (27/09) 'last_purchase' y 90 días: 'avg_window' ya no existe.
  IF NOT EXISTS (SELECT 1 FROM kitchen_settings WHERE account_id = p_account_id) THEN
    INSERT INTO kitchen_settings (
      account_id, currency, cost_strategy_default, cost_window_days_default,
      indirect_cost_pct_default, allow_negative_yield, price_rounding,
      ai_default_model, ai_escalation_enabled, transcription_language,
      audit_mode_default, audit_threshold_default, audit_shadow_min_samples,
      reliability_min_pct, max_recipe_depth_warning, version_alert_pct, photo_retention_days
    ) VALUES (
      p_account_id, 'EUR', 'last_purchase', 90,
      0, false, 'none',
      'claude-sonnet-4-6', true, 'es',
      'shadow', 0.15, 5,
      70, 6, 20, 365
    );
  END IF;

  -- ── 4) STORAGE_AREA por defecto ─────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM storage_area WHERE account_id = p_account_id) THEN
    INSERT INTO storage_area (account_id, location_id, name, position, active)
    VALUES (p_account_id, v_loc_id, 'Almacén principal', 0, true);
  END IF;

  -- ── 5) SALES_CHANNEL (Salón + plataformas + tienda) ─────────────────────────
  INSERT INTO sales_channel (account_id, name, slug, channel_type, is_active)
  SELECT p_account_id, x.name, x.slug, x.channel_type, true
  FROM (VALUES
    ('Salón',   'salon',   'dine_in'),
    ('Glovo',   'glovo',   'delivery'),
    ('JustEat', 'justeat', 'delivery'),
    ('Uber',    'uber',    'delivery'),
    ('Shop',    'shop',    'takeaway')
  ) AS x(name, slug, channel_type)
  WHERE NOT EXISTS (
    SELECT 1 FROM sales_channel sc WHERE sc.account_id = p_account_id AND sc.slug = x.slug
  );
  GET DIAGNOSTICS v_n_chan = ROW_COUNT;

  -- ── 6) FAMILIAS DE PLATO desde dish_family_template ─────────────────────────
  INSERT INTO recipe_family (account_id, scope, code, name, icon, position, template_id, is_active)
  SELECT p_account_id, 'dish', dft.code, dft.name_es, dft.icon, dft.position, dft.id, true
  FROM dish_family_template dft
  WHERE NOT EXISTS (
    SELECT 1 FROM recipe_family rf
    WHERE rf.account_id = p_account_id AND rf.scope = 'dish' AND rf.code = dft.code
  );
  GET DIAGNOSTICS v_n_dish_fam = ROW_COUNT;

  -- ── 7) SIEMBRA DEL MASTER (ingredient_template -> recipe_item type='raw') ────
  FOR v_tpl IN SELECT * FROM ingredient_template WHERE is_active LOOP
    IF EXISTS (
      SELECT 1 FROM recipe_item ri
      WHERE ri.account_id = p_account_id AND ri.template_code = v_tpl.code
    ) THEN CONTINUE; END IF;

    v_base_unit := CASE lower(COALESCE(v_tpl.default_base_dimension,'weight'))
                     WHEN 'volume' THEN v_unit_volume
                     WHEN 'unit'   THEN v_unit_unit
                     ELSE v_unit_weight
                   END;

    v_fam_id := NULL;
    IF nullif(v_tpl.family_code,'') IS NOT NULL THEN
      SELECT rf.id INTO v_fam_id FROM recipe_family rf
      WHERE rf.account_id = p_account_id AND rf.scope = 'ingredient' AND rf.code = v_tpl.family_code
      LIMIT 1;
    END IF;

    INSERT INTO recipe_item (
      account_id, name, type, source, base_unit_id, family_id,
      template_code, template_version,
      kitchen_photo_url, conservation_type, default_waste_pct,
      shelf_life_days, nutrition, cost_strategy, is_active,
      is_purchasable, is_stockable, is_sellable, needs_review
    ) VALUES (
      p_account_id, COALESCE(v_tpl.name_es, v_tpl.name_en, 'Ingrediente'), 'raw', 'template_global',
      v_base_unit, v_fam_id,
      v_tpl.code, v_tpl.version,
      v_tpl.photo_url, v_tpl.conservation_type, v_tpl.default_waste_pct,
      v_tpl.shelf_life_days, v_tpl.nutrition,
      -- (27/09) kitchen_settings y recipe_item hablan ya el mismo idioma.
      CASE (SELECT cost_strategy_default FROM kitchen_settings WHERE account_id = p_account_id)
        WHEN 'average_weighted' THEN 'average_weighted'
        WHEN 'fixed'            THEN 'fixed'
        ELSE 'last_purchase'
      END,
      true, true, true, false, false
    ) RETURNING id INTO v_item_id;
    v_n_items := v_n_items + 1;

    -- ── 8) ALÉRGENOS heredados del master ─────────────────────────────────────
    INSERT INTO recipe_item_allergen (recipe_item_id, allergen_code, state, source)
    SELECT v_item_id, ita.allergen_code, ita.state, 'inherited'
    FROM ingredient_template_allergen ita
    WHERE ita.template_id = v_tpl.id
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_alg_rows = ROW_COUNT;
    v_n_alg := v_n_alg + v_alg_rows;
  END LOOP;

  -- ── 9) USUARIO ADMIN (idempotente; create_account_tx ya pudo crearlo) ───────
  IF p_admin_user_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM user_profiles WHERE account_id = p_account_id AND user_id = p_admin_user_id
    ) THEN
      INSERT INTO user_profiles (account_id, user_id, role, active)
      VALUES (p_account_id, p_admin_user_id, 'admin', true);
    END IF;
  END IF;

  v_result := jsonb_build_object(
    'account_id', p_account_id, 'plan', p_plan_code, 'status', v_status,
    'subscription_id', v_sub_id, 'location_id', v_loc_id,
    'channels_seeded', v_n_chan, 'dish_families_seeded', v_n_dish_fam,
    'ingredients_seeded', v_n_items, 'allergens_seeded', v_n_alg,
    'admin_linked', (p_admin_user_id IS NOT NULL)
  );
  RETURN v_result;
END;
$function$;

commit;
