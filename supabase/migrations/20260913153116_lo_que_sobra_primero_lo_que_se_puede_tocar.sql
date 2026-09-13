-- EL MONTON QUE SOBRA: PRIMERO LO QUE SE PUEDE TOCAR.
--
-- Salio al mirar los datos de verdad, no el codigo: el monton lo encabezaban
-- «Agua pet.», «Cheesecake De Nutella» y «Coca cola» de Ay Mamita Bowls, que es
-- CEDIDA. O sea que las tres primeras cosas que ve quien entra a limpiar son
-- justo las tres que no puede tocar.
--
-- No se esconden —eso seria la regla 7— pero bajan: primero las propias, que
-- son sobre las que se puede trabajar, y detras las cedidas con su etiqueta.
-- El umbral ordena, no esconde.
--
-- Lo demas es identico a `los_dos_montones_y_la_ficha_de_una_respuesta`.
-- Banda: funcion `stable`, no escribe, y a esta hora solo la llama la pantalla
-- nueva, que aun no esta publicada. Cumple las tres.

create or replace function public.kitchen_para_trabajar(
  p_account uuid,
  p_dias    integer default 30
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dias int := greatest(1, coalesce(p_dias, 30));
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  return (
  with viva as (
    select o.id, btrim(o.name) as nombre, lower(btrim(o.name)) as clave,
           coalesce(o.price_impact,0) as precio,
           g.id as pregunta_id, g.name as pregunta,
           coalesce(b.name,'Sin marca') as marca,
           (coalesce(b.ownership_type,'own') <> 'own') as cedida,
           exists (select 1 from modifier_recipe_impact i
                    where i.modifier_option_id = o.id and i.account_id = p_account
                      and i.status = 'confirmed'
                      and public._impacto_completo(i.impact_type,
                            i.target_recipe_item_id, i.quantity))          as decidida,
           (select max(i.confirmed_at) from modifier_recipe_impact i
             where i.modifier_option_id = o.id and i.account_id = p_account
               and i.status = 'confirmed')                                 as decidida_at
      from modifier_option o
      join modifier_group g on g.id = o.modifier_group_id
      left join brand b on b.id = g.brand_id
     where o.account_id = p_account
       and coalesce(o.is_active, true) and coalesce(g.is_active, true)
  ),
  -- Las ventas se cuentan SIN las anuladas, y las anuladas APARTE.
  ventas as (
    select v.id,
           count(*) filter (where s.cancelled_at is null)     as ventas,
           count(*) filter (where s.cancelled_at is not null) as anuladas
      from viva v
      join sale_line m on m.modifier_option_id = v.id and m.line_type = 'modifier'
      join sale s on s.id = m.sale_id and s.account_id = p_account
                 and s.sold_at >= now() - make_interval(days => v_dias)
     group by v.id
  ),
  ultima as (
    select v.id, max(s.sold_at) as cuando
      from viva v
      join sale_line m on m.modifier_option_id = v.id and m.line_type = 'modifier'
      join sale s on s.id = m.sale_id and s.account_id = p_account
                 and s.cancelled_at is null
     group by v.id
  ),
  -- MONTON 1 · por NOMBRE: resolver «Salsa Yogur» resuelve las 6.
  faltan as (
    select v.clave,
           max(v.nombre) as nombre,
           count(*) as cuantas,
           count(*) filter (where not v.cedida) as alcanzables,
           jsonb_agg(distinct v.marca) as marcas,
           (array_agg(v.id order by v.cedida, v.pregunta))[1] as por_donde_entrar
      from viva v
     where not v.decidida
     group by v.clave
  ),
  -- MONTON 2 · por FILA: retirar es de una fila en una pregunta concreta.
  sobran as (
    select v.id, v.nombre, v.pregunta_id, v.pregunta, v.marca, v.cedida,
           v.precio, v.decidida, v.decidida_at,
           coalesce(ve.anuladas, 0) as pedidos_anulados,
           u.cuando as ultima_venta,
           case when u.cuando is null then null
                else (extract(epoch from (now() - u.cuando)) / 86400)::int end as dias_sin_venderse
      from viva v
      left join ventas ve on ve.id = v.id
      left join ultima u  on u.id = v.id
     where coalesce(ve.ventas, 0) = 0
  )
  select jsonb_build_object(
    'dias', v_dias,
    'le_falta_decir_que_lleva', jsonb_build_object(
      'respuestas', (select count(*) from viva where not decidida),
      'alcanzables',(select count(*) from viva where not decidida and not cedida),
      'nombres',    (select count(*) from faltan),
      'filas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'nombre', f.nombre, 'cuantas', f.cuantas,
                 'alcanzables', f.alcanzables, 'marcas', f.marcas,
                 'entrar_por', f.por_donde_entrar)
               order by f.alcanzables desc, f.cuantas desc, f.nombre)
          from faltan f), '[]'::jsonb)),
    'no_lo_pide_nadie', jsonb_build_object(
      'respuestas',  (select count(*) from sobran),
      'alcanzables', (select count(*) from sobran where not cedida),
      'preguntas',   (select count(distinct pregunta_id) from sobran),
      'cedidas',     (select count(*) from sobran where cedida),
      'con_pedido_anulado', (select count(*) from sobran where pedidos_anulados > 0),
      'filas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', s.id, 'nombre', s.nombre, 'pregunta', s.pregunta,
                 'pregunta_id', s.pregunta_id, 'marca', s.marca,
                 'cedida', s.cedida, 'precio', s.precio,
                 'pedidos_anulados', s.pedidos_anulados,
                 'ultima_venta', s.ultima_venta,
                 'dias_sin_venderse', s.dias_sin_venderse,
                 'decidida', s.decidida, 'decidida_at', s.decidida_at)
               -- PRIMERO LAS PROPIAS, que son las que se pueden tocar. Luego,
               -- las que no se han vendido NUNCA, y despues por tiempo sin
               -- venderse. Las cedidas se ven, al final, con su etiqueta.
               order by s.cedida,
                        (s.dias_sin_venderse is not null),
                        s.dias_sin_venderse desc nulls first,
                        s.marca, s.pregunta, s.nombre)
          from sobran s), '[]'::jsonb))));
end;
$$;

comment on function public.kitchen_para_trabajar(uuid,integer) is
  'La entrada del gestor: los DOS montones sobre los que se trabaja. El que falta va por NOMBRE (resolver uno resuelve todos los que se llaman igual); el que sobra va por FILA y empieza por las PROPIAS, que son las que se pueden retirar. Las ventas no cuentan pedidos anulados, y los anulados viajan aparte para no decir un 0 pelado.';
