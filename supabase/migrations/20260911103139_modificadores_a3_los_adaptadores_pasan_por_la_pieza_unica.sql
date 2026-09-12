-- ═══════════════════════════════════════════════════════════════════════════
-- MODIFICADORES · A3 — los adaptadores dejan de buscar a ciegas, y cada linea
--                      de extra dice CÓMO se enlazo
--
-- Se parchea sobre el `prosrc` VIVO y no sobre el .sql del repositorio (B88):
-- el fichero puede estar por detras de lo desplegado, y reescribir la funcion
-- desde el fichero se llevaria por delante lo que haya encima.
--
-- ── Lo que cambia en cada adaptador ──────────────────────────────────────
--
--   · Fuera la busqueda por nombre EN TODA LA CUENTA con `LIMIT 1` sin orden.
--     Entra `resolver_opcion_de_extra`, que busca por codigo en el plato, por
--     codigo en la cuenta con desempate fijo, y por nombre SOLO en la marca.
--   · `map_source` pasa a decir la verdad: 'pos' si caso por codigo, 'fuzzy'
--     si caso por nombre, 'unmapped' si no caso.
--   · `unmapped_reason` deja de ir SIEMPRE en blanco: una linea sin enlazar
--     se queda con 'extra_desconocido'. Hasta hoy las 36 que hay no decian
--     por que, y por eso nadie volvia a mirarlas.
--
-- OJO: ese valor NO estaba en `sale_line_unmapped_reason_valid`, que es un
-- CHECK con lista cerrada. Se arregla en A3b (20260911103232), 53 segundos
-- despues. Entre las dos, un pedido con un extra sin enlazar habria reventado.
-- Esta migracion se queda como se aplico, con el fallo a la vista.
--
-- ── DOS BLOQUES POR FUNCION, no uno ──────────────────────────────────────
-- Cada adaptador resuelve modificadores DOS veces: una para la linea de
-- producto y otra para los hijos de un combo. Se vio contando las anclas, no
-- leyendo: `v_mod_opt := NULL;` sale dos veces en cada funcion. Parchear solo
-- la primera habria dejado los extras de los combos con la busqueda a ciegas,
-- y eso no lo habria notado nadie hasta que fallara.
--
-- Y `adapt_hubrise_order` tiene finales de linea CRLF mientras que
-- `adapt_lastapp_order` los tiene LF. Por eso el corte de bloques se hace
-- por lineas con `btrim(..., E' \t\r')` y no con un `replace` de texto: con
-- LF a secas, en HubRise no casaba nada y el parche habria pasado de largo
-- sin tocar nada y sin quejarse.
--
-- ── Ensayo sobre 45 ventas REALES, en transaccion deshecha ───────────────
--   cedidas/lastapp   17 lineas · enlazadas 13→17 · por codigo 13→17
--   propias/hubrise   25 lineas · enlazadas 25→25 · por codigo 25→25
--   propias/lastapp   25 lineas · enlazadas 25→25 · 'pos' 25→0, 'fuzzy' 0→25
-- Ninguna linea se pierde ni se duplica. Las propias por HubRise salen
-- IDENTICAS. Y las propias con origen «lastapp» dejan de afirmar que casaron
-- por codigo, que es la mentira que habia en la columna.
--
-- Lo que ese ensayo NO probo, y costo A3b: en esas 45 ventas no habia ni una
-- linea sin enlazar, asi que el camino de `extra_desconocido` no se ejecuto.
-- ═══════════════════════════════════════════════════════════════════════════

DO $parche$
DECLARE
  v_fn text; v_ref text; v_src text; v_def text; v_l text[];
  i1 int; i2 int; j1 int; j2 int; k int;
  v_b text; v_new text; v_ind text; v_eol text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['adapt_lastapp_order','adapt_hubrise_order'] LOOP
    SELECT pp.prosrc, pg_get_functiondef(pp.oid) INTO v_src, v_def
      FROM pg_proc pp JOIN pg_namespace nn ON nn.oid=pp.pronamespace
     WHERE nn.nspname='public' AND pp.proname=v_fn;

    IF v_src LIKE '%resolver_opcion_de_extra%' THEN
      RAISE NOTICE '% ya pasa por la pieza unica: no se toca', v_fn;
      CONTINUE;
    END IF;

    v_ref := CASE v_fn WHEN 'adapt_lastapp_order'
             THEN $x$nullif(v_mod->>'organizationModifierId','')$x$ ELSE $x$nullif(v_mod->>'ref','')$x$ END;
    v_eol := CASE WHEN position(E'\r' in v_src) > 0 THEN E'\r' ELSE '' END;
    v_l := regexp_split_to_array(v_src, E'\n');

    i1 := NULL; i2 := NULL; j1 := NULL; j2 := NULL;
    FOR k IN 1..array_length(v_l,1) LOOP
      IF btrim(v_l[k], E' \t\r') = 'v_mod_opt := NULL;' THEN
        IF i1 IS NULL THEN i1 := k; ELSIF i2 IS NULL THEN i2 := k; END IF;
      END IF;
    END LOOP;
    IF i1 IS NULL OR i2 IS NULL THEN
      RAISE EXCEPTION 'A3: en % no encuentro los DOS bloques de modificadores (i1=%, i2=%)', v_fn, i1, i2;
    END IF;
    FOR k IN i1..array_length(v_l,1) LOOP
      IF btrim(v_l[k],E' \t\r')='END IF;' AND btrim(COALESCE(v_l[k+1],''),E' \t\r')=''
         AND btrim(COALESCE(v_l[k+2],''),E' \t\r') LIKE 'INSERT INTO sale_line%' THEN j1:=k; EXIT; END IF;
    END LOOP;
    FOR k IN i2..array_length(v_l,1) LOOP
      IF btrim(v_l[k],E' \t\r')='END IF;' AND btrim(COALESCE(v_l[k+1],''),E' \t\r')=''
         AND btrim(COALESCE(v_l[k+2],''),E' \t\r') LIKE 'INSERT INTO sale_line%' THEN j2:=k; EXIT; END IF;
    END LOOP;
    IF j1 IS NULL OR j2 IS NULL THEN
      RAISE EXCEPTION 'A3: en % no encuentro el final de los bloques', v_fn;
    END IF;

    -- de abajo arriba, para que los indices del primero sigan valiendo
    FOREACH k IN ARRAY ARRAY[i2, i1] LOOP
      v_b   := array_to_string(v_l[k : CASE WHEN k=i1 THEN j1 ELSE j2 END], E'\n');
      v_ind := substring(v_l[k] from '^ *');
      v_new := v_ind||'SELECT x.option_id, x.como INTO v_mod_opt, v_mod_como'||v_eol||E'\n'
            || v_ind||'  FROM public.resolver_opcion_de_extra('||v_eol||E'\n'
            || v_ind||'         v_acc, v_menu,'||v_eol||E'\n'
            || v_ind||'         COALESCE((SELECT mi.brand_id FROM public.menu_item mi WHERE mi.id = v_menu), v_sale.brand_id),'||v_eol||E'\n'
            || v_ind||'         '||v_ref||', v_mod->>''name'', '''||replace(replace(v_fn,'adapt_',''),'_order','')||''') x;'||v_eol;
      IF (length(v_def)-length(replace(v_def, v_b, '')))/length(v_b) <> 1 THEN
        RAISE EXCEPTION 'A3: el bloque de % que empieza en la linea % no aparece exactamente una vez', v_fn, k;
      END IF;
      v_def := replace(v_def, v_b, v_new);
    END LOOP;

    IF (length(v_def)-length(replace(v_def,'v_mod_opt     uuid;','')))/length('v_mod_opt     uuid;') <> 1 THEN
      RAISE EXCEPTION 'A3: en % la declaracion de v_mod_opt no es unica', v_fn;
    END IF;
    v_def := replace(v_def,'v_mod_opt     uuid;','v_mod_opt     uuid;'||v_eol||E'\n  v_mod_como    text;');

    IF (length(v_def)-length(replace(v_def,'map_source, map_needs_review, parent_sale_line_id,','')))
       /length('map_source, map_needs_review, parent_sale_line_id,') <> 2 THEN
      RAISE EXCEPTION 'A3: en % la lista de columnas de extra no aparece 2 veces', v_fn;
    END IF;
    v_def := replace(v_def,'map_source, map_needs_review, parent_sale_line_id,',
                           'map_source, map_needs_review, unmapped_reason, parent_sale_line_id,');

    IF (length(v_def)-length(replace(v_def,$y$CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,$y$,'')))
       /length($y$CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,$y$) <> 2 THEN
      RAISE EXCEPTION 'A3: en % el map_source de extra no aparece 2 veces', v_fn;
    END IF;
    v_def := replace(v_def,$y$CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,$y$,
                           $y$COALESCE(v_mod_como, 'unmapped'),$y$);

    IF (length(v_def)-length(replace(v_def,'(v_mod_opt IS NULL), ','')))/length('(v_mod_opt IS NULL), ') <> 2 THEN
      RAISE EXCEPTION 'A3: en % el map_needs_review de extra no aparece 2 veces', v_fn;
    END IF;
    v_def := replace(v_def,'(v_mod_opt IS NULL), ',
                     $y$(v_mod_opt IS NULL), CASE WHEN v_mod_opt IS NULL THEN 'extra_desconocido' END, $y$);

    EXECUTE v_def;
  END LOOP;

  -- ── La comprobacion va DENTRO de la migracion, no despues ──────────────
  -- La leccion de p21: mirar el resultado cuando ya has hecho COMMIT es tarde.
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('adapt_lastapp_order','adapt_hubrise_order')
         AND p.prosrc LIKE '%resolver_opcion_de_extra%') <> 2 THEN
    RAISE EXCEPTION 'A3: alguna funcion no ha quedado apuntando a la pieza unica';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('adapt_lastapp_order','adapt_hubrise_order')
         AND p.prosrc LIKE '%SELECT mo.id INTO v_mod_opt FROM modifier_option mo%') <> 0 THEN
    RAISE EXCEPTION 'A3: queda alguna busqueda por nombre en toda la cuenta';
  END IF;
END
$parche$;
