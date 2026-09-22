-- ============================================================================
-- El combo se casa por su id, no por su nombre
-- ----------------------------------------------------------------------------
-- 22/09/2026. Cuenta Foodint 51ad1792-6629-4ef7-833a-b57b09a86710.
-- PROPUESTA. NO APLICADA. Es el camino del pedido: fuera de servicio.
--
-- ── LO QUE PASABA ─────────────────────────────────────────────────────────
-- Last SI manda el id del combo. `adapt_lastapp_order` lee
-- `organizationProductId`, y para un COMBO ese campo viene a null POR DISENO
-- —un combo no es un producto—: el id viaja en `organizationComboId`.
-- Resultado: los combos se casaban SOLO por nombre, y cada vez que el canal
-- renombra un producto se abre un agujero que dura hasta que alguien crea el
-- articulo a mano (y deja un duplicado en la carta).
--
-- Medido sobre el payload crudo de 30 dias:
--   PRODUCT  3.696 productos · 3.678 con organizationProductId · 0 con comboId
--   COMBO      747 productos ·     0 con organizationProductId · 744 con comboId
--
-- ── LO QUE **NO** VALE, y casi lo meto ────────────────────────────────────
-- `catalogProductId` viene en el 100 % de las lineas y parece el mejor
-- candidato. NO LO ES: es OTRO espacio de ids. Medido contra la carta,
-- **0 de 75 combos casan por `catalogProductId`** y **61 de 75 casan por
-- `organizationComboId`**. Meterlo en el coalesce no habria roto nada hoy,
-- pero habria dejado puesta una trampa para el dia que dos espacios de id
-- colisionen. Fuera.
--
-- ── LO QUE ESTE ARREGLO **NO** HACE, y hay que decirlo ────────────────────
-- NO recupera dinero hacia atras. Clasificados los combos de 30 dias:
--   casan por los dos            34 combos · 690 lineas · 16.369,70 EUR
--   solo por nombre               2 combos ·   5 lineas ·    166,50 EUR
--   ni por id ni por nombre       6 combos ·  48 lineas ·  1.071,70 EUR
--   SOLO POR ID                   0 combos
-- Cero. Porque el agujero del «Korean Crispy Menu (Para 2)» fue del 01 al
-- 08/09 y el 09/09 alguien creo el articulo con el nombre nuevo: hoy ya casa
-- por nombre. **El valor de esto es preventivo**: que el PROXIMO cambio de
-- nombre no abra nada. Quien espere ver bajar el aviso manana, no lo vera por
-- esto.
-- (Los 6 combos / 1.071,70 EUR que no casan por nada necesitan articulo de
--  carta. Eso es otra cosa y no lo arregla el adaptador.)
--
-- ── EL CAMBIO, en dos sitios ──────────────────────────────────────────────
-- 1. La matricula del padre sale de organizationProductId O DE
--    organizationComboId, lo que venga.
-- 2. El combo intenta casar POR ID primero y por nombre despues. Hoy solo
--    habia nombre.
-- Todo lo demas —los hijos, los modificadores, la deduccion de marca— queda
-- byte a byte igual.
-- ============================================================================

begin;

-- ── Guarda 1: el servicio esta parado ─────────────────────────────────────
do $$
declare v_p integer;
begin
  select count(*) into v_p from public.sale
   where account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
     and sold_at >= now() - interval '30 minutes';
  if v_p > 0 then
    raise exception 'ABORTA: % (Madrid) y % pedidos en los ultimos 30 min. adapt_lastapp_order es el camino del pedido.',
      to_char(now() at time zone 'Europe/Madrid','HH24:MI'), v_p;
  end if;
end $$;

-- ── Guarda 2: la funcion es la que lei el 22/09 ───────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='adapt_lastapp_order'
       and pg_get_functiondef(p.oid) like '%v_matricula := nullif(v_elem->>''organizationProductId'','''');%')
  then raise exception 'ABORTA: adapt_lastapp_order no tiene la forma que se leyo el 22/09.'; end if;
end $$;

-- ── Guarda 3: organizationComboId sigue siendo la clave que casa ──────────
do $$
declare v_id integer; v_cat integer;
begin
  with combos as (
    select distinct nullif(prod->>'organizationComboId','') as org_combo_id,
                    nullif(prod->>'catalogProductId','')    as catalog_id
    from public.sale s
    cross join lateral (select public.safe_jsonb(s.raw_tab) as tab) rt
    cross join lateral (select coalesce(rt.tab->'products', rt.tab->'bills'->0->'products') as products) p
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(p.products)='array' then p.products else '[]'::jsonb end) as prod
    where s.account_id='51ad1792-6629-4ef7-833a-b57b09a86710'
      and s.source='lastapp' and s.sold_at >= now() - interval '30 days'
      and prod->>'type'='COMBO'
  )
  select count(*) filter (where exists (select 1 from public.menu_item mi
           where mi.account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and mi.external_id = c.org_combo_id)),
         count(*) filter (where exists (select 1 from public.menu_item mi
           where mi.account_id='51ad1792-6629-4ef7-833a-b57b09a86710' and mi.external_id = c.catalog_id))
    into v_id, v_cat
  from combos c;

  if v_id < 20 then
    raise exception 'ABORTA: solo % combos casan por organizationComboId. La premisa del 22/09 (61) ha cambiado.', v_id;
  end if;
  if v_cat > 0 then
    raise exception 'ABORTA: % combos casan ahora por catalogProductId. El 22/09 eran 0; si los espacios de id se han mezclado, hay que mirarlo antes.', v_cat;
  end if;
end $$;

-- ── EL CAMBIO ─────────────────────────────────────────────────────────────
-- Misma firma, mismo tipo de vuelta: CREATE OR REPLACE correcto (regla 2).
-- Solo se tocan las dos piezas descritas arriba; el resto es el original.
create or replace function public.adapt_lastapp_order(p_sale_id uuid)
 returns integer
 language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_sale        sale%ROWTYPE;
  v_acc         uuid;
  v_brand_ext   text;
  v_elem        jsonb;
  v_mod         jsonb;
  v_comp        jsonb;
  v_parent_id   uuid;
  v_comp_id     uuid;
  v_is_combo    boolean;
  v_menu        uuid;
  v_menu_brand  uuid;
  v_n_match     integer;
  v_matricula   text;
  v_mod_opt     uuid;
  v_mod_como    text;
  v_count       integer := 0;
  v_qty         numeric;
  v_reason      text;
  v_deduced_brand uuid;
  v_deduced_menu  uuid;
BEGIN
  SELECT * INTO v_sale FROM sale WHERE id = p_sale_id;
  IF NOT FOUND THEN RETURN 0; END IF;
  v_acc := v_sale.account_id;
  v_brand_ext := nullif(v_sale.external_brand_text, '');

  IF v_sale.source <> 'lastapp' OR v_sale.raw_products IS NULL THEN RETURN 0; END IF;

  DELETE FROM sale_line
  WHERE sale_id = p_sale_id
    AND coalesce(map_source,'') <> 'manual'
    AND coalesce(unmapped_reason,'') NOT IN ('ignored','delisted');

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_sale.raw_products::jsonb)
  LOOP
    v_is_combo := (jsonb_typeof(v_elem->'comboProducts') = 'array'
                   AND jsonb_array_length(v_elem->'comboProducts') > 0);
    v_qty := COALESCE((v_elem->>'quantity')::numeric, 1);

    -- ── CAMBIO 1 (22/09/2026) ────────────────────────────────────────────
    -- La matricula sale del campo que Last use. Para un PRODUCT es
    -- `organizationProductId`; para un COMBO ese campo viene a null POR
    -- DISENO y el id esta en `organizationComboId`. Medido en 30 dias:
    -- 3.678/3.696 PRODUCT traen el primero, 744/747 COMBO traen el segundo,
    -- y NINGUNO trae los dos, asi que el coalesce no puede coger el que no es.
    -- `catalogProductId` NO entra: es otro espacio de ids (0 de 75 casan).
    v_matricula := coalesce(
                     nullif(v_elem->>'organizationProductId',''),
                     nullif(v_elem->>'organizationComboId','')
                   );

    v_menu := NULL; v_menu_brand := NULL;

    IF NOT v_is_combo THEN
      IF v_matricula IS NOT NULL THEN
        SELECT count(*) INTO v_n_match
        FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
          AND mi.external_id = v_matricula AND mi.archived_at IS NULL;

        IF v_n_match = 1 THEN
          SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
          FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
            AND mi.external_id = v_matricula AND mi.archived_at IS NULL
          LIMIT 1;
        ELSIF v_n_match > 1 THEN
          IF v_sale.brand_id IS NOT NULL THEN
            SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
            FROM menu_item mi
            WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
              AND mi.external_id = v_matricula AND mi.archived_at IS NULL
              AND mi.brand_id = v_sale.brand_id
            LIMIT 1;
          END IF;
        END IF;
      END IF;
    ELSE
      -- ── CAMBIO 2 (22/09/2026) ──────────────────────────────────────────
      -- El combo casa POR ID primero. Antes solo habia nombre, y por eso un
      -- renombrado del canal abria un agujero (el «Korean Crispy Menu (Para
      -- 2) KDB»: 01-08/09, 20 lineas, 718 EUR) que duraba hasta que alguien
      -- creaba el articulo a mano.
      IF v_matricula IS NOT NULL THEN
        SELECT count(*) INTO v_n_match
        FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
          AND mi.external_id = v_matricula AND mi.archived_at IS NULL;

        IF v_n_match = 1 THEN
          SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
          FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
            AND mi.external_id = v_matricula AND mi.archived_at IS NULL
          LIMIT 1;
        ELSIF v_n_match > 1 AND v_sale.brand_id IS NOT NULL THEN
          SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
          FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
            AND mi.external_id = v_matricula AND mi.archived_at IS NULL
            AND mi.brand_id = v_sale.brand_id
          LIMIT 1;
        END IF;
      END IF;

      -- Y el nombre se queda de RED, no de puerta principal. Sigue haciendo
      -- falta: 2 combos de 30 dias casan solo asi.
      IF v_menu IS NULL THEN
        SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand FROM menu_item mi
        WHERE mi.account_id = v_acc AND mi.brand_id = v_sale.brand_id
          AND mi.archived_at IS NULL
          AND lower(public.unaccent(mi.name)) = lower(public.unaccent(coalesce(v_elem->>'name','')))
        LIMIT 1;
      END IF;
    END IF;

    IF v_menu IS NOT NULL THEN
      v_reason := NULL;
    ELSIF v_matricula IS NULL AND NOT v_is_combo THEN
      v_reason := 'no_recipe';
    ELSIF v_is_combo AND v_sale.brand_id IS NULL THEN
      v_reason := 'no_brand';
    ELSE
      v_reason := 'no_menu_item';
    END IF;

    INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                           quantity, unit_price, line_total, menu_item_id,
                           map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                           external_source, external_product_id, external_brand_id)
    VALUES (v_acc, p_sale_id, v_elem->>'name', v_elem->>'name',
            'product', v_qty,
            COALESCE((v_elem->>'price')::numeric,0)/100.0,
            COALESCE((v_elem->>'price')::numeric,0)/100.0 * v_qty,
            v_menu,
            CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
            (v_menu IS NULL), v_reason, NULL,
            'lastapp', v_matricula, v_brand_ext)
    RETURNING id INTO v_parent_id;
    v_count := v_count + 1;

    IF jsonb_typeof(v_elem->'modifiers') = 'array' THEN
      FOR v_mod IN SELECT * FROM jsonb_array_elements(v_elem->'modifiers')
      LOOP
        SELECT x.option_id, x.como INTO v_mod_opt, v_mod_como
          FROM public.resolver_opcion_de_extra(
                 v_acc, v_menu,
                 COALESCE((SELECT mi.brand_id FROM public.menu_item mi WHERE mi.id = v_menu), v_sale.brand_id),
                 nullif(v_mod->>'organizationModifierId',''), v_mod->>'name', 'lastapp') x;

        INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, modifier_option_id,
                               map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                               external_source, external_product_id, external_brand_id)
        VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                COALESCE((v_mod->>'quantity')::numeric,1),
                COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                v_mod_opt,
                COALESCE(v_mod_como, 'unmapped'),
                (v_mod_opt IS NULL), CASE WHEN v_mod_opt IS NULL THEN 'extra_desconocido' END, v_parent_id,
                'lastapp', nullif(v_mod->>'organizationModifierId',''), v_brand_ext);
        v_count := v_count + 1;
      END LOOP;
    END IF;

    IF v_is_combo THEN
      FOR v_comp IN SELECT * FROM jsonb_array_elements(v_elem->'comboProducts')
      LOOP
        v_menu := NULL; v_menu_brand := NULL;
        -- Los hijos SI traen su organizationProductId (medido: todos). No se toca.
        v_matricula := nullif(v_comp->>'organizationProductId','');

        IF v_matricula IS NOT NULL THEN
          SELECT count(*) INTO v_n_match
          FROM menu_item mi
          WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
            AND mi.external_id = v_matricula AND mi.archived_at IS NULL;

          IF v_n_match = 1 THEN
            SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
            FROM menu_item mi
            WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
              AND mi.external_id = v_matricula AND mi.archived_at IS NULL
            LIMIT 1;
          ELSIF v_n_match > 1 AND v_sale.brand_id IS NOT NULL THEN
            SELECT mi.id, mi.brand_id INTO v_menu, v_menu_brand
            FROM menu_item mi
            WHERE mi.account_id = v_acc AND mi.external_source = 'lastapp'
              AND mi.external_id = v_matricula AND mi.archived_at IS NULL
              AND mi.brand_id = v_sale.brand_id
            LIMIT 1;
          END IF;
        END IF;

        IF v_menu IS NOT NULL THEN
          v_reason := NULL;
        ELSIF v_matricula IS NULL THEN
          v_reason := 'no_recipe';
        ELSE
          v_reason := 'no_menu_item';
        END IF;

        INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                               quantity, unit_price, line_total, menu_item_id,
                               map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                               external_source, external_product_id, external_brand_id)
        VALUES (v_acc, p_sale_id, v_comp->>'name', coalesce(v_comp->>'name','combo_item'), 'combo_item',
                COALESCE((v_comp->>'quantity')::numeric,1),
                0, 0, v_menu,
                CASE WHEN v_menu IS NOT NULL THEN 'pos' ELSE 'unmapped' END,
                (v_menu IS NULL), v_reason, v_parent_id,
                'lastapp', v_matricula, v_brand_ext)
        RETURNING id INTO v_comp_id;
        v_count := v_count + 1;

        IF jsonb_typeof(v_comp->'modifiers') = 'array' THEN
          FOR v_mod IN SELECT * FROM jsonb_array_elements(v_comp->'modifiers')
          LOOP
            SELECT x.option_id, x.como INTO v_mod_opt, v_mod_como
              FROM public.resolver_opcion_de_extra(
                     v_acc, v_menu,
                     COALESCE((SELECT mi.brand_id FROM public.menu_item mi WHERE mi.id = v_menu), v_sale.brand_id),
                     nullif(v_mod->>'organizationModifierId',''), v_mod->>'name', 'lastapp') x;

            INSERT INTO sale_line (account_id, sale_id, product_name, raw_text, line_type,
                                   quantity, unit_price, line_total, modifier_option_id,
                                   map_source, map_needs_review, unmapped_reason, parent_sale_line_id,
                                   external_source, external_product_id, external_brand_id)
            VALUES (v_acc, p_sale_id, v_mod->>'name', coalesce(v_mod->>'name','modifier'), 'modifier',
                    COALESCE((v_mod->>'quantity')::numeric,1),
                    COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                    COALESCE((v_mod->>'priceImpact')::numeric,0)/100.0,
                    v_mod_opt,
                    COALESCE(v_mod_como, 'unmapped'),
                    (v_mod_opt IS NULL), CASE WHEN v_mod_opt IS NULL THEN 'extra_desconocido' END, v_comp_id,
                    'lastapp', nullif(v_mod->>'organizationModifierId',''), v_brand_ext);
            v_count := v_count + 1;
          END LOOP;
        END IF;
      END LOOP;

      -- Si el combo padre quedo sin casar, deducir la marca de un hijo casado
      -- y reintentar por nombre. Intacto respecto al original.
      IF v_menu_brand IS NULL THEN
        SELECT mi.brand_id INTO v_deduced_brand
        FROM sale_line child
        JOIN menu_item mi ON mi.id = child.menu_item_id
        WHERE child.parent_sale_line_id = v_parent_id
          AND child.menu_item_id IS NOT NULL
        LIMIT 1;

        IF v_deduced_brand IS NOT NULL THEN
          SELECT mi.id INTO v_deduced_menu
          FROM menu_item mi
          WHERE mi.account_id = v_acc
            AND mi.brand_id = v_deduced_brand
            AND mi.archived_at IS NULL
            AND lower(public.unaccent(mi.name)) = lower(public.unaccent(coalesce(v_elem->>'name','')))
          LIMIT 1;

          IF v_deduced_menu IS NOT NULL THEN
            UPDATE sale_line
            SET menu_item_id = v_deduced_menu,
                map_source = 'pos',
                map_needs_review = false,
                unmapped_reason = NULL
            WHERE id = v_parent_id;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  RETURN v_count;
END;
$function$;

-- ── C1 · Una sola firma (regla 2) ─────────────────────────────────────────
select count(*) as firmas_de_adapt_lastapp_order
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='adapt_lastapp_order';
-- Esperado: 1

-- ── C2 · 🔴 EL ENSAYO, y no es opcional ───────────────────────────────────
-- `adapt_lastapp_order` BORRA y REESCRIBE las lineas de la venta. Ensayarlo es
-- volver a adaptar ventas REALES y comparar el antes y el despues con la misma
-- vara (regla 31). Se hace AQUI DENTRO, antes del commit:
--
--   1. Elegir ~20 ventas de lastapp con combo de los ultimos 7 dias.
--   2. Guardar el ANTES en una tabla temporal: por venta, cuantas lineas,
--      cuantas casadas (menu_item_id not null) y la suma de line_total.
--   3. Pasar public.adapt_lastapp_order(id) por cada una.
--   4. Medir el DESPUES igual y comparar fila a fila.
--
-- QUE TIENE QUE SALIR:
--   · el numero de lineas, IGUAL en todas;
--   · la suma de line_total, IGUAL en todas;
--   · las casadas, IGUAL O MAS. Ni una venta puede perder un casado.
-- Si una sola pierde, NO se hace commit.
--
-- 🔴 Y OJO CON ESTO, que es el riesgo de verdad: re-adaptar una venta BORRA
--    sus sale_line y las vuelve a crear con ids NUEVOS. Eso deja huerfanos los
--    `label_token` de esas ventas (ya medido hoy: 1.949 de 8.473 tokens de
--    toda la tabla apuntan a una linea muerta, justo por esto) y desata los
--    disparadores de consumo. Por eso el ensayo va dentro de la transaccion y
--    termina en rollback, y por eso NO se re-adapta nada en produccion sin
--    decidir antes que pasa con el stock (regla del 18/09).
--
-- Las ventas concretas NO van escritas: cambian cada dia y un ensayo contra
-- filas inventadas no mide nada. Se eligen con la base delante.

rollback;
-- commit;
