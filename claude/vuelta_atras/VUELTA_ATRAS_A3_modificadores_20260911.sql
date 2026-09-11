-- ═══════════════════════════════════════════════════════════════════════════
-- VUELTA ATRÁS DE A3 · adaptadores de pedidos · 11/09/2026
--
-- CÓMO SE USA: se aplica tal cual, de una vez. Tarda un segundo. Si algo no
-- cuadra, NO escribe nada: aborta y lo dice.
--
-- QUÉ HACE: deshace el parche de A3 (20260911103139) en los dos adaptadores y
-- los deja EXACTAMENTE como estaban a las 12:31 de hoy, comprobado por huella:
--
--     adapt_lastapp_order   68b39f19be47ef8477bc883430ba489d
--     adapt_hubrise_order   4630f094dc4e153939943d7f4285a6f6
--
-- No se fía del repositorio (B88): trabaja sobre el `prosrc` vivo y rehace el
-- bloque de búsqueda que A3 quitó. Y al final COMPRUEBA la huella de los dos
-- cuerpos: si no coincide con la de antes, hace RAISE y no se queda a medias.
--
-- LO QUE NO TOCA, y es a propósito:
--   · `resolver_opcion_de_extra` y `_extra_nombre_normalizado` se quedan. No
--     las llama nadie después de esto, y borrarlas sería cambiar más cosas en
--     un momento en el que se quiere cambiar exactamente una.
--   · El CHECK de A3b se queda ancho. Un motivo de más que nadie escribe no
--     hace daño; estrecharlo otra vez sí puede, porque habría que comprobar
--     antes que ninguna fila lo usa ya.
--   · `pos_modifier_id` se queda. Es un dato, no un comportamiento.
--
-- LO QUE SE PIERDE al volver atrás, dicho para decidir con los ojos abiertos:
-- las líneas de extra vuelven a enlazarse por nombre en TODA la cuenta con
-- `LIMIT 1` sin orden, vuelven a decir 'pos' aunque hayan casado por nombre, y
-- vuelven a quedarse sin motivo cuando no casan.
-- ═══════════════════════════════════════════════════════════════════════════

DO $vuelta$
DECLARE
  v_fn text; v_ref text; v_src text; v_def text; v_l text[];
  i1 int; i2 int; k int; v_nuevo text; v_ind text; v_eol text; v_viejo text;
  v_esperada text; v_real text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['adapt_lastapp_order','adapt_hubrise_order'] LOOP
    SELECT pp.prosrc, pg_get_functiondef(pp.oid) INTO v_src, v_def
      FROM pg_proc pp JOIN pg_namespace nn ON nn.oid=pp.pronamespace
     WHERE nn.nspname='public' AND pp.proname=v_fn;

    IF v_src NOT LIKE '%resolver_opcion_de_extra%' THEN
      RAISE NOTICE '% ya está en la versión de antes: no se toca', v_fn;
      CONTINUE;
    END IF;

    v_ref := CASE v_fn WHEN 'adapt_lastapp_order'
             THEN $x$nullif(v_mod->>'organizationModifierId','')$x$ ELSE $x$nullif(v_mod->>'ref','')$x$ END;
    v_eol := CASE WHEN position(E'\r' in v_src) > 0 THEN E'\r' ELSE '' END;
    v_l := regexp_split_to_array(v_src, E'\n');

    -- las dos llamadas que metió A3
    i1 := NULL; i2 := NULL;
    FOR k IN 1..array_length(v_l,1) LOOP
      IF btrim(v_l[k], E' \t\r') = 'SELECT x.option_id, x.como INTO v_mod_opt, v_mod_como' THEN
        IF i1 IS NULL THEN i1 := k; ELSIF i2 IS NULL THEN i2 := k; END IF;
      END IF;
    END LOOP;
    IF i1 IS NULL OR i2 IS NULL THEN
      RAISE EXCEPTION 'vuelta atrás: en % no encuentro las DOS llamadas (i1=%, i2=%)', v_fn, i1, i2;
    END IF;

    FOREACH k IN ARRAY ARRAY[i2, i1] LOOP
      v_nuevo := array_to_string(v_l[k : k+4], E'\n');   -- la llamada ocupa 5 líneas
      v_ind   := substring(v_l[k] from '^ *');
      -- el bloque de búsqueda tal y como estaba, con la sangría de este sitio
      v_viejo :=
           v_ind||'v_mod_opt := NULL;'||v_eol||E'\n'
        || v_ind||'IF v_menu IS NOT NULL'||CASE WHEN v_fn='adapt_hubrise_order'
              THEN ' AND nullif(v_mod->>''ref'','''') IS NOT NULL' ELSE '' END||' THEN'||v_eol||E'\n'
        || v_ind||'  SELECT mo.id INTO v_mod_opt'||v_eol||E'\n'
        || v_ind||'  FROM modifier_group_assignment mga'||v_eol||E'\n'
        || v_ind||'  JOIN modifier_option mo ON mo.modifier_group_id = mga.modifier_group_id'||v_eol||E'\n'
        || v_ind||'  WHERE mga.menu_item_id = v_menu'||v_eol||E'\n'
        || v_ind||'    AND mo.external_id = ('||CASE WHEN v_fn='adapt_hubrise_order'
              THEN 'v_mod->>''ref''' ELSE 'v_mod->>''organizationModifierId''' END||')'||v_eol||E'\n'
        || v_ind||'  LIMIT 1;'||v_eol||E'\n'
        || v_ind||'END IF;'||v_eol||E'\n'
        || v_ind||'IF v_mod_opt IS NULL THEN'||v_eol||E'\n'
        || v_ind||'  v_norm := regexp_replace(regexp_replace(btrim(lower(public.unaccent(coalesce(v_mod->>''name'','''')))),''\.$'',''''),''\s+'','' '',''g'');'||v_eol||E'\n'
        || v_ind||'  SELECT mo.id INTO v_mod_opt FROM modifier_option mo'||v_eol||E'\n'
        || v_ind||'  WHERE mo.account_id = v_acc'||v_eol||E'\n'
        || v_ind||'    AND regexp_replace(regexp_replace(btrim(lower(public.unaccent(mo.name))),''\.$'',''''),''\s+'','' '',''g'') = v_norm'||v_eol||E'\n'
        || v_ind||'  LIMIT 1;'||v_eol||E'\n'
        || v_ind||'END IF;'||v_eol;
      IF (length(v_def)-length(replace(v_def, v_nuevo, '')))/length(v_nuevo) <> 1 THEN
        RAISE EXCEPTION 'vuelta atrás: la llamada de % en la línea % no aparece una sola vez', v_fn, k;
      END IF;
      v_def := replace(v_def, v_nuevo, v_viejo);
    END LOOP;

    v_def := replace(v_def, 'v_mod_opt     uuid;'||v_eol||E'\n  v_mod_como    text;', 'v_mod_opt     uuid;');
    -- ── LA LISTA DE COLUMNAS, SOLO LA DE LOS EXTRAS ──────────────────────
    -- Aqui estaba el fallo de la primera version de esta vuelta atras, y se
    -- deja escrito: `map_source, map_needs_review, unmapped_reason, ...`
    -- aparece TRES veces, porque la insercion de PRODUCTO ya la llevaba desde
    -- antes de A3. Un `replace` a secas se la quitaba tambien, y devolvia una
    -- funcion que NO era la de antes —lo canto la huella, que por eso esta—.
    -- Se ancla a la linea de encima, `modifier_option_id,`, que solo tienen
    -- las dos inserciones de extra. El regexp vale para las dos sangrias y
    -- para CRLF.
    IF (SELECT count(*) FROM regexp_matches(v_def,
          '(modifier_option_id,\r?\n\s*map_source, map_needs_review), unmapped_reason,', 'g')) <> 2 THEN
      RAISE EXCEPTION 'vuelta atras: en % la lista de columnas de extra no aparece 2 veces', v_fn;
    END IF;
    v_def := regexp_replace(v_def,
      '(modifier_option_id,\r?\n\s*map_source, map_needs_review), unmapped_reason,', '\1,', 'g');
    v_def := replace(v_def, $y$COALESCE(v_mod_como, 'unmapped'),$y$,
                            $y$CASE WHEN v_mod_opt IS NOT NULL THEN 'pos' ELSE 'unmapped' END,$y$);
    v_def := replace(v_def, $y$(v_mod_opt IS NULL), CASE WHEN v_mod_opt IS NULL THEN 'extra_desconocido' END, $y$,
                            '(v_mod_opt IS NULL), ');
    EXECUTE v_def;

    v_esperada := CASE v_fn WHEN 'adapt_lastapp_order' THEN '68b39f19be47ef8477bc883430ba489d'
                                                       ELSE '4630f094dc4e153939943d7f4285a6f6' END;
    SELECT md5(pp.prosrc) INTO v_real FROM pg_proc pp JOIN pg_namespace nn ON nn.oid=pp.pronamespace
     WHERE nn.nspname='public' AND pp.proname=v_fn;
    IF v_real <> v_esperada THEN
      RAISE EXCEPTION 'vuelta atrás: % NO ha quedado como estaba. Huella %, esperaba %',
        v_fn, v_real, v_esperada;
    END IF;
    RAISE NOTICE '% restaurada, huella % correcta', v_fn, v_real;
  END LOOP;
END
$vuelta$;
