-- ----------------------------------------------------------------------------
-- Folvy - 20260815T0600
-- Ficha por producto (Tramo F): 5 funciones corregidas contra la clave nueva
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- Auditoría de las 17 funciones que tocan article_supplier (encargo, "¿rompe
-- con dos filas por par?"). 12 ya eran seguras (SELECT sin asumir fila única,
-- o ORDER BY ... LIMIT 1 ya determinista). 5 rompían o daban un resultado
-- incorrecto una vez que un mismo (recipe_item_id, supplier_id) puede tener
-- más de una ficha (dos supplier_code distintos, ej. Pulled Pork 6,5kg/6kg
-- de CLOUDTOWN) -- exactamente lo que el Tramo A dejó de prohibir a propósito.
--
--   apply_invoice_costs   -- ON CONFLICT (recipe_item_id, supplier_id) apuntaba
--     a la restricción vieja, ya eliminada en 20260815T0300. Habría reventado
--     (42P10) en la próxima factura importada con línea casada. Reescrita para
--     ramificar por supplier_code, con el WHERE exacto de cada índice parcial.
--   suggest_purchase_qty  -- el CTE "fmt" devolvía una fila por FICHA, no por
--     artículo: con dos fichas duplicaba la sugerencia de repedido. DISTINCT ON
--     con el mismo criterio ya usado en kitchen_recompute_raw_cost (preferida
--     > más reciente).
--   learn_from_receipt    -- mismo ON CONFLICT roto que apply_invoice_costs
--     (memoria por proveedor al confirmar cada recepción). Misma reescritura.
--   migrate_supplier_articles -- el JOIN de fusión (mover artículos de un
--     proveedor a otro) casaba origen/destino solo por recipe_item_id. Con dos
--     fichas por lado para el mismo artículo, producía un producto cruzado:
--     cada fila origen se fusionaba con TODAS las filas destino del mismo
--     artículo, pisando datos de códigos distintos. Ahora casa también por
--     supplier_code (IS NOT DISTINCT FROM, NULL casa con NULL).
--   preview_supplier_migration -- su cuenta de "colisiones" tiene que
--     significar lo mismo que lo que migrate_supplier_articles fusiona de
--     verdad: mismo recipe_item_id Y mismo supplier_code. Antes sobre-contaba
--     colisión con que coincidiera solo el artículo.
--
-- Las 2 primeras (apply_invoice_costs, suggest_purchase_qty) se aplicaron y
-- verificaron en vivo el 15/08 durante la propia auditoría (suggest_purchase_qty:
-- 89 filas / 89 recipe_item_id distintos para CLOUDTOWN; apply_invoice_costs:
-- probado con un INSERT..ON CONFLICT manual antes de fijar el WHERE exacto).
-- Las 3 siguientes se aplican aquí. migrate_supplier_articles/
-- preview_supplier_migration se probaron con un clon sintético del caso real
-- Pulled Pork (2 fichas del mismo artículo bajo el mismo proveedor, en
-- proveedores de prueba _TEST_MERGE_SOURCE/_TEST_MERGE_TARGET, borrados tras
-- la prueba) -- confirmado que con la fusión ANTES del fix una ficha ajena
-- (código 310210021) habría cambiado de precio en modo source_wins; con el
-- fix queda intacta.
--
-- NO revisadas de nuevo aquí (ya seguras, sin cambios):
--   migrate_kitchen_core   -- copia TODAS las filas de article_supplier del
--     núcleo migrado, sin SELECT INTO ni asumir una sola fila por par.
--   run_mapping            -- usa EXISTS(...) sobre article_supplier, no
--     asume unicidad.
--   ingredients_without_spec, post_pending_receipt_line -- ya usan
--     ORDER BY is_preferred DESC, updated_at DESC LIMIT 1.
--   trg_article_supplier_recompute_cost -- trigger trivial, delega en
--     kitchen_recompute_raw_cost (ya seguro desde antes de este encargo).
--   void_goods_receipt -- casa además por purchase_format_id, que ahora es
--     efectivamente específico del producto.
--
-- Cliente (git grep article_supplier): sin cambios de fondo salvo uno --
-- getSupplierLastPrices (goodsReceiptService.ts) construía un mapa
-- recipe_item_id -> precio con un bucle sin ORDER BY: con dos fichas por
-- artículo, la última fila que devolviera Postgres (orden no garantizado)
-- ganaba en el mapa, pudiendo comparar el aviso de recepción contra el precio
-- de la ficha equivocada. Corregido en el propio archivo (no en SQL): mismo
-- criterio preferida > más reciente, ORDER BY + primera fila por artículo.
-- El resto ya estaba diseñado para esto: listSuppliersByItem/listLinksBySupplier
-- (purchaseFormatService.ts) y getSupplierCatalog (supplierCatalogService.ts)
-- devuelven TODAS las fichas sin colapsar, y PurchaseSourcesSection.tsx
-- pinta cada fila con key={link.id} (no supplierId) mostrando su
-- supplier_code -- ya enseña dos fichas del mismo proveedor sin fusionarlas.
-- GoodsReceiptForm.tsx ya llevaba desde el 13/08 (fix/recepcion-casado-no-casa)
-- un catalogEntries sin colapsar aparte del catalogByItem colapsado,
-- precisamente por este mismo motivo.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.apply_invoice_costs(p_invoice_id uuid)
 RETURNS TABLE(recipe_item_id uuid, item_name text, old_cost numeric, new_cost numeric, old_price numeric, new_price numeric, pct numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_account_id uuid;
  v_supplier_id uuid;
  v_line record;
  v_old_cost numeric;
  v_new_cost numeric;
  v_old_price numeric;
  v_fmt uuid;
  v_new_base numeric;
BEGIN
  SELECT account_id, supplier_id INTO v_account_id, v_supplier_id
    FROM public.supplier_invoice WHERE id = p_invoice_id;
  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Factura % no encontrada', p_invoice_id;
  END IF;

  CREATE TEMP TABLE _impact (
    recipe_item_id uuid, item_name text, old_cost numeric, new_cost numeric,
    old_price numeric, new_price numeric, pct numeric
  ) ON COMMIT DROP;

  FOR v_line IN
    SELECT sil.recipe_item_id, sil.unit_price, nullif(sil.supplier_code,'') as supplier_code
      FROM public.supplier_invoice_line sil
      WHERE sil.supplier_invoice_id = p_invoice_id
        AND sil.recipe_item_id IS NOT NULL
        AND sil.unit_price IS NOT NULL
  LOOP
    IF v_supplier_id IS NULL THEN CONTINUE; END IF;

    SELECT computed_cost INTO v_old_cost FROM public.recipe_item WHERE id = v_line.recipe_item_id;

    IF v_line.supplier_code IS NOT NULL THEN
      SELECT last_price, purchase_format_id INTO v_old_price, v_fmt
        FROM public.article_supplier
        WHERE account_id = v_account_id AND recipe_item_id = v_line.recipe_item_id
          AND supplier_id = v_supplier_id AND supplier_code = v_line.supplier_code;
    ELSE
      SELECT last_price, purchase_format_id INTO v_old_price, v_fmt
        FROM public.article_supplier
        WHERE account_id = v_account_id AND recipe_item_id = v_line.recipe_item_id
          AND supplier_id = v_supplier_id AND supplier_code IS NULL;
    END IF;

    v_new_base := public._eur_base_from_format(v_fmt, v_line.unit_price);
    IF v_new_base IS NULL THEN
      CONTINUE;
    END IF;

    IF v_line.supplier_code IS NOT NULL THEN
      INSERT INTO public.article_supplier (account_id, recipe_item_id, supplier_id, supplier_code, last_price, source)
      VALUES (v_account_id, v_line.recipe_item_id, v_supplier_id, v_line.supplier_code, v_new_base, 'import')
      ON CONFLICT (supplier_id, supplier_code, recipe_item_id) WHERE supplier_code IS NOT NULL
      DO UPDATE SET last_price = EXCLUDED.last_price;
    ELSE
      INSERT INTO public.article_supplier (account_id, recipe_item_id, supplier_id, supplier_code, last_price, source)
      VALUES (v_account_id, v_line.recipe_item_id, v_supplier_id, NULL, v_new_base, 'import')
      ON CONFLICT (recipe_item_id, supplier_id) WHERE supplier_code IS NULL
      DO UPDATE SET last_price = EXCLUDED.last_price;
    END IF;

    SELECT computed_cost INTO v_new_cost FROM public.recipe_item WHERE id = v_line.recipe_item_id;

    INSERT INTO _impact (recipe_item_id, item_name, old_cost, new_cost, old_price, new_price, pct)
    SELECT v_line.recipe_item_id,
           (SELECT name FROM public.recipe_item WHERE id = v_line.recipe_item_id),
           v_old_cost, v_new_cost, v_old_price, v_new_base,
           CASE WHEN v_old_price IS NOT NULL AND v_old_price > 0
                THEN round(((v_new_base - v_old_price) / v_old_price) * 100, 1) END
    WHERE NOT EXISTS (SELECT 1 FROM _impact i WHERE i.recipe_item_id = v_line.recipe_item_id);
  END LOOP;

  RETURN QUERY
    SELECT i.recipe_item_id, i.item_name, i.old_cost, i.new_cost, i.old_price, i.new_price, i.pct
    FROM _impact i ORDER BY abs(COALESCE(i.pct, 0)) DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.suggest_purchase_qty(p_account uuid, p_supplier uuid, p_location uuid, p_horizon_days integer DEFAULT 7, p_hist_days integer DEFAULT 60, p_consumo_days integer DEFAULT 30)
 RETURNS TABLE(recipe_item_id uuid, suggested_qty numeric, source text, confidence text, format_qty_base numeric, needed_base numeric)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with cat as (
    select distinct a.recipe_item_id
    from article_supplier a
    where a.account_id = p_account
      and a.supplier_id = p_supplier
      and a.is_active = true
  ),
  fmt as (
    -- CORRECCIÓN: el formato PREFERENTE de compra de este proveedor
    -- (article_supplier.purchase_format_id), no "el más pequeño". Es el mismo
    -- formato por el que se pide y que ve el comprador ("Caja 18 kg"). Fallback:
    -- si el preferente no tiene qty_in_base válido, base = 1 (pide en base).
    --
    -- ENCARGO CODE (15/08) feat/ficha-por-producto, Tramo F -- ahora puede
    -- haber MAS de una ficha article_supplier por (recipe_item_id,
    -- supplier_id) (productos distintos con codigos distintos del mismo
    -- proveedor). Sin el DISTINCT ON, este CTE devolvia una fila por ficha y
    -- duplicaba las sugerencias al hacer el join de mas abajo. Mismo
    -- criterio ya usado en kitchen_recompute_raw_cost: preferida primero,
    -- si no la mas reciente.
    select distinct on (a.recipe_item_id)
      a.recipe_item_id as item_id,
      coalesce(nullif(f.qty_in_base, 0), 1)::numeric as qty_base
    from article_supplier a
    left join recipe_item_purchase_format f
      on f.id = a.purchase_format_id and f.account_id = p_account
    where a.account_id = p_account
      and a.supplier_id = p_supplier
      and a.is_active = true
    order by a.recipe_item_id, a.is_preferred desc, a.updated_at desc
  ),
  stock as (
    select s.recipe_item_id, coalesce(s.qty_on_hand, 0)::numeric as on_hand
    from recipe_item_location_stock s
    where s.account_id = p_account and s.location_id = p_location
  ),
  par as (
    select l.recipe_item_id, l.par_qty::numeric as par_qty
    from stock_level l
    where l.account_id = p_account and l.location_id = p_location
      and l.par_qty is not null and l.par_qty > 0
  ),
  consumo as (
    select m.recipe_item_id,
           sum(abs(m.qty_base)) / nullif(p_consumo_days, 0)::numeric as diario_base
    from stock_movement m
    where m.account_id = p_account
      and m.location_id = p_location
      and m.movement_type = 'consumo'
      and m.occurred_at >= now() - make_interval(days => p_consumo_days)
    group by m.recipe_item_id
    having sum(abs(m.qty_base)) > 0
  ),
  hist as (
    select pol.recipe_item_id,
           sum(pol.qty_ordered)::numeric
             / nullif(p_hist_days, 0)::numeric * 7 as semanal_fmt
    from purchase_order_line pol
    join purchase_order po on po.id = pol.purchase_order_id
    where pol.account_id = p_account
      and po.location_id = p_location
      and po.status not in ('cancelado', 'borrador')
      and po.order_date >= (now() - make_interval(days => p_hist_days))::date
      and pol.recipe_item_id is not null
    group by pol.recipe_item_id
    having sum(pol.qty_ordered) > 0
  )
  select
    c.recipe_item_id,
    case
      when p.par_qty is not null then
        greatest(0, ceil( greatest(p.par_qty - coalesce(st.on_hand,0), 0) / f.qty_base ))
      when co.diario_base is not null then
        greatest(0, ceil( greatest(co.diario_base * p_horizon_days - coalesce(st.on_hand,0), 0) / f.qty_base ))
      when h.semanal_fmt is not null then
        greatest(0, ceil( greatest(
          h.semanal_fmt * (p_horizon_days::numeric / 7) - coalesce(st.on_hand,0) / f.qty_base
        , 0) ))
      else null
    end as suggested_qty,
    case
      when p.par_qty  is not null then 'par'
      when co.diario_base is not null then 'consumo'
      when h.semanal_fmt is not null then 'historico'
      else 'none'
    end as source,
    case
      when p.par_qty is not null then 'alta'
      when co.diario_base is not null then 'alta'
      when h.semanal_fmt is not null then 'media'
      else null
    end as confidence,
    f.qty_base as format_qty_base,
    case
      when p.par_qty is not null then greatest(p.par_qty - coalesce(st.on_hand,0), 0)
      when co.diario_base is not null then greatest(co.diario_base * p_horizon_days - coalesce(st.on_hand,0), 0)
      else null
    end as needed_base
  from cat c
  left join fmt f  on f.item_id = c.recipe_item_id
  left join stock st on st.recipe_item_id = c.recipe_item_id
  left join par p  on p.recipe_item_id = c.recipe_item_id
  left join consumo co on co.recipe_item_id = c.recipe_item_id
  left join hist h on h.recipe_item_id = c.recipe_item_id;
$function$;

CREATE OR REPLACE FUNCTION public.learn_from_receipt(p_receipt_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_receipt goods_receipt%ROWTYPE;
  v_line    goods_receipt_line%ROWTYPE;
  v_count   integer := 0;
  v_eur_base numeric;
  v_code    text;
BEGIN
  SELECT * INTO v_receipt FROM goods_receipt WHERE id = p_receipt_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'learn_from_receipt: albarán % no existe', p_receipt_id;
  END IF;
  IF NOT public.belongs_to_account(v_receipt.account_id) THEN
    RAISE EXCEPTION 'learn_from_receipt: sin acceso al albarán %', p_receipt_id;
  END IF;
  IF v_receipt.supplier_id IS NULL THEN RETURN 0; END IF;

  FOR v_line IN
    SELECT * FROM goods_receipt_line
    WHERE goods_receipt_id = p_receipt_id AND recipe_item_id IS NOT NULL
  LOOP
    v_eur_base := public._eur_base_from_format(v_line.purchase_format_id, v_line.unit_cost);
    v_code := NULLIF(btrim(coalesce(v_line.supplier_code, '')), '');

    -- ENCARGO CODE (15/08) feat/ficha-por-producto, Tramo F -- ON CONFLICT
    -- (recipe_item_id, supplier_id) referenciaba una restriccion que ya no
    -- existe (se elimino en la migracion de la clave). La ficha ahora
    -- cuelga de (recipe_item_id, supplier_id, supplier_code); se upsertea
    -- por esa clave cuando hay codigo, y por el par (indice parcial "sin
    -- codigo") cuando no lo hay.
    IF v_code IS NOT NULL THEN
      INSERT INTO article_supplier (
        account_id, recipe_item_id, supplier_id,
        supplier_code, supplier_item_name, last_price, purchase_format_id,
        is_preferred, is_active, source
      )
      VALUES (
        v_receipt.account_id, v_line.recipe_item_id, v_receipt.supplier_id,
        v_code,
        NULLIF(btrim(coalesce(v_line.raw_text, v_line.product_name, '')), ''),
        v_eur_base, v_line.purchase_format_id,
        false, true, 'albaran'
      )
      ON CONFLICT (supplier_id, supplier_code, recipe_item_id) WHERE supplier_code IS NOT NULL
      DO UPDATE SET
        supplier_item_name = COALESCE(EXCLUDED.supplier_item_name, article_supplier.supplier_item_name),
        last_price         = COALESCE(EXCLUDED.last_price, article_supplier.last_price),
        purchase_format_id = COALESCE(EXCLUDED.purchase_format_id, article_supplier.purchase_format_id),
        is_active          = true,
        updated_at         = now();
    ELSE
      INSERT INTO article_supplier (
        account_id, recipe_item_id, supplier_id,
        supplier_code, supplier_item_name, last_price, purchase_format_id,
        is_preferred, is_active, source
      )
      VALUES (
        v_receipt.account_id, v_line.recipe_item_id, v_receipt.supplier_id,
        NULL,
        NULLIF(btrim(coalesce(v_line.raw_text, v_line.product_name, '')), ''),
        v_eur_base, v_line.purchase_format_id,
        false, true, 'albaran'
      )
      ON CONFLICT (recipe_item_id, supplier_id) WHERE supplier_code IS NULL
      DO UPDATE SET
        supplier_item_name = COALESCE(EXCLUDED.supplier_item_name, article_supplier.supplier_item_name),
        last_price         = COALESCE(EXCLUDED.last_price, article_supplier.last_price),
        purchase_format_id = COALESCE(EXCLUDED.purchase_format_id, article_supplier.purchase_format_id),
        is_active          = true,
        updated_at         = now();
    END IF;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.migrate_supplier_articles(p_source uuid, p_target uuid, p_mode text DEFAULT 'fill'::text)
 RETURNS TABLE(moved integer, merged integer, affected_item_ids uuid[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_acc uuid; v_moved int := 0; v_merged int := 0; v_affected uuid[]; r record;
BEGIN
  SELECT s1.account_id INTO v_acc
  FROM supplier s1 JOIN supplier s2 ON s2.id = p_target
  WHERE s1.id = p_source AND s1.account_id = s2.account_id;
  IF v_acc IS NULL THEN RAISE EXCEPTION 'Proveedores inválidos o de cuentas distintas'; END IF;
  IF NOT (v_acc = ANY (current_user_account_ids())) THEN RAISE EXCEPTION 'Sin permiso sobre esta cuenta'; END IF;
  IF p_source = p_target THEN RAISE EXCEPTION 'Origen y destino no pueden ser el mismo proveedor'; END IF;
  IF p_mode NOT IN ('fill','source_wins','keep_target') THEN RAISE EXCEPTION 'Modo no válido: %', p_mode; END IF;

  SELECT COALESCE(array_agg(DISTINCT recipe_item_id), '{}') INTO v_affected
  FROM article_supplier WHERE supplier_id = p_source;

  -- ENCARGO CODE (15/08) feat/ficha-por-producto, Tramo F -- el JOIN
  -- casaba origen/destino solo por recipe_item_id. Desde que un mismo
  -- proveedor puede tener DOS fichas del mismo articulo (dos
  -- supplier_code distintos, ej. Pulled Pork 6.5kg/6kg de CLOUDTOWN), esto
  -- producia un producto cruzado: cada fila origen casaba con TODAS las
  -- filas destino del mismo articulo, pisando el UPDATE varias veces con
  -- datos de codigos distintos. Ahora casa tambien por supplier_code
  -- (IS NOT DISTINCT FROM para que NULL case con NULL, el camino manual
  -- sin codigo) -- una fusion real es (recipe_item_id, supplier_code)
  -- igual en origen y destino, no solo el articulo.
  FOR r IN
    SELECT src.id AS src_id, dst.id AS dst_id,
           src.last_price AS s_price, src.supplier_code AS s_code, src.purchase_format_id AS s_fmt, src.supplier_item_name AS s_name,
           dst.last_price AS d_price, dst.supplier_code AS d_code, dst.purchase_format_id AS d_fmt, dst.supplier_item_name AS d_name
    FROM article_supplier src
    JOIN article_supplier dst ON dst.supplier_id = p_target AND dst.recipe_item_id = src.recipe_item_id
      AND dst.supplier_code IS NOT DISTINCT FROM src.supplier_code
    WHERE src.supplier_id = p_source
  LOOP
    IF p_mode = 'fill' THEN
      UPDATE article_supplier SET
        last_price         = COALESCE(r.d_price, r.s_price),
        supplier_code      = COALESCE(NULLIF(r.d_code, ''), r.s_code),
        purchase_format_id = COALESCE(r.d_fmt, r.s_fmt),
        supplier_item_name = COALESCE(NULLIF(r.d_name, ''), r.s_name),
        updated_at = now()
      WHERE id = r.dst_id;
    ELSIF p_mode = 'source_wins' THEN
      UPDATE article_supplier SET
        last_price = r.s_price, supplier_code = r.s_code, purchase_format_id = r.s_fmt,
        supplier_item_name = r.s_name, updated_at = now()
      WHERE id = r.dst_id;
    END IF;
    DELETE FROM article_supplier WHERE id = r.src_id;
    v_merged := v_merged + 1;
  END LOOP;

  UPDATE article_supplier SET supplier_id = p_target, updated_at = now()
  WHERE supplier_id = p_source;
  GET DIAGNOSTICS v_moved = ROW_COUNT;

  RETURN QUERY SELECT v_moved, v_merged, v_affected;
END; $function$;

CREATE OR REPLACE FUNCTION public.preview_supplier_migration(p_source uuid, p_target uuid)
 RETURNS TABLE(origen_total integer, colisiones integer, migran_limpio integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_acc uuid;
BEGIN
  SELECT s1.account_id INTO v_acc
  FROM supplier s1 JOIN supplier s2 ON s2.id = p_target
  WHERE s1.id = p_source AND s1.account_id = s2.account_id;
  IF v_acc IS NULL THEN RAISE EXCEPTION 'Proveedores inválidos o de cuentas distintas'; END IF;
  IF NOT (v_acc = ANY (current_user_account_ids())) THEN RAISE EXCEPTION 'Sin permiso sobre esta cuenta'; END IF;
  -- ENCARGO CODE (15/08) feat/ficha-por-producto, Tramo F -- "colision"
  -- tiene que significar lo mismo aqui que en migrate_supplier_articles:
  -- mismo recipe_item_id Y mismo supplier_code (NULL casa con NULL). Antes
  -- contaba colision con que coincidiera solo el articulo, lo que ahora
  -- sobra-cuenta: dos fichas del mismo articulo con codigos distintos
  -- migran limpias, no colisionan.
  RETURN QUERY
  WITH origen AS (SELECT recipe_item_id, supplier_code FROM article_supplier WHERE supplier_id = p_source),
       destino AS (SELECT recipe_item_id, supplier_code FROM article_supplier WHERE supplier_id = p_target)
  SELECT (SELECT count(*) FROM origen)::int,
         (SELECT count(*) FROM origen o WHERE EXISTS (
            SELECT 1 FROM destino d WHERE d.recipe_item_id = o.recipe_item_id
              AND d.supplier_code IS NOT DISTINCT FROM o.supplier_code))::int,
         (SELECT count(*) FROM origen o WHERE NOT EXISTS (
            SELECT 1 FROM destino d WHERE d.recipe_item_id = o.recipe_item_id
              AND d.supplier_code IS NOT DISTINCT FROM o.supplier_code))::int;
END; $function$;
