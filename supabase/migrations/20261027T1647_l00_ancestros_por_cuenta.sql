-- supabase/migrations/20261027T1647_l00_ancestros_por_cuenta.sql
--
-- L00 · Respuesta 6 (27/10/2026) · Un trabajador que recibe un albarán no
-- recalculaba el coste de los platos.
--
-- Lo que pasaba, medido en producción el 27/10:
--   · Recepciones del portal (foto del albarán → IA → «Recibir») llama, tras
--     receive_goods_receipt, a la cascada de coste del front (cascadeFromItem):
--     kitchen_ancestors_of (qué platos y elaboraciones usan el ingrediente) y,
--     para cada uno, kitchen_recompute_item.
--   · kitchen_recompute_item deja pasar a cualquiera de la cuenta
--     (belongs_to_account). kitchen_ancestors_of, solo al administrador o al
--     encargado: a un trabajador le contesta «sin acceso al item …» (400).
--   · El front lo recoge en un console.error y sigue: la mercancía entra, pero
--     los platos no se recalculan hasta que la oficina confirma el albarán
--     (confirmReceipt, como administrador, repite la cascada). Desde el 23/06,
--     177 recepciones de trabajadores en Foodint (48 en 30 días); de las de 60
--     días, mediana de 2,5 h hasta que la oficina la toca, y percentil 90 de 63 h.
--   · El 27/10, un trabajador desde el iPhone: 30 respuestas 400 (1 a las 12:01
--     UTC y 29 entre las 13:44 y las 13:47), una por línea de tres albaranes.
--     No es del #354 (1215): esa guarda no ha cambiado desde el 31/05
--     (20260531T1330_folvy_kitchen_compras), y la 1215 no toca ni
--     recipe_item, ni recipe_line, ni las funciones de rol.
--
-- Lo que hace: kitchen_ancestors_of pide lo mismo que kitchen_recompute_item,
-- ser de la cuenta del artículo (belongs_to_account: cualquier perfil activo de
-- esa cuenta, o la plataforma). Misma firma, mismo resultado. Solo devuelve ids
-- y profundidades de artículos de SU cuenta; los nombres ya los lee cualquiera
-- de la cuenta por la RLS de recipe_item. Otra cuenta sigue sin acceso.
--
-- cambia: public.kitchen_ancestors_of(uuid) · prueba: supabase/staging/sql/20261027_l00_ancestros_por_cuenta_prueba.sql
--
-- Antes: md5(prosrc) eef6dc15fb26b156aac096a251b7b31c, igual en producción y en
-- staging (27/10, 16:50 UTC). Se guarda en funcion_respaldo y la vuelta atrás la
-- devuelve byte a byte con _restaurar_funcion.

select public._respaldar_funcion('public.kitchen_ancestors_of(uuid)', '20261027T1647_l00_ancestros_por_cuenta');

create or replace function public.kitchen_ancestors_of(p_item_id uuid)
 returns table(ancestor_id uuid, depth integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_account_id uuid;
begin
  select account_id into v_account_id from recipe_item where id = p_item_id;
  if not found then
    raise exception 'kitchen_ancestors_of: item % no existe', p_item_id;
  end if;

  -- La misma guarda que kitchen_recompute_item, que es el paso siguiente de la
  -- cascada: ser de la cuenta del artículo (L00, 27/10). Antes pedía ser
  -- administrador o encargado, y la cascada de un trabajador que recibe un
  -- albarán se paraba aquí.
  if not public.belongs_to_account(v_account_id) then
    raise exception 'kitchen_ancestors_of: sin acceso al item %', p_item_id;
  end if;

  return query
  with recursive ancestros as (
    -- Nivel 1: quién usa p_item_id directamente.
    select rl.parent_item_id as ancestor_id, 1 as depth
    from recipe_line rl
    where rl.child_item_id = p_item_id
    union
    -- Niveles superiores: quién usa a esos ancestros.
    select rl.parent_item_id, a.depth + 1
    from recipe_line rl
    join ancestros a on rl.child_item_id = a.ancestor_id
  )
  -- Si un ítem aparece a varias profundidades (lo usa por dos caminos), nos
  -- quedamos con la MÁS profunda: se recalcula después de todos sus hijos. La
  -- app ordena por depth DESC.
  select anc.ancestor_id, max(anc.depth) as depth
  from ancestros anc
  group by anc.ancestor_id
  order by max(anc.depth) desc;
end;
$function$;
