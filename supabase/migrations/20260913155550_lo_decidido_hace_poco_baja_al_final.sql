-- EL SOLAPE SE ARREGLA ORDENANDO, NO AVISANDO. Julio, 13/09 17:45 §3.
--
-- Yo habia propuesto avisar en la ficha. Julio: «si lo primero que ves es la
-- trampa, el cartel llega tarde». Tiene razon — un aviso al lado de la primera
-- fila es la regla 7 mal aplicada: ordena la ATENCION, no solo la etiqueta.
--
-- El caso que lo destapo: la primera fila de «no lo pide nadie» era «Carnitas
-- (Cerdo)», que Julio decidio a las 17:14:35. La pantalla de limpiar ofrecia
-- deshacer el trabajo de hacia tres horas.
--
-- LAS DOS LISTAS CONTESTAN PREGUNTAS DISTINTAS: una es CALIDAD DEL DATO («no
-- sabemos que lleva»), la otra es LA CARTA («esto no se vende»). Que una
-- respuesta este en las dos no es un error; lo que seria un error es ponerla la
-- primera.
--
-- EL ORDEN, en tres escalones y ninguno esconde nada:
--   1. Propias que nadie ha tocado en un mes -> arriba. Son las candidatas.
--   2. Propias DECIDIDAS EN LOS ULTIMOS 30 DIAS -> abajo, en su grupo, con su
--      rotulo: «Decididas hace poco, aunque todavia no se piden».
--   3. Cedidas -> al final, que no se pueden tocar.
-- Cada fila trae `decidida_reciente` para que el front pueda partir el grupo, y
-- la cabecera trae el recuento para que el rotulo diga un numero de verdad.
--
-- Banda: `stable`, no escribe, y solo la llama la pantalla nueva sin publicar.

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
           (v.decidida_at is not null
            and v.decidida_at >= now() - make_interval(days => v_dias)) as decidida_reciente,
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
      -- CANDIDATAS = propias que nadie ha tocado en un mes. Es el numero que
      -- de verdad dice cuanto hay que limpiar; el total dice cuanto hay.
      'candidatas',  (select count(*) from sobran where not cedida and not decidida_reciente),
      'alcanzables', (select count(*) from sobran where not cedida),
      'decididas_hace_poco', (select count(*) from sobran where not cedida and decidida_reciente),
      'cedidas',     (select count(*) from sobran where cedida),
      'preguntas',   (select count(distinct pregunta_id) from sobran),
      'con_pedido_anulado', (select count(*) from sobran where pedidos_anulados > 0),
      'filas', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', s.id, 'nombre', s.nombre, 'pregunta', s.pregunta,
                 'pregunta_id', s.pregunta_id, 'marca', s.marca,
                 'cedida', s.cedida, 'precio', s.precio,
                 'pedidos_anulados', s.pedidos_anulados,
                 'ultima_venta', s.ultima_venta,
                 'dias_sin_venderse', s.dias_sin_venderse,
                 'decidida', s.decidida, 'decidida_at', s.decidida_at,
                 'decidida_reciente', s.decidida_reciente)
               -- LOS TRES ESCALONES. Ninguno esconde: los tres se pintan.
               order by s.cedida,
                        s.decidida_reciente,
                        (s.dias_sin_venderse is not null),
                        s.dias_sin_venderse desc nulls first,
                        s.marca, s.pregunta, s.nombre)
          from sobran s), '[]'::jsonb))));
end;
$$;

comment on function public.kitchen_para_trabajar(uuid,integer) is
  'La entrada del gestor: los DOS montones. El que falta va por NOMBRE (resolver uno resuelve todos los que se llaman igual); el que sobra va por FILA y en TRES escalones — candidatas, decididas hace poco, y cedidas — porque avisar del solape no basta: si lo primero que ves es la trampa, el cartel llega tarde.';
