-- ============================================================================
-- Fix: orders_feed / orders_feed_by_token / kds_board — `lineas` nunca NULL
-- ----------------------------------------------------------------------------
-- BUG: en Postgres `jsonb_agg(...)` devuelve NULL (no '[]') cuando no hay filas.
-- El campo `lineas` de estas 3 RPC no estaba envuelto en coalesce, así que un
-- pedido presente en el feed pero SIN líneas "padre" (p.ej. una comanda cuyas
-- líneas aún no se han ingestado cuando llega el evento realtime) llegaba al
-- front con `lineas = null`. OrderCard (/orders) y KdsBoard (/cocina) hacen
-- `.map`/`.filter` sobre `lineas`, y reventaban con:
--     Uncaught TypeError: Cannot read properties of null (reading 'filter')
-- El Despacho NO se veía afectado porque no pinta las líneas del ticket.
--
-- FIX: envolver el SELECT de `lineas` en coalesce(..., '[]'::jsonb) en las tres
-- funciones. (Los `children` ya estaban protegidos; el `orders`/`tickets` de
-- nivel superior también.) Arreglo en el ORIGEN → protege a Pedidos, Cocina y
-- la tablet (orders_feed_by_token) de una vez.
--
-- Idempotente: si la función ya está parcheada, se salta. Seguro de re-ejecutar.
-- Aplicado y verificado en producción el 2026-07-19 (null -> []).
-- ============================================================================

do $$
declare
  fns text[] := array[
    'public.orders_feed(uuid)',
    'public.orders_feed_by_token(text)',
    'public.kds_board(uuid,text)'
  ];
  f   text;
  src text;
begin
  foreach f in array fns loop
    src := pg_get_functiondef(f::regprocedure);

    -- Ya parcheada -> no tocar (idempotencia).
    if position('v.id), ''[]''::jsonb) as lineas' in src) > 0 then
      continue;
    end if;

    -- 1) coalesce( antes del SELECT externo de `lineas`
    --    (ancla: l.line_id — distingue el externo de los children h.line_id).
    src := regexp_replace(
      src,
      '\(select jsonb_agg\(jsonb_build_object\(\s*''line_id'', l\.line_id,',
      'coalesce(\&'
    );

    -- 2) cerrar el coalesce con '[]' tras el SELECT de `lineas`.
    src := regexp_replace(
      src,
      'from padres l where l\.sale_id = v\.id\) as lineas',
      'from padres l where l.sale_id = v.id), ''[]''::jsonb) as lineas'
    );

    -- Guardarraíl: no ejecutar si las anclas no aplicaron.
    if position('coalesce((select jsonb_agg(jsonb_build_object(' in src) = 0
       or position('::jsonb) as lineas' in src) = 0 then
      raise exception 'fix lineas: ancla no encontrada en %, abortado', f;
    end if;

    execute src;
    raise notice 'orders/kds feed: lineas blindada en %', f;
  end loop;
end $$;
