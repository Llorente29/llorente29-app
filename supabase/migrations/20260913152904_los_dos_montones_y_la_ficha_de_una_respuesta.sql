-- LA MITAD QUE LIMPIA · las dos LECTURAS. Encargo de Julio, 13/09 15:35.
--
-- El gestor servia para construir y corregir. No servia para LIMPIAR, que era
-- la otra mitad de «lo que le falte O LE SOBRE».
--
-- ── LA BANDA: cumple las tres, y por eso entra ahora ──────────────────────
--   1. NO ESTA EN EL CAMINO DEL PEDIDO. Son funciones NUEVAS: nadie las nombra
--      todavia — 0 funciones, 0 crons, 0 disparadores.
--   2. NO TOMA CIERRE EXCLUSIVO. Solo `create or replace` de funcion, y las
--      dos son `stable`: no escriben nada.
--   3. SE DICE ANTES, con la medida delante.
--
-- ── 🔴 LA CORRECCION QUE TRAE LA MEDIDA ───────────────────────────────────
--
-- El encargo dice 86 respuestas propias sin venta en 30 dias. Yo cuento 93, y
-- la diferencia son SIETE. Las siete salen de UN SOLO PEDIDO ANULADO: una
-- comanda de HubRise del 29/08 21:15 con siete modificadores —Guacamole,
-- Frijoles, Pico de Gallo, Cebolla Caramelizada, Crema Agria, Pollo y el
-- Cheesecake de Nutella, todos de Bendito Burrito.
--
-- Ninguno de los dos numeros miente; miden cosas distintas. Aqui se cuenta SIN
-- las anuladas —un pedido anulado no es demanda— asi que el monton es de 93.
-- PERO no se dice nunca un «0» pelado: al lado va cuantos pedidos anulados
-- hubo. Esconder la fila que existe es la regla 7 otra vez.
--
-- Y LO QUE DE VERDAD IMPORTA DE ESE HALLAZGO: cinco de esas siete son
-- respuestas que Julio DECIDIO HOY (14:51 y 17:14). Los dos montones se
-- solapan, y el solape es peligroso: se puede decidir que lleva el Guacamole a
-- las 14:51 y retirarlo a las 18:00 porque la pantalla dice «0 ventas». Las
-- dos pantallas dirian la verdad y la suma seria un disparate. Por eso cada
-- fila del monton que sobra viaja con `decidida` y `decidida_at`.
--
-- ── MEDIDO HOY (13/09 17:2x) ──────────────────────────────────────────────
--   propias  158 activas · 93 sin venta real en 30 dias · 28 preguntas
--   cedidas   54 activas · 30 sin venta en 30 dias · 8 preguntas
--   sin decidir 97 · 80 alcanzables · 53 nombres

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
  -- MONTON 1 · por NOMBRE, no por fila: resolver «Salsa Yogur» resuelve las 6.
  -- Por eso el orden es cuantas veces se repite, que es lo que mas rinde.
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
      -- Para poder reconciliar el 86 del encargo con el 93 de aqui sin abrir
      -- la base: estas son las que solo tienen pedidos ANULADOS.
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
               -- Las que no se han vendido NUNCA van primero; luego las que
               -- llevan mas tiempo sin venderse.
               order by (s.dias_sin_venderse is not null),
                        s.dias_sin_venderse desc nulls first,
                        s.marca, s.pregunta, s.nombre)
          from sobran s), '[]'::jsonb))));
end;
$$;

comment on function public.kitchen_para_trabajar(uuid,integer) is
  'La entrada del gestor: los DOS montones sobre los que se trabaja. El que falta va por NOMBRE (resolver uno resuelve todos los que se llaman igual); el que sobra va por FILA, porque retirar es de una fila. Las ventas no cuentan pedidos anulados, y los anulados viajan aparte para no decir un 0 pelado.';


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

comment on function public.kitchen_ficha_de_respuesta(uuid,uuid,integer) is
  'La ficha de una respuesta: nombre, que lleva, donde esta (todas las que se llaman igual, abribles) y cuanto se pide. Las ventas anuladas se cuentan aparte y nunca se esconden detras de un 0.';

revoke all on function public.kitchen_para_trabajar(uuid,integer) from public;
grant execute on function public.kitchen_para_trabajar(uuid,integer) to authenticated;
revoke all on function public.kitchen_ficha_de_respuesta(uuid,uuid,integer) from public;
grant execute on function public.kitchen_ficha_de_respuesta(uuid,uuid,integer) to authenticated;
