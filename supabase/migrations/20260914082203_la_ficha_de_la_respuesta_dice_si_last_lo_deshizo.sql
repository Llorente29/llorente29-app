-- ═══════════════════════════════════════════════════════════════════════════
-- LA FICHA DE LA RESPUESTA DICE SI LAST DESHIZO LO DE UNA PERSONA
-- 14/09/2026 · tercera pata de #27
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Julio, 13/09 19:45: «A2c no se arregla quitándolo: se arregla haciéndolo
-- hablar». Tiene que hablar en tres sitios. La pieza anterior
-- (20260914082039) hizo dos --el parte de la pasada y la cola de avisos-- y
-- dejó el dato escrito en la fila. Ésta es el tercero: la pantalla.
--
-- Se añaden DOS CLAVES a lo que la ficha ya devolvía, y nada más. Arriba ya
-- estaba «quién la apagó» (`retirada_por`); esto es el caso contrario: «a
-- quién se la volvieron a encender». Una respuesta ENCENDIDA con esta marca
-- es una que apagó una persona y que la importación de madrugada ha vuelto a
-- poner a la venta.
--
-- LA BANDA: esto es un `create or replace` de una función STABLE de lectura.
-- No toma cierre exclusivo sobre ninguna tabla, así que no espera a la noche
-- (regla de Julio del 14/09). Lo que sí lo necesitaba era el `ALTER TABLE` de
-- la pieza anterior, y por eso van en dos piezas y no en una.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.kitchen_ficha_de_respuesta(
  p_account   uuid,
  p_option_id uuid,
  p_dias      integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dias  int := greatest(1, coalesce(p_dias, 30));
  v_clave text;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  select lower(btrim(o.name)) into v_clave
    from modifier_option o where o.id = p_option_id and o.account_id = p_account;
  if v_clave is null then return null; end if;

  return (
  select jsonb_build_object(
    'id', o.id, 'nombre', btrim(o.name), 'precio', coalesce(o.price_impact,0),
    'activa', coalesce(o.is_active, true),
    'retirada_at', o.deactivated_at, 'retirada_por', o.deactivated_by,
    -- 🔴 EL CASO CONTRARIO (14/09). Arriba esta «quien la apago»; esto es
    -- «a quien se la volvieron a encender». Una respuesta ENCENDIDA con esta
    -- marca es una que apago una persona y el importador de Last ha vuelto a
    -- poner a la venta. Sin esta linea, esa persona no se entera nunca: el
    -- sello de apagado se borra al encenderla, y antes no quedaba nada.
    'reencendida_at', o.reencendida_at, 'reencendida_sobre', o.reencendida_sobre,
    'cedida', (coalesce(b.ownership_type,'own') <> 'own'),
    'marca', coalesce(b.name,'Sin marca'),
    'pregunta', g.name, 'pregunta_id', g.id,
    -- QUE LLEVA
    'efecto', (
      select jsonb_build_object('tipo', i.impact_type, 'ficha', i.target_recipe_item_id,
                                'ficha_nombre', ri.name, 'cantidad', i.quantity,
                                'unidad', i.unit_id,
                                'quien', i.confirmed_by_name, 'cuando', i.confirmed_at,
                                'descuenta_algo', public._impacto_completo(
                                   i.impact_type, i.target_recipe_item_id, i.quantity))
        from modifier_recipe_impact i
        left join recipe_item ri on ri.id = i.target_recipe_item_id
       where i.modifier_option_id = o.id and i.account_id = p_account
         and i.status = 'confirmed' limit 1),
    -- DONDE ESTA: todas las que se llaman igual, cada una abrible.
    'donde_esta', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o2.id, 'pregunta', g2.name, 'pregunta_id', g2.id,
               'marca', coalesce(b2.name,'Sin marca'),
               'cedida', (coalesce(b2.ownership_type,'own') <> 'own'),
               'activa', coalesce(o2.is_active, true),
               'es_esta', (o2.id = o.id),
               'platos', (select count(*) from modifier_group_assignment a
                           where a.modifier_group_id = g2.id),
               'decidida', exists (select 1 from modifier_recipe_impact i2
                                    where i2.modifier_option_id = o2.id
                                      and i2.status = 'confirmed'
                                      and public._impacto_completo(i2.impact_type,
                                            i2.target_recipe_item_id, i2.quantity)))
             order by (o2.id = o.id) desc, b2.name, g2.name)
        from modifier_option o2
        join modifier_group g2 on g2.id = o2.modifier_group_id
        left join brand b2 on b2.id = g2.brand_id
       where o2.account_id = p_account and lower(btrim(o2.name)) = v_clave
         and coalesce(o2.is_active, true)), '[]'::jsonb),
    -- CUANTO SE PIDE. El 0 nunca va solo: al lado va lo anulado.
    'ventas', (
      select jsonb_build_object(
               'dias', v_dias,
               'ventas', count(*) filter (where s.cancelled_at is null),
               'anuladas', count(*) filter (where s.cancelled_at is not null),
               'ultimas', coalesce(jsonb_agg(jsonb_build_object(
                   'cuando', s.sold_at, 'total', s.total,
                   'anulada', (s.cancelled_at is not null),
                   'canal', s.source)
                 order by s.sold_at desc), '[]'::jsonb))
        from sale_line m
        join sale s on s.id = m.sale_id and s.account_id = p_account
                   and s.sold_at >= now() - make_interval(days => v_dias)
       where m.modifier_option_id = o.id and m.line_type = 'modifier'),
    'ultima_venta', (
      select max(s.sold_at) from sale_line m
        join sale s on s.id = m.sale_id and s.account_id = p_account
                   and s.cancelled_at is null
       where m.modifier_option_id = o.id and m.line_type = 'modifier'))
    from modifier_option o
    join modifier_group g on g.id = o.modifier_group_id
    left join brand b on b.id = g.brand_id
   where o.id = p_option_id and o.account_id = p_account);
end;
$$;
