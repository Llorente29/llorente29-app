-- ═══════════════════════════════════════════════════════════════════════════
-- EL ENVASE QUE VIENE DE DOS FORMAS, Y EL ENVASE DEL MENÚ
-- Encargo de Julio del 28/09 · parte: claude/folvy_parte_envase_equivalente_20260928.md
--
-- ESTADO: PROPUESTA, SIN APLICAR. Termina en ROLLBACK a propósito.
--   Se pasa primero así, se leen las comprobaciones del final, y solo entonces
--   se cambia la última línea por COMMIT.
--
-- BANDA: toca `_sale_line_raw_consumption` (lo llama `generate_sale_consumption`
-- en CADA cierre de venta) y hace ALTER TABLE sobre `menu_item`, que el pedido
-- lee siempre. Falla las condiciones 1 y 2 de la banda: solo entre 00:30 y
-- 12:15 de Madrid. La guarda G0 aborta sola fuera de esa ventana.
--
-- QUÉ HACE
--   Parte 1 · grupo de equivalencia.
--     · Tabla `recipe_item_equivalente`: un artículo GRUPO con miembros ordenados.
--     · `explode_recipe_to_raws_en_local`: igual que `explode_recipe_to_raws`,
--       pero cuando llega a un grupo elige miembro MIRANDO EL LOCAL.
--     · `_sale_line_raw_consumption` pasa a usarla. Es el ÚNICO camino que
--       cambia: `explode_recipe_to_raws` (alérgenos, coste, revisiones) NO se
--       toca y sigue bajando por las líneas de receta del grupo, que apuntan
--       al miembro 1. O sea: para todo lo que no es descontar, el grupo es su
--       miembro 1, como el compuesto de hoy.
--     · Datos: los dos compuestos del 28/09 pasan a ser grupos, con sus dos
--       modelos como miembros. Las 46 recetas NO se tocan: ya apuntan al grupo.
--   Parte 2 · consumo propio del combo.
--     · Columna `menu_item.combo_own_recipe_item_id`.
--     · `_sale_line_raw_consumption` (rama combo) la descuenta ADEMÁS de los
--       `combo_item`; `compute_sale_line_cost` (rama combo) suma su coste.
--     · Datos: NINGUNO. Qué ficha lleva qué caja espera a Julio (ver parte, P2):
--       la hamburguesa del menú ya gasta su propia caja y las patatas la suya.
--
-- POR QUÉ UNA COLUMNA NUEVA Y NO `menu_item.recipe_item_id`
--   Medido el 28/09: de 68 combos vivos, UNO tiene artículo, «Menú Coca Cola
--   Milanesa de Pollo Napolitana» (Milanesa Haus), y su receta es el plato
--   ENTERO: Milanesa de Pollo Napolitana MH ×1 + Coca-Cola Original Lata ×1. Sus
--   11 ventas de 30 días llegan con `combo_item`. Si la rama combo empezara a
--   descontar `recipe_item_id`, esas 11 ventas descontarían la milanesa y la
--   lata DOS veces. `recipe_item_id` en un combo significa «todo el menú» (lo
--   usa la rama de producto cuando el combo llega SIN hijos); el consumo propio
--   es otra cosa y va en otra columna.
--
-- LO QUE NO HACE
--   · No reprocesa ninguna venta (regla del 18/09). Ver «regeneración» abajo.
--   · No fusiona ni archiva ninguno de los artículos físicos del salsero.
--   · No toca el recuento: `build_inventory_count` arma la lista con
--     `ri.type IN ('raw','packaging')`; los grupos son `recipe` y no entran.
--
-- REGENERACIÓN (el cron de las 01:30 y los reprocesos regeneran ventas)
--   La elección de miembro depende del stock de AHORA. Si se regenera una venta
--   de ayer, el stock de hoy podría elegir el otro modelo y mover almacén entre
--   artículos sin que nadie lo pida. Por eso la elección es PEGAJOSA: si
--   `sale_line_consumo_esperado` (lo que se congeló al cerrar) ya tiene todas
--   las hojas de un miembro para esa línea, se repite ese miembro. Solo una
--   línea sin nada congelado elige por stock.
-- ═══════════════════════════════════════════════════════════════════════════

begin;

-- ─── G0 · banda ────────────────────────────────────────────────────────────
do $g0$
declare v_h time := (now() at time zone 'Europe/Madrid')::time;
begin
  if v_h >= time '12:15' or v_h < time '00:30' then
    raise exception 'G0: son las % en Madrid. Esta migración toca el camino del pedido: solo entre 00:30 y 12:15.', v_h;
  end if;
end $g0$;

-- ─── G1 · la base está como se midió el 28/09 ─────────────────────────────
do $g1$
declare
  v_acc uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  n int;
begin
  -- Grupo 60: una línea, a la pieza única.
  select count(*) into n from recipe_line
   where parent_item_id = '49ac031a-d071-43bf-8a47-28cb1a10e1e8'
     and child_item_id  = '1b2c5e98-e697-4c3a-a1ea-50deec7c3f02';
  if n <> 1 or (select count(*) from recipe_line where parent_item_id = '49ac031a-d071-43bf-8a47-28cb1a10e1e8') <> 1 then
    raise exception 'G1: «Envase salsa 60 servido» ya no es 1 × Salsero con Tapa de 60cc. Volver a medir.';
  end if;
  -- Grupo 120: dos líneas, vaso + tapa.
  select count(*) into n from recipe_line
   where parent_item_id = '5b6f84f2-bccd-40d4-b09a-b84d193a9db6'
     and child_item_id in ('6dfc0238-71b0-4102-be96-17c444820088', 'bb458e8a-922a-41bf-869b-b5f145c88687');
  if n <> 2 or (select count(*) from recipe_line where parent_item_id = '5b6f84f2-bccd-40d4-b09a-b84d193a9db6') <> 2 then
    raise exception 'G1: «Envase salsa 120 servido» ya no es vaso + tapa de 120. Volver a medir.';
  end if;
  -- Los dos, de la cuenta, recipe no stockable y batch_yield 1 (trampas 1 y 2 del encargo).
  select count(*) into n from recipe_item
   where account_id = v_acc and type = 'recipe' and not coalesce(is_stockable, false) and batch_yield = 1
     and id in ('49ac031a-d071-43bf-8a47-28cb1a10e1e8', '5b6f84f2-bccd-40d4-b09a-b84d193a9db6');
  if n <> 2 then raise exception 'G1: los compuestos ya no son recipe / no stockable / batch_yield 1.'; end if;
  -- Los seis físicos existen en la cuenta.
  select count(*) into n from recipe_item where account_id = v_acc and id in (
    '1b2c5e98-e697-4c3a-a1ea-50deec7c3f02', '545df9a1-1b51-43af-a2ed-59cc88b5696c',
    '5ba2787c-a7c5-4340-9589-db056a215edb', '01292f99-1999-4d6d-b90c-886244f7bedb',
    '6dfc0238-71b0-4102-be96-17c444820088', 'bb458e8a-922a-41bf-869b-b5f145c88687');
  if n <> 6 then raise exception 'G1: falta alguno de los seis artículos del salsero (hay %).', n; end if;
  -- El combo con artículo sigue siendo UNO (la razón de la columna nueva).
  select count(*) into n from menu_item
   where account_id = v_acc and product_type = 'combo' and archived_at is null and recipe_item_id is not null;
  if n <> 1 then raise exception 'G1: hay % combos con artículo (se midió 1). Volver a mirar antes de seguir.', n; end if;
end $g1$;

-- ═══ PARTE 1 · GRUPO DE EQUIVALENCIA ═══════════════════════════════════════

create table if not exists public.recipe_item_equivalente (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references public.accounts(id) on delete cascade,
  group_item_id   uuid not null references public.recipe_item(id),
  member_item_id  uuid not null references public.recipe_item(id),
  priority        int  not null check (priority > 0),
  created_at      timestamptz not null default now(),
  constraint recipe_item_equivalente_distintos check (group_item_id <> member_item_id),
  constraint recipe_item_equivalente_miembro_unico unique (group_item_id, member_item_id),
  constraint recipe_item_equivalente_prioridad_unica unique (group_item_id, priority)
);
comment on table public.recipe_item_equivalente is
  'Grupo de equivalencia (28/09): la receta apunta al GRUPO y, al descontar una venta, '
  'el motor baja del primer miembro (por priority) que tenga existencias en el local. '
  'Solo lo usa explode_recipe_to_raws_en_local; para coste, alérgenos y revisiones el '
  'grupo es lo que digan sus recipe_line, que deben apuntar al miembro 1. '
  'El grupo es para CONSUMIR, nunca para contar: el recuento cuenta los miembros físicos.';
create index if not exists recipe_item_equivalente_grupo on public.recipe_item_equivalente (group_item_id, priority);

alter table public.recipe_item_equivalente enable row level security;
drop policy if exists recipe_item_equivalente_all on public.recipe_item_equivalente;
create policy recipe_item_equivalente_all on public.recipe_item_equivalente
  for all using (public.belongs_to_account(account_id))
  with check (public.belongs_to_account(account_id));

-- ─── Elegir miembro ────────────────────────────────────────────────────────
-- Orden de decisión, y es el del encargo más la pegajosidad:
--   1. PEGAJOSO: el primer miembro cuyas hojas estén TODAS congeladas en
--      `sale_line_consumo_esperado` para esta línea. Una venta ya cerrada
--      repite su elección al regenerarse.
--   2. STOCK: el primer miembro cuyas hojas tengan TODAS existencias
--      suficientes en el local (qty_on_hand >= lo que pide). Un miembro de dos
--      piezas sin tapas no está disponible aunque haya vasos: se sirve con las
--      dos o no se sirve.
--   3. NINGUNO: el miembro 1, y el negativo se ve (punto 4 del encargo).
-- Sin local (venta sin location_id) no hay stock que mirar: miembro 1.
create or replace function public._equivalente_elegido(
  p_group uuid, p_qty numeric, p_location uuid, p_sale_line uuid)
returns uuid
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_m uuid;
begin
  if p_sale_line is not null then
    select e.member_item_id into v_m
      from recipe_item_equivalente e
     where e.group_item_id = p_group
       and exists (select 1 from explode_recipe_to_raws(e.member_item_id, 1))
       and not exists (
         select 1 from explode_recipe_to_raws(e.member_item_id, 1) h
          where not exists (select 1 from sale_line_consumo_esperado c
                             where c.sale_line_id = p_sale_line and c.recipe_item_id = h.raw_item_id))
     order by e.priority
     limit 1;
    if v_m is not null then return v_m; end if;
  end if;

  if p_location is not null then
    select e.member_item_id into v_m
      from recipe_item_equivalente e
     where e.group_item_id = p_group
       and not exists (
         select 1 from explode_recipe_to_raws(e.member_item_id, coalesce(p_qty, 1)) h
          where coalesce((select s.qty_on_hand from recipe_item_location_stock s
                           where s.recipe_item_id = h.raw_item_id and s.location_id = p_location), 0)
                < h.qty_base)
     order by e.priority
     limit 1;
    if v_m is not null then return v_m; end if;
  end if;

  select e.member_item_id into v_m
    from recipe_item_equivalente e where e.group_item_id = p_group
   order by e.priority limit 1;
  return v_m;
end;
$function$;

-- ─── Explotar mirando el local ─────────────────────────────────────────────
-- Copia literal de `explode_recipe_to_raws` (22/09) con UNA diferencia: antes
-- de nada, si el artículo es un grupo, se sigue por el miembro elegido.
-- `explode_recipe_to_raws` no se toca: tiene otros seis lectores que no saben
-- de locales y no tienen por qué.
create or replace function public.explode_recipe_to_raws_en_local(
  p_item_id uuid, p_multiplier numeric, p_location uuid, p_sale_line uuid)
returns table(raw_item_id uuid, qty_base numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_item   recipe_item%rowtype;
  v_line   recipe_line%rowtype;
  v_qb     numeric;
  v_yield  numeric := null;
  v_member uuid;
begin
  if p_item_id is null or p_multiplier is null then return; end if;

  if exists (select 1 from recipe_item_equivalente e where e.group_item_id = p_item_id) then
    v_member := public._equivalente_elegido(p_item_id, p_multiplier, p_location, p_sale_line);
    return query select * from public.explode_recipe_to_raws_en_local(v_member, p_multiplier, p_location, p_sale_line);
    return;
  end if;

  select * into v_item from recipe_item where id = p_item_id;
  if not found then return; end if;

  if v_item.type in ('raw', 'tool', 'packaging')
     or (v_item.type = 'recipe' and coalesce(v_item.is_stockable, false)) then
    raw_item_id := p_item_id;
    qty_base    := p_multiplier;
    return next;
    return;
  end if;

  if v_item.type = 'recipe' or v_item.batch_yield is not null then
    v_yield := public._batch_yield_in_base(p_item_id);
  end if;
  if v_yield is null or v_yield <= 0 then v_yield := 1; end if;

  for v_line in
    select * from recipe_line where parent_item_id = p_item_id
    order by position asc, created_at asc
  loop
    v_qb := public._qty_in_base(v_line.child_item_id,
              coalesce(v_line.quantity_gross, v_line.quantity_net), v_line.unit_id);
    if v_qb is null then continue; end if;
    return query
      select * from public.explode_recipe_to_raws_en_local(v_line.child_item_id,
                      (p_multiplier / v_yield) * v_qb, p_location, p_sale_line);
  end loop;
  return;
end;
$function$;

-- ═══ PARTE 2 · CONSUMO PROPIO DEL COMBO ════════════════════════════════════

alter table public.menu_item
  add column if not exists combo_own_recipe_item_id uuid references public.recipe_item(id);
comment on column public.menu_item.combo_own_recipe_item_id is
  'Consumo PROPIO de un combo (28/09): lo que gasta el menú y no es de ningún componente '
  '(la caja del menú). Se descuenta ADEMÁS de los combo_item, solo cuando el pedido llega '
  'con combo_item. Puede apuntar directo a un packaging o a una receta. No confundir con '
  'recipe_item_id, que en un combo es la receta ENTERA para cuando llega sin hijos.';

-- ═══ EL LECTOR: _sale_line_raw_consumption ═════════════════════════════════
-- Misma firma (uuid) -> CREATE OR REPLACE vale (regla 2: no se añade parámetro).
-- Cambios, y solo estos:
--   · cada `explode_recipe_to_raws(x, q)` pasa a `explode_recipe_to_raws_en_local(x, q, v_loc, p_sale_line_id)`;
--   · rama combo: + el consumo propio del combo × cantidad de la línea.
create or replace function public._sale_line_raw_consumption(p_sale_line_id uuid)
returns table(raw_item_id uuid, qty_base numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_line     sale_line%rowtype;
  v_is_combo boolean := false;
  v_qty      numeric;
  v_loc      uuid;
begin
  select * into v_line from sale_line where id = p_sale_line_id;
  if not found then return; end if;
  if coalesce(v_line.line_type, 'product') <> 'product' then
    return;  -- modifier/combo_item no conducen; lo hace su padre product
  end if;
  v_qty := coalesce(v_line.quantity, 1);
  select s.location_id into v_loc from sale s where s.id = v_line.sale_id;

  select exists (
    select 1 from sale_line c
    where c.parent_sale_line_id = p_sale_line_id and c.line_type = 'combo_item'
  ) into v_is_combo;

  if v_is_combo then
    -- --- COMBO: base de cada hijo ---
    return query
    select e.raw_item_id, e.qty_base * coalesce(c.quantity, 1) * v_qty
    from sale_line c
    join menu_item mi on mi.id = c.menu_item_id
    cross join lateral public.explode_recipe_to_raws_en_local(mi.recipe_item_id, 1, v_loc, p_sale_line_id) e
    where c.parent_sale_line_id = p_sale_line_id and c.line_type = 'combo_item';

    -- --- COMBO: consumo PROPIO del menú (28/09) ---
    return query
    select e.raw_item_id, e.qty_base * v_qty
    from menu_item mi
    cross join lateral public.explode_recipe_to_raws_en_local(mi.combo_own_recipe_item_id, 1, v_loc, p_sale_line_id) e
    where mi.id = v_line.menu_item_id and mi.combo_own_recipe_item_id is not null;

    -- modificadores de hijo: add / bundle / replace (+)
    return query
    select e.raw_item_id, e.qty_base * coalesce(c.quantity, 1) * v_qty
    from sale_line c
    join sale_line m on m.parent_sale_line_id = c.id and m.line_type = 'modifier'
    join modifier_recipe_impact mri
         on mri.modifier_option_id = m.modifier_option_id and mri.status = 'confirmed'
    cross join lateral public.explode_recipe_to_raws_en_local(
         mri.target_recipe_item_id,
         public._qty_in_base(mri.target_recipe_item_id, mri.quantity * coalesce(m.quantity, 1), mri.unit_id),
         v_loc, p_sale_line_id) e
    where c.parent_sale_line_id = p_sale_line_id and c.line_type = 'combo_item'
      and mri.impact_type in ('add_item', 'bundle', 'replace_item');

    -- modificadores de hijo: remove (-)
    return query
    select e.raw_item_id, - e.qty_base * coalesce(c.quantity, 1) * v_qty
    from sale_line c
    join sale_line m on m.parent_sale_line_id = c.id and m.line_type = 'modifier'
    join modifier_recipe_impact mri
         on mri.modifier_option_id = m.modifier_option_id and mri.status = 'confirmed'
    cross join lateral public.explode_recipe_to_raws_en_local(
         mri.target_recipe_item_id,
         public._qty_in_base(mri.target_recipe_item_id, mri.quantity * coalesce(m.quantity, 1), mri.unit_id),
         v_loc, p_sale_line_id) e
    where c.parent_sale_line_id = p_sale_line_id and c.line_type = 'combo_item'
      and mri.impact_type = 'remove_item';

    -- modificadores de hijo: multiply (escala la base del hijo x (q-1))
    return query
    select e.raw_item_id, e.qty_base * (coalesce(mri.quantity, 1) - 1) * coalesce(c.quantity, 1) * v_qty
    from sale_line c
    join menu_item mi on mi.id = c.menu_item_id
    join sale_line m on m.parent_sale_line_id = c.id and m.line_type = 'modifier'
    join modifier_recipe_impact mri
         on mri.modifier_option_id = m.modifier_option_id and mri.status = 'confirmed'
            and mri.impact_type = 'multiply'
    cross join lateral public.explode_recipe_to_raws_en_local(mi.recipe_item_id, 1, v_loc, p_sale_line_id) e
    where c.parent_sale_line_id = p_sale_line_id and c.line_type = 'combo_item';

  else
    -- --- PRODUCT simple: base del plato ---
    return query
    select e.raw_item_id, e.qty_base * v_qty
    from menu_item mi
    cross join lateral public.explode_recipe_to_raws_en_local(mi.recipe_item_id, 1, v_loc, p_sale_line_id) e
    where mi.id = v_line.menu_item_id;

    -- modificadores de la linea: add / bundle / replace (+)
    return query
    select e.raw_item_id, e.qty_base * v_qty
    from sale_line m
    join modifier_recipe_impact mri
         on mri.modifier_option_id = m.modifier_option_id and mri.status = 'confirmed'
    cross join lateral public.explode_recipe_to_raws_en_local(
         mri.target_recipe_item_id,
         public._qty_in_base(mri.target_recipe_item_id, mri.quantity * coalesce(m.quantity, 1), mri.unit_id),
         v_loc, p_sale_line_id) e
    where m.parent_sale_line_id = p_sale_line_id and m.line_type = 'modifier'
      and mri.impact_type in ('add_item', 'bundle', 'replace_item');

    -- modificadores de la linea: remove (-)
    return query
    select e.raw_item_id, - e.qty_base * v_qty
    from sale_line m
    join modifier_recipe_impact mri
         on mri.modifier_option_id = m.modifier_option_id and mri.status = 'confirmed'
    cross join lateral public.explode_recipe_to_raws_en_local(
         mri.target_recipe_item_id,
         public._qty_in_base(mri.target_recipe_item_id, mri.quantity * coalesce(m.quantity, 1), mri.unit_id),
         v_loc, p_sale_line_id) e
    where m.parent_sale_line_id = p_sale_line_id and m.line_type = 'modifier'
      and mri.impact_type = 'remove_item';

    -- modificadores de la linea: multiply (escala la base x (q-1))
    return query
    select e.raw_item_id, e.qty_base * (coalesce(mri.quantity, 1) - 1) * v_qty
    from sale_line m
    join modifier_recipe_impact mri
         on mri.modifier_option_id = m.modifier_option_id and mri.status = 'confirmed'
            and mri.impact_type = 'multiply'
    join menu_item mi on mi.id = v_line.menu_item_id
    cross join lateral public.explode_recipe_to_raws_en_local(mi.recipe_item_id, 1, v_loc, p_sale_line_id) e
    where m.parent_sale_line_id = p_sale_line_id and m.line_type = 'modifier';
  end if;
  return;
end;
$function$;

-- ═══ EL COSTE DE LA LÍNEA: compute_sale_line_cost, rama combo ══════════════
-- Misma firma. Único cambio: tras sumar los hijos, se suma el coste del
-- consumo propio. Si hay consumo propio y su coste no se sabe, la línea queda
-- INCOMPLETA (NULL), igual que cuando falta el coste de un hijo: un coste que
-- se calla la caja no es un coste más barato, es un coste falso.
-- El resto del cuerpo es el vivo del 28/09, literal.
create or replace function public.compute_sale_line_cost(p_sale_line_id uuid)
returns numeric
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_line        sale_line%rowtype;
  v_account_id  uuid;
  v_mi          menu_item%rowtype;
  v_base_cost   numeric;
  v_mod_total   numeric := 0;
  v_total       numeric;
  v_is_combo    boolean := false;
  v_combo_total numeric := 0;
  v_incomplete  boolean := false;
  v_child       record;
  v_impact      record;
  v_comp_base   numeric;
  v_comp_mod    numeric;
  v_comp_recipe uuid;
  v_own_item    uuid;
  v_own_cost    numeric;
begin
  select * into v_line from sale_line where id = p_sale_line_id;
  if not found then return null; end if;
  v_account_id := v_line.account_id;

  if coalesce(v_line.line_type, 'product') <> 'product' then
    return v_line.computed_cost;
  end if;

  select exists (
    select 1 from sale_line c
    where c.parent_sale_line_id = p_sale_line_id
      and c.line_type = 'combo_item'
  ) into v_is_combo;

  if v_is_combo then
    for v_child in
      select c.id, c.menu_item_id, c.quantity
      from sale_line c
      where c.parent_sale_line_id = p_sale_line_id
        and c.line_type = 'combo_item'
    loop
      v_comp_recipe := null;
      if v_child.menu_item_id is not null then
        select mi.recipe_item_id into v_comp_recipe from menu_item mi where mi.id = v_child.menu_item_id;
      end if;
      if v_comp_recipe is null then v_incomplete := true; continue; end if;

      select coalesce(ri.computed_cost, ri.fixed_cost) into v_comp_base
      from recipe_item ri where ri.id = v_comp_recipe;
      if v_comp_base is null then v_incomplete := true; continue; end if;

      v_comp_mod := 0;
      for v_impact in
        select mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
               coalesce(gm.quantity, 1) as mod_qty
        from sale_line gm
        join modifier_recipe_impact mri on mri.modifier_option_id = gm.modifier_option_id
        where gm.parent_sale_line_id = v_child.id
          and gm.line_type = 'modifier'
          and mri.status = 'confirmed'
      loop
        if v_impact.impact_type in ('add_item','bundle','replace_item') then
          v_comp_mod := v_comp_mod + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        elsif v_impact.impact_type = 'remove_item' then
          v_comp_mod := v_comp_mod - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
        elsif v_impact.impact_type = 'multiply' then
          v_comp_mod := v_comp_mod + v_comp_base * (coalesce(v_impact.quantity,1) - 1);
        end if;
      end loop;

      v_combo_total := v_combo_total + (v_comp_base + v_comp_mod) * coalesce(v_child.quantity, 1);
    end loop;

    -- ── consumo PROPIO del menú (28/09) ──
    select mi.combo_own_recipe_item_id into v_own_item from menu_item mi where mi.id = v_line.menu_item_id;
    if v_own_item is not null then
      select coalesce(ri.computed_cost, ri.fixed_cost) into v_own_cost from recipe_item ri where ri.id = v_own_item;
      if v_own_cost is null then
        v_incomplete := true;
      else
        v_combo_total := v_combo_total + v_own_cost;
      end if;
    end if;

    if v_incomplete then
      update sale_line set computed_cost = null, cost_computed_at = now() where id = p_sale_line_id;
      return null;
    end if;
    v_total := round(v_combo_total * coalesce(v_line.quantity, 1), 6);
    update sale_line set computed_cost = v_total, cost_computed_at = now() where id = p_sale_line_id;
    return v_total;
  end if;

  if v_line.menu_item_id is null then
    update sale_line set computed_cost = null, cost_computed_at = now() where id = p_sale_line_id;
    return null;
  end if;
  select * into v_mi from menu_item where id = v_line.menu_item_id;
  if v_mi.recipe_item_id is null then
    update sale_line set computed_cost = null, cost_computed_at = now() where id = p_sale_line_id;
    return null;
  end if;

  select coalesce(ri.computed_cost, ri.fixed_cost) into v_base_cost
  from recipe_item ri where ri.id = v_mi.recipe_item_id;
  if v_base_cost is null then
    update sale_line set computed_cost = null, cost_computed_at = now() where id = p_sale_line_id;
    return null;
  end if;

  for v_impact in
    select mri.impact_type, mri.target_recipe_item_id, mri.quantity, mri.unit_id,
           coalesce(m.quantity, 1) as mod_qty
    from sale_line m
    join modifier_recipe_impact mri on mri.modifier_option_id = m.modifier_option_id
    where m.parent_sale_line_id = p_sale_line_id
      and m.line_type = 'modifier'
      and mri.status = 'confirmed'
  loop
    if v_impact.impact_type in ('add_item','bundle','replace_item') then
      v_mod_total := v_mod_total + public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
    elsif v_impact.impact_type = 'remove_item' then
      v_mod_total := v_mod_total - public._impact_cost(v_impact.target_recipe_item_id, v_impact.quantity * v_impact.mod_qty, v_impact.unit_id);
    elsif v_impact.impact_type = 'multiply' then
      v_mod_total := v_mod_total + v_base_cost * (coalesce(v_impact.quantity,1) - 1);
    end if;
  end loop;

  v_total := round((v_base_cost + v_mod_total) * coalesce(v_line.quantity, 1), 6);
  update sale_line set computed_cost = v_total, cost_computed_at = now() where id = p_sale_line_id;
  return v_total;
end;
$function$;

-- ═══ DATOS · los dos compuestos pasan a grupos ═════════════════════════════
-- 60: el grupo ya apunta a la pieza única (miembro 1). Nace el miembro 2,
--     «dos piezas» = vaso 60 + tapa 60, con batch_yield 1 (trampa 2).
-- 120: el grupo apuntaba a vaso + tapa. Esas dos líneas se mudan al miembro 1
--     nuevo «dos piezas», y el grupo pasa a una línea a él. Miembro 2: la pieza
--     única de 120. El orden es el de lo que se compra (encargo, 28/09).
do $datos$
declare
  v_acc  uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_ud   uuid;
  v_m60  uuid;
  v_m120 uuid;
begin
  select base_unit_id into v_ud from recipe_item where id = '49ac031a-d071-43bf-8a47-28cb1a10e1e8';

  insert into recipe_item (account_id, type, name, base_unit_id, is_stockable, batch_yield, batch_yield_unit_id, cost_strategy, source, notes)
  values (v_acc, 'recipe', 'Envase salsa 60 · dos piezas', v_ud, false, 1, v_ud, 'average_weighted', 'manual',
          'Miembro 2 del grupo «Envase salsa 60 servido». type=recipe y no stockable para que explote; '
          'batch_yield=1 FIJO: sin él el rendimiento sería 2 (vaso+tapa) y bajaría media unidad de cada.')
  returning id into v_m60;
  insert into recipe_line (account_id, parent_item_id, child_item_id, quantity_net, quantity_gross, unit_id, position)
  values (v_acc, v_m60, '5ba2787c-a7c5-4340-9589-db056a215edb', 1, 1, v_ud, 1),
         (v_acc, v_m60, '01292f99-1999-4d6d-b90c-886244f7bedb', 1, 1, v_ud, 2);

  insert into recipe_item (account_id, type, name, base_unit_id, is_stockable, batch_yield, batch_yield_unit_id, cost_strategy, source, notes)
  values (v_acc, 'recipe', 'Envase salsa 120 · dos piezas', v_ud, false, 1, v_ud, 'average_weighted', 'manual',
          'Miembro 1 del grupo «Envase salsa 120 servido». Mismas dos trampas que el de 60.')
  returning id into v_m120;
  update recipe_line set parent_item_id = v_m120
   where parent_item_id = '5b6f84f2-bccd-40d4-b09a-b84d193a9db6';
  insert into recipe_line (account_id, parent_item_id, child_item_id, quantity_net, quantity_gross, unit_id, position)
  values (v_acc, '5b6f84f2-bccd-40d4-b09a-b84d193a9db6', v_m120, 1, 1, v_ud, 1);

  insert into recipe_item_equivalente (account_id, group_item_id, member_item_id, priority) values
    (v_acc, '49ac031a-d071-43bf-8a47-28cb1a10e1e8', '1b2c5e98-e697-4c3a-a1ea-50deec7c3f02', 1),
    (v_acc, '49ac031a-d071-43bf-8a47-28cb1a10e1e8', v_m60, 2),
    (v_acc, '5b6f84f2-bccd-40d4-b09a-b84d193a9db6', v_m120, 1),
    (v_acc, '5b6f84f2-bccd-40d4-b09a-b84d193a9db6', '545df9a1-1b51-43af-a2ed-59cc88b5696c', 2);

  update recipe_item set notes = coalesce(notes || E'\n', '') ||
    '28/09: GRUPO de equivalencia (recipe_item_equivalente). Al vender baja del primer miembro con '
    'existencias en el local. Su recipe_line apunta al miembro 1 y es lo que usan coste y alérgenos.'
   where id in ('49ac031a-d071-43bf-8a47-28cb1a10e1e8', '5b6f84f2-bccd-40d4-b09a-b84d193a9db6');
end $datos$;

-- ═══ COMPROBACIONES · pegar el resultado en el parte ═══════════════════════

-- C1 · la invariante: la recipe_line del grupo apunta a su miembro 1 (lo que
-- ven coste y alérgenos es lo mismo que elige un local con stock de todo).
select g.name as grupo, m.name as miembro_1,
       (select count(*) from recipe_line rl where rl.parent_item_id = e.group_item_id) as lineas_del_grupo,
       exists (select 1 from recipe_line rl where rl.parent_item_id = e.group_item_id and rl.child_item_id = e.member_item_id) as apunta_al_1
  from recipe_item_equivalente e
  join recipe_item g on g.id = e.group_item_id
  join recipe_item m on m.id = e.member_item_id
 where e.priority = 1;
-- Esperado: 2 filas, lineas_del_grupo = 1, apunta_al_1 = true.

-- C2 · lo que elegiría cada local HOY, para 1 unidad de cada grupo.
select g.name as grupo, l.name as local,
       m.name as elegido,
       (select string_agg(r.name || ' ×' || round(h.qty_base, 3), ' + ')
          from explode_recipe_to_raws_en_local(e.group_item_id, 1, l.id, null) h
          join recipe_item r on r.id = h.raw_item_id) as baja_de
  from (select distinct group_item_id from recipe_item_equivalente) e
  join recipe_item g on g.id = e.group_item_id
  cross join locations l
  join recipe_item m on m.id = public._equivalente_elegido(e.group_item_id, 1, l.id, null)
 where l.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
 order by 1, 2;
-- Esperado con el stock del 28/09:
--   120 · Carabanchel -> la pieza única (hay 420; tapas de 120 allí: 0)
--   120 · Alcalá      -> vaso + tapa (750 y 1.330)
--   60  · Carabanchel -> la pieza única (607)
--   60  · Alcalá      -> la pieza única, aunque esté a −1: ninguno tiene; baja del 1 y el negativo se ve.

-- C3 · para todo lo que NO es descontar, el grupo no ha cambiado: las 46
-- recetas explotan igual por la vía vieja (misma suma de hojas).
select count(*) as recetas,
       sum((select sum(h.qty_base) from explode_recipe_to_raws(p.parent_item_id, 1) h)) as hojas_via_vieja
  from (select distinct parent_item_id from recipe_line
         where child_item_id in ('49ac031a-d071-43bf-8a47-28cb1a10e1e8', '5b6f84f2-bccd-40d4-b09a-b84d193a9db6')) p;
-- Se mide ANTES (en la misma sesión, antes del BEGIN) y DESPUÉS, con la misma consulta (regla 31).

rollback;
-- commit;   -- solo tras leer G0–G1 y C1–C3, y con el ensayo de los cuatro caminos pegado.
