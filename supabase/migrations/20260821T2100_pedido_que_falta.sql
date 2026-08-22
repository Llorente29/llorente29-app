-- 20260821T2100_pedido_que_falta.sql
-- ENCARGO CODE (21/08) «Qué falta de un pedido, y poder reclamarlo» — datos.
-- APLICADA: 21/08/2026 vía MCP, verificada contra PED-00042 (31 líneas, 27
-- completas, faltan 4).
--
-- El sistema YA sabía qué falta y no lo contaba. Se calcula en UN SOLO SITIO y
-- de ahí beben las tres cosas que lo necesitan: la fila de la lista, la ficha
-- del pedido y el texto de la reclamación. Si cada una lo calculara por su
-- cuenta acabarían discrepando.
--
-- (La columna de salida se llama line_position y no position: `position` es
--  palabra reservada en la lista RETURNS TABLE.)
--
-- ⚠️ LA COMPARACIÓN DE CANTIDAD NO MIRA EL FORMATO. Misma deuda que ya tiene
-- recompute_purchase_order_status, anotada el 21/08: qty_received está en el
-- formato del ALBARÁN y qty_ordered en el del PEDIDO. Se replica el criterio de
-- recompute A PROPÓSITO: si aquí se contara distinto, la ficha diría una cosa y
-- el estado del pedido otra. Se arregla en los dos a la vez o en ninguno.
create or replace function public.purchase_order_shortfall(p_order_id uuid)
 returns table(
   line_id uuid, product_name text, recipe_item_id uuid,
   format_name text, qty_ordered numeric, qty_received numeric, qty_missing numeric,
   line_position integer
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with recv as (
    select grl.purchase_order_line_id as pol_id, sum(grl.qty_received) as qty_recv
      from goods_receipt_line grl
      join goods_receipt gr on gr.id = grl.goods_receipt_id
     where gr.purchase_order_id = p_order_id
       and gr.status = 'confirmado'
       and grl.purchase_order_line_id is not null
     group by 1
  )
  select pol.id,
         coalesce(ri.name, pol.product_name),
         pol.recipe_item_id,
         f.name,
         pol.qty_ordered,
         coalesce(r.qty_recv, 0),
         greatest(pol.qty_ordered - coalesce(r.qty_recv, 0), 0),
         pol.position
    from purchase_order_line pol
    join purchase_order po on po.id = pol.purchase_order_id
    left join recv r on r.pol_id = pol.id
    left join recipe_item ri on ri.id = pol.recipe_item_id
    left join recipe_item_purchase_format f on f.id = pol.purchase_format_id
   where pol.purchase_order_id = p_order_id
     and public.belongs_to_account(po.account_id)
   -- LO QUE FALTA, PRIMERO. El orden lo impone el servidor, no la pantalla: así
   -- la ficha y el texto de la reclamación enseñan lo mismo en el mismo orden.
   order by (coalesce(r.qty_recv,0) >= pol.qty_ordered), pol.position;
$function$;

grant execute on function public.purchase_order_shortfall(uuid) to authenticated;

-- El resumen por pedido, para la LISTA (un array: 20 filas, 1 consulta).
create or replace function public.purchase_order_progress(p_order_ids uuid[])
 returns table(
   order_id uuid, lineas integer, completas integer, faltan integer,
   dias_de_retraso integer
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with recv as (
    select gr.purchase_order_id as po_id, grl.purchase_order_line_id as pol_id,
           sum(grl.qty_received) as qty_recv
      from goods_receipt_line grl
      join goods_receipt gr on gr.id = grl.goods_receipt_id
     where gr.purchase_order_id = any(p_order_ids)
       and gr.status = 'confirmado'
       and grl.purchase_order_line_id is not null
     group by 1,2
  )
  select po.id,
         count(pol.id)::integer,
         count(pol.id) filter (where coalesce(r.qty_recv,0) >= pol.qty_ordered)::integer,
         count(pol.id) filter (where coalesce(r.qty_recv,0) < pol.qty_ordered)::integer,
         case when po.expected_date is null then null
              else greatest((current_date - po.expected_date)::integer, 0) end
    from purchase_order po
    left join purchase_order_line pol on pol.purchase_order_id = po.id
    left join recv r on r.pol_id = pol.id
   where po.id = any(p_order_ids)
     and public.belongs_to_account(po.account_id)
   group by po.id, po.expected_date;
$function$;

grant execute on function public.purchase_order_progress(uuid[]) to authenticated;

-- ── Verificación ─────────────────────────────────────────────────────────
-- Las dos funciones filtran por belongs_to_account(), que resuelve por
-- auth.uid(). Aplicando la migración como `postgres` eso es FALSE y devolverían
-- 0 filas — el primer intento falló justo por ahí, y era la COMPROBACIÓN la que
-- estaba mal, no las funciones. Se verifica bajo una IDENTIDAD REAL con
-- set_config local: al acabar la transacción se deshace solo.
do $$
declare v_po uuid; v_faltan integer; v_lineas integer; v_prog record;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"673fca49-f6b5-40ed-a8f7-558390acce10","role":"authenticated"}', true);

  select id into v_po from purchase_order where code = 'PED-00042';
  if v_po is null then
    raise notice 'PED-00042 no existe; se omite la comprobación con datos';
    return;
  end if;

  select count(*) filter (where s.qty_missing > 0), count(*)
    into v_faltan, v_lineas from public.purchase_order_shortfall(v_po) s;
  if v_lineas <> 31 then
    raise exception 'PED-00042 debería tener 31 líneas y salieron %', v_lineas;
  end if;
  if v_faltan <> 4 then
    raise exception 'PED-00042 debería tener 4 líneas incompletas y salieron %', v_faltan;
  end if;

  select * into v_prog from public.purchase_order_progress(array[v_po]);
  if v_prog.lineas <> 31 or v_prog.completas <> 27 or v_prog.faltan <> 4 then
    raise exception 'progress dio lineas=% completas=% faltan=% (se esperaba 31/27/4)',
      v_prog.lineas, v_prog.completas, v_prog.faltan;
  end if;
  raise notice 'OK: PED-00042 = 31 líneas, 27 completas, faltan 4';
end $$;
