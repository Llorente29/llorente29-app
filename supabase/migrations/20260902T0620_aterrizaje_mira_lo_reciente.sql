-- 20260902T0620_aterrizaje_mira_lo_reciente.sql
--
-- UN AVISO PERMANENTE DEJA DE SER UN AVISO.
--
-- Al entrar en la aplicación, si hay algo accionable, se aterriza en Pendientes
-- en vez de en Inicio. La regla es buena y se queda. Lo que no vale es el
-- criterio: `actionableCount > 0` cuenta TODO lo abierto, tenga la edad que
-- tenga, así que basta con una fila vieja que nadie va a cerrar para que la
-- aplicación mande a Pendientes todos los días, para siempre.
--
-- Medido en Foodint el 02/09, y conviene decirlo porque el dato que circulaba
-- era otro: el contador NO son las 66 líneas pendientes de oficina —esas no
-- entran en pending_board, no hay ningún pending_kind que las recoja—. Son 18:
--
--   linea_sin_coste            6   la más vieja del 16/06, 2 de más de 30 días
--   albaran_sin_pedido         4   del 12/08 al 28/08
--   recuento_abierto           3   del 01/09 y 02/09
--   albaran_borrador_atascado  2   del 10/07 y del 31/07, las DOS de más de 30 días
--   recuento_sin_aprobar       1   del 24/08
--   pedido_vencido             1   del 19/08
--   pedido_borrador_atascado   1   del 24/08
--
-- Son OCHO filas viejas —dos borradores de julio y seis líneas sin coste desde
-- junio— las que llevan un mes mandando a Julio a la pantalla equivocada.
--
-- ── POR QUÉ NO BASTA CON MIRAR LA CAPA ─────────────────────────────────────
-- «Que mire lo de ahora y esta semana» suena a que las capas ya lo resuelven,
-- y no: `ahora` y `semana` son clases de URGENCIA, no de antigüedad. Un
-- borrador de albarán atascado desde el 10/07 está en `semana` y es MÁS urgente
-- por viejo, no menos. Filtrar por capa no quita ni una de las ocho.
--
-- ── DÓNDE VA EL UMBRAL, Y DÓNDE NO ─────────────────────────────────────────
-- Regla 7: un umbral ordena, no esconde. La pantalla de Pendientes la abre
-- alguien a propósito y sigue enseñando LAS 18, y el contador de la pestaña
-- sigue diciendo 18 — ahí no se filtra nada. El umbral vive donde toca: en lo
-- que INTERRUMPE, que aquí es secuestrar la pantalla de entrada.
--
-- Esta migración no decide nada: solo añade el dato que faltaba para poder
-- decidirlo. `detail` gana `newest_at` y `items_recientes`. Es aditivo: quien
-- lea `oldest_at` sigue leyéndolo igual.
--
-- Se edita con pg_get_functiondef + replace, no retranscribiendo: la función
-- tiene 90 líneas y ya está bien; retranscribir a mano es como se cuela un
-- cambio que nadie pidió.

do $edita$
declare
  v_src text;
  v_new text;
  v_a1 constant text := 'count(*)::integer as items, min(r.entity_at) as oldest_at';
  v_a2 constant text := 'c.items, jsonb_build_object(''oldest_at'', c.oldest_at), k.sort_weight';
begin
  v_src := pg_get_functiondef('public.pending_board(uuid)'::regprocedure);

  if position('items_recientes' in v_src) > 0 then
    raise notice 'pending_board ya expone items_recientes, se salta';
    return;
  end if;
  if position(v_a1 in v_src) = 0 or position(v_a2 in v_src) = 0 then
    raise exception 'no se encuentran las anclas en pending_board: la funcion ha cambiado y hay que revisar esta migracion';
  end if;

  v_new := replace(v_src, v_a1,
    v_a1 || ', max(r.entity_at) as newest_at' ||
    -- LO RECIENTE, contado aparte. No sustituye a `items`: convive con él.
    -- Un grupo con cinco filas viejas y una nueva TIENE que aterrizar, y por
    -- eso no vale mirar `newest_at` a secas ni, mucho menos, `oldest_at`.
    ', count(*) filter (where r.entity_at > now() - interval ''7 days'')::integer as items_recientes');

  v_new := replace(v_new, v_a2,
    'c.items, jsonb_build_object(''oldest_at'', c.oldest_at, ''newest_at'', c.newest_at, ''items_recientes'', c.items_recientes), k.sort_weight');

  execute v_new;

  v_src := pg_get_functiondef('public.pending_board(uuid)'::regprocedure);
  if position('items_recientes' in v_src) = 0 or position('newest_at' in v_src) = 0 then
    raise exception 'la edicion de pending_board no quedo aplicada';
  end if;
  raise notice 'pending_board expone newest_at e items_recientes';
end;
$edita$;

-- ── Verificación ───────────────────────────────────────────────────────────
do $verif$
declare v_n int; v_src text;
begin
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='pending_board';
  if v_n <> 1 then
    raise exception 'pending_board tiene % firmas: se ha creado una sobrecarga (Regla 2)', v_n;
  end if;

  v_src := pg_get_functiondef('public.pending_board(uuid)'::regprocedure);

  -- Lo viejo sigue: esto es aditivo, no un cambio de contrato.
  if position('''oldest_at'', c.oldest_at' in v_src) = 0 then
    raise exception 'se ha perdido oldest_at del detail';
  end if;
  -- Y el conteo de siempre no se ha tocado: el contador de la pestaña no miente.
  if position('count(*)::integer as items' in v_src) = 0 then
    raise exception 'se ha tocado el conteo total de items';
  end if;

  raise notice 'VERIFICACION OK: pending_board suma newest_at e items_recientes y conserva items y oldest_at';
end;
$verif$;
