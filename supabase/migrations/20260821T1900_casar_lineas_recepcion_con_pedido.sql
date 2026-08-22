-- 20260821T1900_casar_lineas_recepcion_con_pedido.sql
-- ENCARGO CODE (21/08) «Los pedidos a proveedor no se cierran nunca al
-- recepcionar» — §5 (el arreglo) y §7 (el vigía).
--
-- ── La causa, medida ─────────────────────────────────────────────────────
-- 747 líneas de recepción en Foodint. Sólo 3 tienen purchase_order_line_id, y
-- las 3 vienen del formulario manual (GoodsReceiptForm sí lo rellena). El
-- asistente de cocina —ReceiptWizard, que es el camino que se usa hoy— llama a
-- createGoodsReceiptLine SIN ese campo, así que TODAS sus líneas nacen sueltas.
--
-- recompute_purchase_order_status sólo cuenta lo que viene de una línea
-- enlazada, así que qty_recv = 0 en todas y el estado calculado es 'enviado'
-- para siempre. La función está bien: lo que pasa es que todas las líneas son
-- «extra».
--
-- ── Lo que hace esta migración ───────────────────────────────────────────
--   A) _match_order_lines_for_order(p_order_id) — NUEVA. Casa las líneas de
--      recepción sueltas de un pedido con sus líneas de pedido.
--   B) La llaman los TRES sitios que enlazan recepción con pedido, justo antes
--      de recompute_purchase_order_status.
--   C) purchase_orders_stuck(p_days) — NUEVA. El vigía del §7.
--
-- ── Por qué por ORDEN y no por recepción ─────────────────────────────────
-- Keyed por pedido, cualquier camino que recalcule repara el pedido ENTERO,
-- incluidas las líneas de otras recepciones que se quedaron sueltas. Es
-- auto-reparable en vez de depender de que cada recepción pase por el sitio
-- bueno.
--
-- ── UNA DESVIACIÓN DEL ENCARGO, A PROPÓSITO ──────────────────────────────
-- El §5.1 dice «si hay exactamente una línea de pedido SIN CASAR con ese
-- artículo, se casa». Aplicado al pie de la letra rompería las entregas
-- parciales: el Queso Mozarela de PED-00042 se pidió en 10 paquetes y llegaron
-- 3; cuando lleguen los 7 restantes en otro albarán, no habría ninguna línea de
-- pedido «sin casar» y esa segunda entrega se quedaría suelta.
--
-- Y recompute YA suma varias líneas de recepción contra la misma línea de
-- pedido (SUM ... GROUP BY purchase_order_line_id). O sea que apuntar dos
-- recepciones a la misma línea no es un error: es como se representa una
-- entrega parcial.
--
-- La regla que se aplica: si el pedido tiene EXACTAMENTE UNA línea con ese
-- artículo, se casa —da igual que otras recepciones ya apunten ahí—. Sólo
-- cuando el artículo aparece VARIAS VECES en el pedido hay que desempatar, y
-- entonces se desempata por formato; si sigue empatado, no se casa.
--
-- ── Reglas que no se negocian ────────────────────────────────────────────
-- 1. NUNCA por parecido de nombre. Ya hay 410 líneas emparejadas «por
--    parecido» sin confirmar; no se añaden más.
-- 2. NUNCA se pisa un purchase_order_line_id ya puesto: si un humano lo
--    decidió desde el formulario, manda él.
-- 3. Una línea que no casa NO es un error: es mercancía que llegó sin pedir, y
--    es legítima. Se queda a null y no cuenta para cerrar el pedido.

-- ── A) El casador ────────────────────────────────────────────────────────
create or replace function public._match_order_lines_for_order(p_order_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order   purchase_order%rowtype;
  v_line    record;
  v_n       integer;
  v_pol_id  uuid;
  v_matched integer := 0;
begin
  select * into v_order from purchase_order where id = p_order_id;
  if not found then
    return 0;
  end if;
  if not public.belongs_to_account(v_order.account_id) then
    raise exception '_match_order_lines_for_order: sin acceso al pedido %', p_order_id;
  end if;

  for v_line in
    select grl.id, grl.recipe_item_id, grl.purchase_format_id
      from goods_receipt_line grl
      join goods_receipt gr on gr.id = grl.goods_receipt_id
     where gr.purchase_order_id = p_order_id
       and gr.status in ('recibido', 'confirmado')   -- ni borradores ni anuladas
       and grl.purchase_order_line_id is null        -- regla 2: no se pisa nada
       and grl.recipe_item_id is not null
       and not grl.not_goods                         -- portes/envases no son mercancía
     order by grl.created_at, grl.id
  loop
    -- 1) POR ARTÍCULO. Es la clave fuerte: las dos tablas apuntan al mismo
    --    recipe_item_id. Si el pedido sólo tiene una línea de ese artículo, no
    --    hay nada que decidir.
    select count(*), (array_agg(pol.id))[1] into v_n, v_pol_id
      from purchase_order_line pol
     where pol.purchase_order_id = p_order_id
       and pol.recipe_item_id = v_line.recipe_item_id;

    if v_n > 1 then
      -- 2) EL ARTÍCULO ESTÁ VARIAS VECES: desempatar por formato.
      select count(*), (array_agg(pol.id))[1] into v_n, v_pol_id
        from purchase_order_line pol
       where pol.purchase_order_id = p_order_id
         and pol.recipe_item_id = v_line.recipe_item_id
         and pol.purchase_format_id is not distinct from v_line.purchase_format_id;
    end if;

    -- v_n = 1 -> casa. v_n = 0 -> llegó sin pedir. v_n > 1 -> sigue el empate:
    -- se deja para la pantalla, que es quien puede preguntar.
    if v_n = 1 and v_pol_id is not null then
      update goods_receipt_line
         set purchase_order_line_id = v_pol_id, updated_at = now()
       where id = v_line.id;
      v_matched := v_matched + 1;
    end if;
  end loop;

  return v_matched;
end;
$function$;

grant execute on function public._match_order_lines_for_order(uuid) to authenticated;

-- ── C) El vigía del §7 ───────────────────────────────────────────────────
-- Esto lleva roto desde junio y nadie se enteró porque NADA mide si un pedido
-- se cierra. Devuelve los pedidos con la fecha esperada pasada que siguen sin
-- cerrarse.
--
-- DESVIACIÓN DEL ENCARGO, razonada: el §7 dice «pedidos en 'enviado'». Tras el
-- barrido no queda NINGUNO en 'enviado', así que el vigía tal cual daría 0 — y
-- sin embargo PED-00042 lleva desde el 18/08 con 3 artículos que no han llegado
-- y uno servido a medias (Queso Mozarela: 10 pedidos, 3 recibidos). Ése es
-- exactamente el pedido que hay que mirar. 'recibido_parcial' con la fecha
-- pasada ES un pedido que no se cierra; el estado concreto era un detalle de
-- cómo estaba el mundo ANTES de arreglarlo, no la preocupación.
--
-- ⚠️ DE MOMENTO NO LO CONSUME NADIE. Es la cuarta pata otra vez si se queda
-- así: hace falta colgarlo de una pantalla o de un aviso. Se deja escrito y
-- medible para que la próxima vez la avería no tarde dos meses en verse.
drop function if exists public.purchase_orders_stuck(integer);

create function public.purchase_orders_stuck(p_days integer default 3)
 returns table(
   order_id uuid, order_code text, estado text, supplier_name text, location_name text,
   expected_date date, dias_de_retraso integer,
   lineas_pedido integer, lineas_completas integer, lineas_sin_recibir integer
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with recv as (
    select grl.purchase_order_line_id as pol_id, sum(grl.qty_received) as qty_recv
      from goods_receipt_line grl
      join goods_receipt gr on gr.id = grl.goods_receipt_id
     where gr.status = 'confirmado' and grl.purchase_order_line_id is not null
     group by 1
  ),
  por_pedido as (
    select pol.purchase_order_id as po_id,
           count(*)::integer as n_lineas,
           count(*) filter (where coalesce(r.qty_recv,0) >= pol.qty_ordered)::integer as n_completas,
           count(*) filter (where coalesce(r.qty_recv,0) = 0)::integer as n_sin_recibir
      from purchase_order_line pol
      left join recv r on r.pol_id = pol.id
     group by 1
  )
  select po.id, po.code, po.status, s.name, l.name, po.expected_date,
         (current_date - po.expected_date)::integer,
         coalesce(pp.n_lineas,0), coalesce(pp.n_completas,0), coalesce(pp.n_sin_recibir,0)
    from purchase_order po
    left join supplier s on s.id = po.supplier_id
    left join locations l on l.id = po.location_id
    left join por_pedido pp on pp.po_id = po.id
   where po.status in ('enviado', 'recibido_parcial')
     and po.expected_date < current_date - greatest(p_days, 0)
     and public.belongs_to_account(po.account_id)
   order by po.expected_date;
$function$;

grant execute on function public.purchase_orders_stuck(integer) to authenticated;

-- ── Verificación ─────────────────────────────────────────────────────────
-- La verificación EJECUTA las dos funciones, no se limita a comprobar que
-- existan. La primera versión de esta migración usaba min(uuid) —que no existe
-- en Postgres— y pasó la comprobación de existencia tan campante; sólo reventó
-- al llamarla. Una función que no se ha ejecutado nunca no está verificada.
do $$
declare v_n integer;
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname='public' and p.proname='_match_order_lines_for_order') then
    raise exception 'A: no quedó _match_order_lines_for_order';
  end if;
  -- Con un uuid que no es ningún pedido: devuelve 0 sin tocar nada, pero
  -- COMPILA y CORRE el cuerpo entero hasta el primer return.
  v_n := public._match_order_lines_for_order('00000000-0000-0000-0000-000000000000');
  if v_n <> 0 then
    raise exception 'A: con un pedido inexistente debería devolver 0 y devolvió %', v_n;
  end if;
  perform * from public.purchase_orders_stuck(3);
end $$;
