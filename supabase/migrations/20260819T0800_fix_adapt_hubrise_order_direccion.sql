-- ============================================================================
-- URGENTE 19/08/2026 — la direccion de Just Eat se escribia y se borraba
-- ============================================================================
-- LO QUE PASABA, y no era lo que pensabamos.
--
-- hubrise-webhook v50 estaba BIEN. buildCustomerFields lee order.customer, y el
-- pedido llega en payload.new_state con address_1, address_2, city, postal_code
-- y delivery_notes rellenos. La funcion componia la direccion correctamente y la
-- escribia en el INSERT.
--
-- Dos lineas mas abajo, el mismo request llama a adapt_hubrise_order, y esa RPC
-- hace un UPDATE que PISA los cuatro campos de cliente:
--
--     UPDATE sale SET
--       customer_name    = ... v_order->'customer'->>'first_name' ...   <- bien
--       customer_phone   = ... v_order->'customer'->>'phone' ...        <- bien
--       delivery_address = ... v_order->'delivery'->'address' ...       <- NULL
--       customer_note    = ... v_order->>'customer_notes' ...           <- NULL
--     WHERE id = p_sale_id;
--
-- No es que unos campos llegaran y otros no: a LOS CUATRO los pisa la misma
-- sentencia. Los dos primeros se recalculan desde `customer`, que tiene los
-- datos, y salen identicos — por eso parecian intactos. Los otros dos se
-- recalculan desde `delivery.address` (que HubRise manda JSON null) y desde
-- `customer_notes` de la raiz (que viene vacio), y salen NULL.
--
-- Verificado en la venta ynddpx5 (18/08 13:21): su raw_tab, escrito en el MISMO
-- objeto que los cuatro campos, contiene address_1 'Calle de Miguel Yuste, 18,
-- Piso 4 Puerta 1', postal_code '28037' y delivery_notes 'Provimad'. La Edge
-- Function tenia los datos. El UPDATE posterior los borro.
--
-- EL ARREGLO
-- Que la RPC componga LO MISMO que buildCustomerFields, para que de igual quien
-- escriba el ultimo. No se toca la Edge Function ni ningun otro campo del
-- UPDATE: customer_name, customer_phone y expected_time quedan byte a byte
-- iguales.
--
--   delivery_address: se ANTEPONE una rama que lee customer.* con la regla del
--     webhook — [address_1, address_2 solo si difiere de city, postal_code]
--     unidos por ', ', sin ciudad. Las ramas que ya habia (delivery.address
--     estructurado y plano) se conservan como respaldo: no estorban y cubren
--     una forma de payload que podria existir en otra conexion.
--
--   customer_note: primero customer.delivery_notes (la nota PARA EL RIDER, que
--     es la que catcher-dispatch envia como `details`), y si no hay, la nota de
--     pedido customer_notes de la raiz, que es lo que habia. No se mezclan.
--
-- COMPROBADO CONTRA LOS PAYLOADS REALES antes de aplicar, no con uno inventado:
--   ynddpx5  -> 'Calle de Miguel Yuste, 18, Piso 4 Puerta 1, 28037' + 'Provimad'
--   yn633nk  -> 'Calle de Vinaroz, 38, 2A, 28002' + 'ULTIMA PLANTA'
--   2mjqq3q  -> 'Calle de Federico Gutierrez, 16, 2 Dcha, 28027'
--   vxyk9vm  -> 'Calle de Sirio, 54, Escalera Derecha 7 A, 28007' + nota larga
--   yn6x8e2  -> 'Avenida De Trueba, 1, Bloque C, 3A, Bloque C, 3A, 28017'
--              (la duplicacion viene del cliente dentro de address_1: no se toca)
--   Los ~85 pedidos de Uber Eats siguen dando direccion NULL, que es CORRECTO:
--   reparte Uber y address_1 llega vacio.
--
-- POR QUE UN PARCHE Y NO LA FUNCION ENTERA
-- adapt_hubrise_order son 16.734 bytes y 360 lineas. Reescribirla a mano para
-- cambiar dos expresiones es justo la clase de error que ya nos costo un dia en
-- esta misma integracion. Esto lee la definicion viva, sustituye DOS anclas
-- verificadas como unicas, y la vuelve a crear. Cero transcripcion.
--
-- DEUDA DECLARADA: la direccion se compone en DOS sitios con dos reglas —
-- buildCustomerFields (TypeScript) y esta RPC (SQL). Que divergieran es
-- exactamente lo que ha pasado. Lo correcto a futuro es que la frontera sea la
-- unica que escribe estos campos y que la RPC no los toque; eso es un cambio de
-- reparto de responsabilidades y merece su propio encargo.

do $mig$
declare
  v_def   text;
  v_a_old text := $x$delivery_address = nullif(btrim(coalesce($x$;
  v_a_new text := $x$delivery_address = nullif(btrim(coalesce(
        -- HubRise manda la direccion en customer.*, NO en delivery.* (null).
        -- Misma regla que buildCustomerFields: address_2 solo si difiere de
        -- city (en Just Eat address_2 ES la ciudad), y sin ciudad al final.
        nullif(concat_ws(', ',
          nullif(btrim(coalesce(v_order->'customer'->>'address_1','')),''),
          case when lower(regexp_replace(coalesce(v_order->'customer'->>'address_2',''), '\s+', ' ', 'g'))
                    is distinct from
                    lower(regexp_replace(coalesce(v_order->'customer'->>'city',''), '\s+', ' ', 'g'))
               then nullif(btrim(coalesce(v_order->'customer'->>'address_2','')),'') end,
          nullif(btrim(coalesce(v_order->'customer'->>'postal_code','')),'')), ''),$x$;
  v_n_old text := $x$customer_note = nullif(v_order->>'customer_notes','')$x$;
  v_n_new text := $x$customer_note = coalesce(
      -- nota PARA EL RIDER (portal, piso, codigo): es la que consume el reparto
      nullif(btrim(coalesce(v_order->'customer'->>'delivery_notes','')),''),
      -- respaldo: nota de pedido, que es lo que habia antes
      nullif(btrim(coalesce(v_order->>'customer_notes','')),''))$x$;
  v_veces int;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'adapt_hubrise_order';
  if v_def is null then
    raise exception 'adapt_hubrise_order no existe. Abortado.';
  end if;

  -- Las anclas tienen que aparecer EXACTAMENTE una vez. Si la funcion cambio
  -- por debajo, esto para en vez de parchear a ciegas.
  v_veces := (length(v_def) - length(replace(v_def, v_a_old, ''))) / length(v_a_old);
  if v_veces <> 1 then
    raise exception 'El ancla de delivery_address aparece % veces, se esperaba 1. Abortado.', v_veces;
  end if;
  v_veces := (length(v_def) - length(replace(v_def, v_n_old, ''))) / length(v_n_old);
  if v_veces <> 1 then
    raise exception 'El ancla de customer_note aparece % veces, se esperaba 1. Abortado.', v_veces;
  end if;

  v_def := replace(v_def, v_a_old, v_a_new);
  v_def := replace(v_def, v_n_old, v_n_new);
  execute v_def;
end
$mig$;
