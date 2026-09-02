-- 20260902T0600_borrado_de_articulo_mira_las_trece.sql
--
-- ── kitchen_item_delete_check: los cinco sitios que no miraba ───────────────
--
-- El check decide si un artículo se BORRA de verdad o se archiva. Miraba ocho
-- tablas y hay TRECE que le apuntan sin CASCADE. Las cinco que faltaban:
--
--   course.source_recipe_item_id      NO ACTION  -> la FK ABORTA el DELETE. El
--     usuario no ve «se archiva», ve un error crudo de clave ajena.
--   goods_receipt_line.recipe_item_id SET NULL   -> el borrado FUNCIONA y la
--   purchase_order_line.recipe_item_id SET NULL     línea de albarán, de pedido,
--   purchase_line.recipe_item_id      SET NULL     de compra o el casado de
--   sales_mapping_fix.recipe_item_id  SET NULL     ventas se queda apuntando a
--     NULL. Sin error, sin aviso: mañana el albarán no sabe qué se recibió.
--
-- Las cuatro de SET NULL son las peligrosas justamente porque NO fallan. Julio:
-- «eliminar de verdad solo cuando el artículo esté huérfano de verdad».
--
-- Medido antes de tocar nada (02/09), por cuenta porque las tablas son
-- multi-cuenta (Regla 9): pasan el check de hoy 7 de los 392 artículos de
-- Foodint, 15 de los 625 de la plantilla Folvy Interno y los 56 de Kitchen
-- Grill LstQ. De esos 78, CERO tiene albarán, pedido, compra, casado o curso.
-- Es decir, hoy el agujero no ha mordido a nadie — pero solo porque recibir mercancía
-- movía siempre stock, y desde ayer ya no: una línea «déjalo pendiente» o un
-- cero con motivo entran en goods_receipt_line SIN movimiento de stock. El
-- acoplamiento que tapaba el agujero se rompió ayer.
--
-- Firma IDÉNTICA: es un CREATE OR REPLACE limpio, no una sobrecarga (Regla 2).

create or replace function public.kitchen_item_delete_check(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item    recipe_item%rowtype;
  v_reasons text[] := array[]::text[];
  v_n       integer;
begin
  select * into v_item from recipe_item where id = p_item_id;
  if not found then
    raise exception 'kitchen_item_delete_check: item % no existe', p_item_id;
  end if;
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_item.account_id)) then
    raise exception 'kitchen_item_delete_check: sin acceso al item %', p_item_id;
  end if;

  select count(*) into v_n from menu_item where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || format('está en %s carta(s)', v_n); end if;

  select count(distinct parent_item_id) into v_n from recipe_line where child_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || format('se usa como ingrediente en %s plato(s)', v_n); end if;

  select count(*) into v_n from stock_movement where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || 'tiene movimientos de stock'; end if;

  select count(*) into v_n from stock_waste where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || 'tiene mermas registradas'; end if;

  select count(*) into v_n from inventory_count_line where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || 'aparece en inventarios'; end if;

  select count(*) into v_n from modifier_option where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || 'se usa en modificadores'; end if;

  select count(*) into v_n from modifier_recipe_impact where target_recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || 'se usa en modificadores'; end if;

  select count(*) into v_n from supplier_invoice_line where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || 'está en facturas de proveedor'; end if;

  -- (02/09) LAS CINCO QUE FALTABAN.
  -- `course` aborta el DELETE por clave ajena; las otras cuatro lo dejan pasar
  -- y se llevan la historia por delante en silencio.
  select count(*) into v_n from course where source_recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || format('es el origen de %s curso(s) de formación', v_n); end if;

  select count(*) into v_n from goods_receipt_line where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || format('está en %s línea(s) de albarán recibido', v_n); end if;

  select count(*) into v_n from purchase_order_line where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || format('está en %s línea(s) de pedido a proveedor', v_n); end if;

  select count(*) into v_n from purchase_line where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || format('está en %s línea(s) de compra', v_n); end if;

  select count(*) into v_n from sales_mapping_fix where recipe_item_id = p_item_id;
  if v_n > 0 then v_reasons := v_reasons || format('lo usan %s corrección(es) de casado de ventas', v_n); end if;

  return jsonb_build_object(
    'deletable',  (array_length(v_reasons, 1) is null),
    'reasons',    to_jsonb(v_reasons),
    'name',       v_item.name,
    'type',       v_item.type,
    'archived',   (v_item.archived_at is not null or v_item.is_active = false)
  );
end;
$function$;

-- ── Desarchivar: hasta hoy archivar era un viaje de ida ─────────────────────
-- `kitchen_delete_or_archive_item` archiva, y no había NADA que devolviera un
-- artículo al catálogo. Un botón que solo va en una dirección no es reversible
-- por mucho que lo llamemos «archivar».
create or replace function public.kitchen_unarchive_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item recipe_item%rowtype;
begin
  select * into v_item from recipe_item where id = p_item_id;
  if not found then
    raise exception 'kitchen_unarchive_item: item % no existe', p_item_id;
  end if;
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_item.account_id)) then
    raise exception 'kitchen_unarchive_item: sin acceso al item %', p_item_id;
  end if;

  update recipe_item
     set is_active = true, archived_at = null
   where id = p_item_id;

  return jsonb_build_object('action', 'unarchived', 'name', v_item.name);
end;
$function$;

revoke all on function public.kitchen_unarchive_item(uuid) from public, anon;
grant execute on function public.kitchen_unarchive_item(uuid) to authenticated, service_role;

-- ── Archivar a propósito, sin tener que pulsar «Eliminar» ───────────────────
-- Hasta hoy la única forma de archivar era pedir un borrado y que el servidor
-- decidiera archivar en su lugar. Archivar deja de ser un efecto secundario.
create or replace function public.kitchen_archive_item(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_item recipe_item%rowtype;
begin
  select * into v_item from recipe_item where id = p_item_id;
  if not found then
    raise exception 'kitchen_archive_item: item % no existe', p_item_id;
  end if;
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(v_item.account_id)) then
    raise exception 'kitchen_archive_item: sin acceso al item %', p_item_id;
  end if;

  update recipe_item
     set is_active = false, archived_at = coalesce(archived_at, now())
   where id = p_item_id;

  return jsonb_build_object('action', 'archived', 'name', v_item.name);
end;
$function$;

revoke all on function public.kitchen_archive_item(uuid) from public, anon;
grant execute on function public.kitchen_archive_item(uuid) to authenticated, service_role;

-- ── Verificación ───────────────────────────────────────────────────────────
do $verif$
declare
  v_src text; v_falta text[] := array[]::text[]; t text;
begin
  v_src := pg_get_functiondef('public.kitchen_item_delete_check(uuid)'::regprocedure);
  foreach t in array array['course','goods_receipt_line','purchase_order_line',
                           'purchase_line','sales_mapping_fix'] loop
    -- Se busca la CONSULTA, no el nombre suelto: un nombre de tabla puede
    -- aparecer dentro de otro o dentro de un texto y dar un falso verde.
    if position('from ' || t || ' where recipe_item_id' in v_src) = 0
       and position('from ' || t || ' where source_recipe_item_id' in v_src) = 0 then
      v_falta := v_falta || t;
    end if;
  end loop;
  if array_length(v_falta, 1) is not null then
    raise exception 'el check sigue sin mirar: %', array_to_string(v_falta, ', ');
  end if;

  -- Una sola firma de cada una: nada de sobrecargas (Regla 2).
  foreach t in array array['kitchen_item_delete_check','kitchen_archive_item','kitchen_unarchive_item'] loop
    if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
         where n.nspname='public' and p.proname = t) <> 1 then
      raise exception '% tiene mas de una firma', t;
    end if;
  end loop;

  raise notice 'VERIFICACION OK: el check mira las 13 tablas sin CASCADE; archivar y desarchivar existen';
end;
$verif$;
