-- ============================================================================
-- LA GUARDA DEL CONSUMO, EN FORMA FV001 · 16/09/2026
--
-- Sustituye la guarda de las 19:14 (`20260916171431`) por la forma que pidió
-- Julio: el cuerpo de siempre, LITERAL Y UNA SOLA VEZ, dentro de un bloque con
-- EXCEPTION. Si al final lo escrito es idéntico a lo que había, un error propio
-- —SQLSTATE FV001— deshace la subtransacción entera: mismos identificadores,
-- 0 filas nuevas, caché incluida. Si difiere, se queda como hoy.
--
-- RETIRA LA DEUDA DECLARADA aquel día: el cálculo del escandallo ya no está dos
-- veces. El cuerpo baja de 21.573 a 17.833 caracteres y el trozo duplicado
-- —`mov_previstos`, `mov_actuales`, `nota_previstas`, `nota_actuales`— se va
-- entero. Ya no hay dos cálculos que puedan separarse con el tiempo.
--
-- CÓMO SE APLICA: igual que la anterior, sobre el cuerpo que hay EN PRODUCCIÓN,
-- leído de pg_proc. Nadie transcribe 16.402 caracteres a mano. Cada ancla se
-- cuenta antes de tocar y si no aparece exactamente una vez, la migración
-- aborta.
--
-- `NOT v_legacy` EN LA CONDICIÓN, y es mío, no del bloque que me pasaste: la
-- huella solo mira lo que cuelga de la VENTA, y en una venta por debajo del
-- corte del motor viejo esta función también borra lo que cuelga de la LÍNEA
-- —líneas 203-210—, que la huella no ve. Sin esa exclusión, una venta vieja con
-- duplicados por línea daría huella igual, saltaría FV001 y se desharía
-- justo el borrado que arregla el duplicado. Es la misma exclusión que ya
-- tenía la guarda de las 19:14 (`IF NOT v_legacy THEN`).
--
-- EL NÚMERO QUE DEVUELVE: `RETURN count(*)`, tal cual lo escribiste. Lo mido
-- porque cambia en un caso real: en G979 —anulada, con su único movimiento
-- protegido por un corte— el cuerpo escribe 0 y la venta TIENE 1.
--   · con `count` (lo aplicado) .... 1, que es exactamente lo que devuelve hoy
--                                    producción por la rama «igual» de la
--                                    guarda de las 19:14. No cambia nada.
--   · con `v_written` ............. 0, que es lo que devolvía el original de
--                                    antes de cualquier guarda.
-- Lo usan cuatro llamadores y los cuatro lo suman a un contador de informe
-- (`cron_recompute_missing_sale_consumption`, `recompute_sales_consumption`,
-- `recost_sales_for_product`, `tg_sale_line_consumption`); los otros tres van
-- por `PERFORM`. No decide ninguna escritura.
--
-- EL COSTE, medido sobre G190, 5 llamadas cada uno, en transacción revertida:
--   guarda de las 19:14 .... 17,7 ms por llamada
--   FV001 .................. 46,6 ms por llamada
-- Son 29 ms más, y hay que decir de dónde salen: la guarda vieja comparaba
-- ANTES y se iba sin trabajar; FV001 hace el trabajo entero y lo deshace. O
-- sea, FV001 cuesta lo que costaba el original de siempre, y lo que se pierde
-- es un atajo que la vieja había ganado. Un cierre son dos llamadas: 93 ms
-- frente a 35.
--
-- VOLVER ATRÁS, en una sentencia, y sin cirugía de texto: la migración guarda
-- el cuerpo de producción de hoy en `_backup_gsc_20260916_fv001` ANTES de
-- tocarlo. Está al final, comentado. (El vuelta-atrás textual de la migración
-- anterior, por cierto, NO funcionaba: su expresión regular esperaba dos
-- saltos de línea donde había tres, y no quitaba nada. Se vio al ir a usarlo.)
--
-- LAS SEIS PRUEBAS, sobre una copia `_gsc_fv001_ensayo` idéntica, cada una en
-- su bloque, midiendo en sentencias aparte y revirtiendo con RAISE:
--   1 sin cambios (G190) ......... devuelve 27 · 27/27 movimientos · huella
--                                  igual · MISMOS identificadores (0 nuevas)
--   2 coste cambiado (G190) ...... huella distinta · identificadores nuevos ·
--                                  27/27 · unit_cost 0,004821 -> 0,007232,
--                                  que es el que se puso en la ficha
--   3 ficha cambiada (G190) ...... cantidad −300 -> −600 · huella distinta · 27
--   4 anulada con corte (G979) ... 1/1 movimientos · MISMOS identificadores ·
--                                  devuelve 1, igual que hoy
--   5 bajo el corte (G645) ....... misma huella 7b670658a7f737ee0399ca292bd6
--                                  f005 y 10 movimientos con la guarda de hoy
--                                  Y con FV001. Idéntico.
--   6 anulada libre (fabricado) .. 27 -> 0 -> 0, devuelve 0 y 0
-- La 6 sigue fabricada y se dice: no hay en la población ni una venta anulada
-- con sus movimientos libres de corte, así que se anula G190 y se le mueve la
-- fecha por encima de todos los cortes para poder probarlo.
--
-- ⚠️ SE APLICA DENTRO DE LA BANDA DE SERVICIO (20:0x de Madrid) y esto SÍ está
-- en el camino del pedido: lo llama `close_sale`. Autorizado explícitamente por
-- Julio: «aplica cada pieza en cuanto pase su prueba, aunque haya servicio».
-- Un `create or replace` de función no toma cierre sobre ninguna tabla.
-- ============================================================================

create table if not exists public._backup_gsc_20260916_fv001(
  guardado_at timestamptz not null default now(),
  proname     text        not null,
  prosrc      text        not null
);

CREATE OR REPLACE FUNCTION public._huella_consumo(p_sale_id uuid)
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(
    coalesce((SELECT string_agg(concat_ws('|', recipe_item_id, sale_line_id, location_id,
                     movement_type, qty_base, unit_cost, source_type, occurred_at, notes),
                     ',' ORDER BY recipe_item_id, sale_line_id, qty_base)
                FROM public.stock_movement
               WHERE source_type = 'sale' AND source_id = p_sale_id
                 AND movement_type = 'consumo'), '')
    || '#' ||
    coalesce((SELECT string_agg(concat_ws('|', recipe_item_id, corte, motivo),
                     ',' ORDER BY recipe_item_id)
                FROM public.sale_consumption_skip
               WHERE sale_id = p_sale_id), '')
  );
$$;

do $migracion$
declare
  v_src text; v_n int; p1 int; p2 int;
  v_abre text := $abre$

  -- ══ LA HUELLA DE ANTES · FV001 · 16/09/2026 ══
  v_huella_antes := public._huella_consumo(p_sale_id);

  BEGIN$abre$;
  v_cierra text := $cierra$
  -- ══ SI NADA HA CAMBIADO, SE DESHACE EL BLOQUE ENTERO · FV001 ══
  -- El cuerpo de arriba es el de siempre, literal y una sola vez. Si lo que ha
  -- quedado escrito es identico a lo que habia, este error propio deshace la
  -- subtransaccion entera: mismos identificadores, 0 filas nuevas, cache
  -- incluida.
  -- NOT v_legacy: la huella solo mira lo que cuelga de la VENTA, y en una venta
  -- vieja esta funcion tambien borra lo que cuelga de la LINEA, que la huella
  -- no ve. Donde no puede ver, no decide. (La misma exclusion que tenia la
  -- guarda de las 19:14.)
  v_huella_despues := public._huella_consumo(p_sale_id);
  IF NOT v_legacy AND v_huella_despues = v_huella_antes THEN
    RAISE EXCEPTION USING ERRCODE = 'FV001', MESSAGE = 'consumo sin cambios';
  END IF;
  EXCEPTION
    WHEN SQLSTATE 'FV001' THEN
      NULL;
  END;

  -- El numero que ven los siete llamadores: lo que la venta TIENE. Es el mismo
  -- que devolvia la guarda de las 19:14 cuando no habia nada que cambiar, y
  -- ahora se devuelve siempre, que es lo que pedia el bloque.
  RETURN (SELECT count(*)::int FROM public.stock_movement sm
           WHERE sm.account_id = v_sale.account_id AND sm.movement_type = 'consumo'
             AND sm.source_type = 'sale' AND sm.source_id = p_sale_id);$cierra$;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='generate_sale_consumption';
  if v_src is null then raise exception 'no existe generate_sale_consumption'; end if;
  if position('FV001' in v_src) > 0 then
    raise notice 'FV001 ya estaba puesta: no se toca'; return;
  end if;

  insert into public._backup_gsc_20260916_fv001(proname, prosrc)
  values ('generate_sale_consumption', v_src);

  -- 1 · se retira la guarda de las 19:14
  p1 := position('  -- ══ GUARDA DE IDEMPOTENCIA' in v_src);
  p2 := position('  IF array_length(v_previos, 1) IS NOT NULL THEN' in v_src);
  if p1 = 0 or p2 = 0 or p1 >= p2 then raise exception 'no se localiza la guarda (%, %)', p1, p2; end if;
  if position('mov_previstos' in substr(v_src, p1, p2-p1)) = 0 then
    raise exception 'el trozo que iba a quitar no es la guarda';
  end if;
  v_n := (length(v_src) - length(replace(v_src, '  IF array_length(v_previos, 1) IS NOT NULL THEN','')))
         / length('  IF array_length(v_previos, 1) IS NOT NULL THEN');
  if v_n <> 1 then raise exception 'el ancla de la guarda aparece % veces', v_n; end if;
  v_src := substr(v_src, 1, p1-1) || substr(v_src, p2);
  v_src := replace(v_src, chr(10) || '  v_igual      boolean;', '');
  if position('GUARDA DE IDEMPOTENCIA' in v_src) > 0 or position('mov_previstos' in v_src) > 0
     or position('v_igual' in v_src) > 0 then
    raise exception 'la retirada no dejo limpio el cuerpo';
  end if;

  -- 2 · las dos huellas
  v_src := replace(v_src, '  v_item       uuid;',
    '  v_item       uuid;' || chr(10) || '  v_huella_antes   text;' || chr(10) || '  v_huella_despues text;');

  -- 3 · se abre el bloque justo despues del unico RETURN que sale sin tocar nada
  v_n := (length(v_src) - length(replace(v_src, '  IF NOT FOUND THEN RETURN 0; END IF;','')))
         / length('  IF NOT FOUND THEN RETURN 0; END IF;');
  if v_n <> 1 then raise exception 'el ancla de apertura aparece % veces', v_n; end if;
  v_src := replace(v_src, '  IF NOT FOUND THEN RETURN 0; END IF;',
                          '  IF NOT FOUND THEN RETURN 0; END IF;' || v_abre);

  -- 4 · se cierra en el unico RETURN que sale DESPUES de escribir
  v_n := (length(v_src) - length(replace(v_src, chr(10) || '  RETURN v_written;','')))
         / length(chr(10) || '  RETURN v_written;');
  if v_n <> 1 then raise exception 'el ancla de cierre aparece % veces', v_n; end if;
  v_src := replace(v_src, chr(10) || '  RETURN v_written;', chr(10) || v_cierra);

  execute format(
    'create or replace function public.generate_sale_consumption(p_sale_id uuid) returns integer '
    || 'language plpgsql security definer set search_path = public as %L', v_src);
end $migracion$;

-- La copia de ensayo se va con la misma migración que aplica lo ensayado.
drop function if exists public._gsc_fv001_ensayo(uuid);

-- ── VOLVER ATRÁS, en una sentencia ──────────────────────────────────────────
-- do $vuelta$
-- begin
--   execute format(
--     'create or replace function public.generate_sale_consumption(p_sale_id uuid) '
--     || 'returns integer language plpgsql security definer set search_path = public as %L',
--     (select prosrc from public._backup_gsc_20260916_fv001
--       where proname = 'generate_sale_consumption' order by guardado_at desc limit 1));
-- end $vuelta$;
