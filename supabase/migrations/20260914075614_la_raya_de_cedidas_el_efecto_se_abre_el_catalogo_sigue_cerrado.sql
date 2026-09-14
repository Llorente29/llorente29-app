-- ═══════════════════════════════════════════════════════════════════════════
-- LA RAYA DE CEDIDAS · el EFECTO se abre, el CATÁLOGO sigue cerrado
-- 14/09/2026 · Foodint 51ad1792-6629-4ef7-833a-b57b09a86710
-- ═══════════════════════════════════════════════════════════════════════════
--
-- QUÉ ES UNA CEDIDA. Una marca con `brand.ownership_type <> 'own'`: la carta la
-- manda Last y el importador la vuelve a escribir de madrugada. Su NOMBRE, su
-- PRECIO y qué respuestas existen no son nuestros: se pisan solos.
--
-- PERO LA FICHA SÍ ES NUESTRA. Lo que consume del almacén una respuesta
-- --`modifier_recipe_impact`-- lo escribimos nosotros, vive en nuestra tabla, y
-- el importador no la toca. Eso no es una opinión, está medido:
--
--   · 55 respuestas en 5 marcas cedidas (54 vivas). 37 ya tienen ficha.
--   · 18 DE ESAS 37 fueron tocadas por el importador DESPUÉS de escribirles la
--     ficha --el último toque, 11/09 12:11-- y la ficha sigue ahí. La más
--     vieja es del 17/06: tres meses de pasadas por encima.
--   · Y el motor consume de verdad en cedidas: de 203 líneas de modificador
--     vendidas en 30 días con ficha, 54 movieron su artículo; en propias, 394
--     de 1.039. No está capado por tipo de marca.
--
-- ── LO QUE ESTA MIGRACIÓN ARREGLA DE VERDAD, Y NO ES LO QUE YO CREÍA ────────
--
-- Venía a «abrir el efecto en cedidas para poder decidirlas en lote». Al medir,
-- eso desbloquea UNA. Lo que hay de verdad es peor y es de la familia de la
-- regla 30:
--
--   🔴 LA PANTALLA MIENTE SOBRE TRABAJO YA HECHO. `kitchen_las_iguales` evalúa
--      `cedida` ANTES que `ya_decidida` en su CASE, así que una cedida que YA
--      TIENE FICHA sale con motivo «cedida» y la pantalla escribe «1 está en
--      una marca que manda Last y no se toca».
--
--      Las dos mitades de esa frase son falsas:
--        (a) SÍ se toca --`kitchen_extras_poner_lo_que_lleva` nunca ha mirado
--            `ownership_type`; por ahí se escribieron las 37--, y
--        (b) esconde que esa respuesta YA ESTÁ RESUELTA.
--
--      Medido: de las 17 cedidas que hoy salen en la caja de «las iguales» de
--      otra respuesta, 16 YA ESTÁN DECIDIDAS. El caso de mano: «Sin pepinillos»
--      de Lovers Burgers enseña a Lobbers con motivo «cedida», y el de Lobbers
--      tiene ficha que descuenta desde hace meses.
--
--      Quien lo mire concluye que hay trabajo pendiente en cedidas que no
--      existe, o que una cedida no se puede costear. Las dos cosas son mentira,
--      y la segunda lleva a rehacer lo hecho (regla 30, 05/09).
--
-- ── DÓNDE QUEDA LA RAYA, DICHA ENTERA ──────────────────────────────────────
--
-- ABIERTO en cedidas (el EFECTO · lo nuestro · sobrevive al importador):
--   · kitchen_extras_poner_lo_que_lleva  ← ya estaba abierto, nunca se cerró
--   · kitchen_aplicar_a_las_iguales      ← se abre aquí
--   · kitchen_las_iguales                ← se abre aquí (es quien las lista)
--
-- CERRADO en cedidas (el CATÁLOGO · de Last · se pisa de madrugada). NO SE
-- TOCAN en esta migración, y se dice para que se vea que es a propósito:
--   · kitchen_guardar_pregunta          (alta y edición: nombre, precio)
--   · kitchen_poner_pregunta_en_platos  (meterla en platos)
--   · kitchen_quitar_pregunta_de_plato  (sacarla de un plato)
--   · kitchen_retirar                   (apagar / encender)
--
-- El criterio, en una línea: **se abre lo que el importador no pisa.**
--
-- ── LO QUE NO CAMBIA ───────────────────────────────────────────────────────
--
-- · No se escribe NI UNA fila de datos. Sólo dos `create or replace`.
-- · El freno de la regla 3 sigue: sin artículo o sin cantidad, `_impacto_completo`
--   aborta igual, en cedidas y en propias.
-- · La guarda de cuenta (regla 9) sigue: una opción de otra cuenta aborta el
--   lote entero.
-- · La banda: dos `create or replace` de función no toman cierre exclusivo
--   sobre ninguna tabla. Contado antes de escribir esto: 0 disparadores, 0
--   crons y 0 LLAMADAS desde otras funciones. La primera cuenta dio 1 y era un
--   comentario --dentro de `_impacto_completo`, y el comentario era el aviso
--   del 13/09 sobre contar menciones en vez de llamadas--. El contador del
--   ensayo cuenta llamadas, con el escapado probado contra esa muestra.
-- ═══════════════════════════════════════════════════════════════════════════


-- ── ① LA LISTA · las cedidas entran, y «cedida» deja de ser un motivo ──────

create or replace function public.kitchen_las_iguales(p_account uuid, p_option_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_clave text;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;

  select lower(btrim(o.name)) into v_clave
    from modifier_option o
   where o.id = p_option_id and o.account_id = p_account;
  if v_clave is null then
    return jsonb_build_object('iguales', '[]'::jsonb, 'fuera', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    -- LAS QUE SE PUEDEN RESOLVER: mismo nombre, activas y SIN decidir todavia.
    -- Las que ya tienen efecto no salen: pisar una decision que alguien tomo a
    -- mano, sin pedirlo, seria lo contrario de esto.
    --
    -- «SIN DECIDIR» = sin ficha QUE DESCUENTE ALGO (13/09). Antes bastaba una
    -- fila confirmada, y una respuesta con ficha sin cantidad se quedaba fuera
    -- como «ya decidida»: la unica pantalla que podia arreglarla de un golpe
    -- era justo la que la escondia.
    --
    -- CEDIDAS DENTRO (14/09). Antes esta lista exigia marca propia. Lo que
    -- escribimos aqui es la FICHA, y la ficha es nuestra: el importador no la
    -- pisa --18 de 37 lo demuestran, tocadas despues y con su ficha intacta--.
    -- Cada fila dice si es cedida para que la pantalla pueda decirlo: se abre
    -- la puerta, no se disimula por donde se entra.
    'iguales', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'nombre', o.name,
               'pregunta', g.name, 'marca', b.name,
               'cedida', (coalesce(b.ownership_type,'own') <> 'own'),
               'precio', coalesce(o.price_impact,0))
             -- Propias primero, cedidas al final: agrupadas, no mezcladas.
             order by (coalesce(b.ownership_type,'own') <> 'own'), b.name, g.name), '[]'::jsonb)
        from modifier_option o
        join modifier_group g on g.id = o.modifier_group_id
        left join brand b on b.id = g.brand_id
       where o.account_id = p_account
         and o.id <> p_option_id
         and lower(btrim(o.name)) = v_clave
         and coalesce(o.is_active, true) and coalesce(g.is_active, true)
         and not exists (select 1 from modifier_recipe_impact i
                          where i.modifier_option_id = o.id and i.status = 'confirmed'
                            and public._impacto_completo(i.impact_type,
                                                        i.target_recipe_item_id,
                                                        i.quantity))),
    -- LAS QUE SE QUEDAN FUERA, Y POR QUE. No se esconden (regla 7): quien mira
    -- tiene que poder ver que hay 3 mas que no se tocan, y el motivo.
    --
    -- 🔴 «CEDIDA» YA NO ES UN MOTIVO (14/09). Lo era, y ademas se evaluaba el
    -- PRIMERO en este CASE, asi que tapaba a `ya_decidida`: 16 de las 17
    -- cedidas que salian aqui YA TENIAN FICHA y la pantalla las anunciaba como
    -- intocables. Eso es esconder trabajo hecho (regla 30). Ahora una cedida
    -- sale fuera por lo mismo que cualquier otra --ya decidida, o apagada-- y
    -- lleva su etiqueta al lado en vez de en lugar del motivo.
    'fuera', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', o.id, 'nombre', o.name,
               'pregunta', g.name, 'marca', b.name,
               'cedida', (coalesce(b.ownership_type,'own') <> 'own'),
               'motivo', case
                 when exists (select 1 from modifier_recipe_impact i
                               where i.modifier_option_id = o.id and i.status='confirmed'
                                 and public._impacto_completo(i.impact_type,
                                                             i.target_recipe_item_id,
                                                             i.quantity))
                   then 'ya_decidida'
                 else 'apagada' end)
             order by b.name, g.name), '[]'::jsonb)
        from modifier_option o
        join modifier_group g on g.id = o.modifier_group_id
        left join brand b on b.id = g.brand_id
       where o.account_id = p_account
         and o.id <> p_option_id
         and lower(btrim(o.name)) = v_clave
         and (not coalesce(o.is_active, true) or not coalesce(g.is_active, true)
              or exists (select 1 from modifier_recipe_impact i
                          where i.modifier_option_id = o.id and i.status='confirmed'
                            and public._impacto_completo(i.impact_type,
                                                        i.target_recipe_item_id,
                                                        i.quantity)))));
end;
$fn$;

-- ── ② EL LOTE · deja de abortar por marca cedida ───────────────────────────

create or replace function public.kitchen_aplicar_a_las_iguales(
  p_account uuid, p_opciones uuid[], p_efecto jsonb, p_actor text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_tipo   text := nullif(p_efecto->>'tipo','');
  v_ficha  uuid := nullif(p_efecto->>'ficha','')::uuid;
  v_mala   text;
  v_op     uuid;
  v_n      int := 0;
  v_ced    int := 0;
  v_nombres text[] := '{}';
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para decidir qué llevan los extras de la cuenta %', p_account
      using errcode = '42501';
  end if;

  if p_opciones is null or array_length(p_opciones,1) is null then
    raise exception 'No se ha elegido ninguna respuesta.' using errcode = '22023';
  end if;
  if v_tipo is null then
    raise exception 'No se ha dicho qué lleva.' using errcode = '22023';
  end if;
  if v_tipo not in ('add_item','remove_item','replace_item','multiply','bundle','none') then
    raise exception 'El efecto «%» no existe. No se ha escrito nada.', v_tipo using errcode = '22023';
  end if;

  -- 🔴 SIN CANTIDAD NO DESCUENTA NADA (13/09). Aqui pesa el doble: un efecto
  -- a medias repartido en lote son N respuestas que dicen «decidida» y
  -- descuentan cero, no una.
  if not public._impacto_completo(v_tipo, v_ficha,
                                  nullif(p_efecto->>'cantidad','')::numeric) then
    raise exception
      'Al efecto le falta el articulo o la cantidad: asi no descontaria nada del almacen, aunque las respuestas quedaran como decididas. No se ha escrito nada.'
      using errcode = '22023';
  end if;

  -- CONDICION 2 · SOLO DE ESTA CUENTA, y se ABORTA entero si alguna no lo es.
  -- Un lote que se salta filas en silencio es peor que uno que falla: quien lo
  -- lanza cree que ha resuelto 7 y ha resuelto 4.
  --
  -- 🔴 AQUI ESTABA TAMBIEN LA MARCA CEDIDA, Y SE QUITA (14/09). Abortaba con
  -- «La carta de X la manda Last: sus respuestas no se tocan aqui». Lo que se
  -- escribe aqui no es la carta: es la FICHA, que es nuestra y que el
  -- importador no pisa (18 de 37 medidas, tocadas despues y con ficha intacta).
  -- Y la puerta de una en una --`kitchen_extras_poner_lo_que_lleva`-- nunca
  -- miro `ownership_type`: por ahi se escribieron esas 37. Este aborto no
  -- protegia nada; hacia que dos puertas dijeran lo contrario que la tercera.
  --
  -- Lo que SIGUE cerrado en cedidas es el catalogo: nombre, precio, alta en
  -- platos y retirada. Ver la cabecera del fichero.
  if exists (select 1 from unnest(p_opciones) x(id)
              where not exists (select 1 from modifier_option o
                                 where o.id = x.id and o.account_id = p_account)) then
    raise exception 'Alguna respuesta no es de esta cuenta. No se ha escrito nada.'
      using errcode = '42501';
  end if;

  -- La ficha, viva y de la cuenta. Mismo criterio que el resto: una archivada
  -- tiene el precio del dia en que se archivo.
  if v_ficha is not null then
    select ri.name into v_mala from recipe_item ri
     where ri.id = v_ficha
       and (ri.account_id <> p_account or not ri.is_active or ri.archived_at is not null);
    if v_mala is not null then
      raise exception 'La ficha «%» está archivada o no es de esta cuenta. No se ha escrito nada.', v_mala
        using errcode = '42501';
    end if;
    if not exists (select 1 from recipe_item ri where ri.id = v_ficha) then
      raise exception 'Esa ficha no existe. No se ha escrito nada.' using errcode = '42501';
    end if;
  end if;

  -- CONDICION 3 · RASTRO POR FILA. Se escribe una a una, con su quien y su
  -- cuando, igual que si se hubieran hecho a mano de una en una.
  foreach v_op in array p_opciones loop
    delete from modifier_recipe_impact
     where modifier_option_id = v_op and account_id = p_account and status = 'confirmed';

    insert into modifier_recipe_impact (
      account_id, modifier_option_id, impact_type, target_recipe_item_id,
      quantity, unit_id, status, source, rationale,
      confirmed_by, confirmed_by_name, confirmed_at)
    values (
      p_account, v_op, v_tipo, v_ficha,
      nullif(p_efecto->>'cantidad','')::numeric,
      nullif(p_efecto->>'unidad','')::uuid,
      'confirmed', 'human',
      'Decidido a la vez para las respuestas que se llaman igual',
      auth.uid(), p_actor, now());

    v_n := v_n + 1;
    -- Se cuentan las cedidas para poder DECIRLO en la confirmacion (regla 8):
    -- «resuelta en 4 sitios, 1 de ellos una marca que manda Last» dice algo.
    select array_append(v_nombres, b.name || ' · ' || g.name),
           v_ced + (case when coalesce(b.ownership_type,'own') <> 'own' then 1 else 0 end)
      into v_nombres, v_ced
      from modifier_option o
      join modifier_group g on g.id = o.modifier_group_id
      left join brand b on b.id = g.brand_id
     where o.id = v_op;
  end loop;

  return jsonb_build_object(
    'resueltas', v_n,
    'cedidas',   v_ced,
    'donde',     to_jsonb(v_nombres),
    'efecto',    v_tipo,
    'actor',     p_actor);
end;
$fn$;

-- ── ③ EL ENSAYO, DENTRO DE ESTA MISMA TRANSACCIÓN ──────────────────────────
--
-- La linea de base se toma AQUI, no antes y fuera (Julio, 13/09 21:05): lo que
-- se compara son DIFERENCIAS medidas con la misma vara a los dos lados, no
-- cifras absolutas que ya se han movido. Si una identidad falla, la migracion
-- entera se cae y no queda nada escrito.

do $ensayo$
declare
  v_acc   uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_op    uuid;
  v_res   jsonb;
  v_ig    int;
  v_fu    int;
  v_ced   int;
  v_filas bigint;
  v_puertas int;
  v_camino  int;
begin
  -- (a) NO SE ESCRIBE NI UNA FILA DE DATOS.
  select count(*) into v_filas from modifier_recipe_impact where account_id = v_acc;

  -- (b) LAS CUATRO PUERTAS DEL CATALOGO SIGUEN CERRADAS. Se cuentan, no se
  --     suponen: si una migracion futura le quita el freno a una, esto revienta.
  select count(*) into v_puertas
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('kitchen_guardar_pregunta','kitchen_poner_pregunta_en_platos',
                       'kitchen_quitar_pregunta_de_plato','kitchen_retirar')
     and p.prosrc ~* 'ownership_type';
  if v_puertas <> 4 then
    raise exception 'El catalogo tenia que seguir cerrado en 4 puertas y estan cerradas %. No se aplica nada.', v_puertas;
  end if;

  -- (c) LA BANDA, CONTADA. Nadie del camino del pedido llama a estas dos.
  --
  -- 🔴 SE CUENTAN LLAMADAS, NO MENCIONES, y esta vez se sabe por que. La
  -- primera version de este contador buscaba el nombre a secas y daba 1: la
  -- aparicion estaba en un COMENTARIO de `_impacto_completo` --y el comentario
  -- era, literalmente, el aviso que se escribio el 13/09 cuando la tanda
  -- abortó por contar menciones--. El escapado se probo antes contra esa
  -- muestra conocida: 1 mencion, 0 llamadas. Medido en toda la base: 0.
  select coalesce(sum((select count(*) from regexp_matches(
           p.prosrc,
           '(^|[^_[:alnum:].])(kitchen_las_iguales|kitchen_aplicar_a_las_iguales)[[:space:]]*\(',
           'g'))), 0)::int
    into v_camino
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname not in ('kitchen_las_iguales','kitchen_aplicar_a_las_iguales');
  if v_camino <> 0 then
    raise exception 'Hay % llamadas a estas dos desde otras funciones; habia que contarlo antes de tocarlas.', v_camino;
  end if;
  if exists (select 1 from cron.job where command ~* '(kitchen_las_iguales|kitchen_aplicar_a_las_iguales)') then
    raise exception 'Un cron llama a estas dos. No se aplica nada.';
  end if;

  -- (d) EL CASO DE MANO, con datos REALES (regla 31): «Sin pepinillos» de
  --     Lovers Burgers. Antes de esto, su caja enseñaba a Lobbers con motivo
  --     «cedida» --y Lobbers YA TIENE FICHA--. Ahora tiene que decir la verdad.
  select mo.id into v_op
    from modifier_option mo
    join modifier_group g on g.id = mo.modifier_group_id
    join brand b on b.id = g.brand_id
   where mo.account_id = v_acc and b.name = 'Lovers Burgers'
     and lower(btrim(mo.name)) = 'sin pepinillos'
   limit 1;

  if v_op is null then
    raise exception 'No se encuentra «Sin pepinillos» de Lovers Burgers: el ensayo no se puede hacer, y eso ES el hallazgo.';
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"673fca49-f6b5-40ed-a8f7-558390acce10","role":"authenticated"}', true);
  v_res := public.kitchen_las_iguales(v_acc, v_op);

  select count(*) into v_ig  from jsonb_array_elements(v_res->'iguales');
  select count(*) into v_fu  from jsonb_array_elements(v_res->'fuera');
  select count(*) into v_ced from jsonb_array_elements(v_res->'fuera') f
   where f->>'motivo' = 'cedida';

  if v_ced <> 0 then
    raise exception 'Sigue habiendo % filas con motivo «cedida»: el CASE no se ha arreglado.', v_ced;
  end if;
  if v_fu <> 4 then
    raise exception 'El caso de mano tenia 4 fuera y ahora tiene %.', v_fu;
  end if;
  if not exists (select 1 from jsonb_array_elements(v_res->'fuera') f
                  where f->>'marca' = 'Lobbers' and f->>'motivo' = 'ya_decidida'
                    and (f->>'cedida')::boolean) then
    raise exception 'Lobbers tenia que salir como «ya_decidida» y con la etiqueta de cedida. No sale.';
  end if;

  -- (e) Y NO SE HA ESCRITO NADA.
  if (select count(*) from modifier_recipe_impact where account_id = v_acc) <> v_filas then
    raise exception 'Se han escrito filas de datos y esta migracion no escribe ninguna.';
  end if;

  raise notice 'ENSAYO OK · iguales=% · fuera=% · motivo cedida=% · puertas del catalogo cerradas=% · llamantes=%',
    v_ig, v_fu, v_ced, v_puertas, v_camino;
end;
$ensayo$;

