-- ══════════════════════════════════════════════════════════════════════════
-- B84.5 · «Ver dónde» tiene que decir el PLATO
-- ══════════════════════════════════════════════════════════════════════════
--
-- LO QUE VIO JULIO (07/09, producción): al abrir «Ver dónde» en «Salsa Yogur»
-- salían CUATRO líneas idénticas — «The Urban Kebab · «Algun extra en tu
-- pita?»» — y ninguna decía dónde. El botón se llama «Ver dónde» y no lo dice.
--
-- Y no es que las copias sean iguales: son cuatro platos DISTINTOS —Kebab de
-- Falafel, Kebab de Pollo Gyros, Kebab de Ternera Gyros y Kebab Mixto—, cada
-- uno con su grupo propio del mismo nombre. La pantalla escondía precisamente
-- lo único que las diferencia. Es la regla 30: el registro está bien y la
-- pantalla miente sobre él.
--
-- QUÉ AÑADE: `platos` a cada copia de `donde` — id y nombre de los platos en
-- los que el cliente ve ese grupo, por `modifier_group_assignment`. El id es
-- para enlazar a la ficha (`/kitchen/menu?producto=…`, destino que existe hoy);
-- el nombre es lo que se pinta.
--
-- MEDIDO ANTES DE ESCRIBIRLO (07/09, cuenta Foodint): las 7 copias que cobran
-- de «Salsa Yogur» apuntan a 1, 15, 1, 1, 1, 1 y 7 platos. O sea: hay copias de
-- un plato y copias de quince, y las dos formas tienen que leerse bien.
--
-- Sólo se cuentan platos VIVOS de la cuenta (regla 9): un plato archivado ya no
-- dice dónde aparece hoy.

create or replace function public.kitchen_extras_por_nombre(
  p_account uuid,
  p_ventana interval default interval '30 days'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_dias      integer := greatest(1, (extract(epoch from coalesce(p_ventana, interval '30 days')) / 86400)::int);
  -- ── DÍAS ENTEROS, Y EN HORA DE MADRID ───────────────────────────────────
  -- La ventana era `now() - 30 days`, que empieza a media tarde del primer
  -- día. La pantalla dice «del 9 de agosto al 7 de septiembre» y eso promete
  -- días completos: o la frase miente o la cuenta miente. Aquí se arregla en
  -- la cuenta, y la frase se pinta con las fechas que devuelve ESTA función:
  -- un solo reloj, no dos que se parecen.
  --
  -- El truncado va en `Europe/Madrid`, no en UTC (regla 4): la medianoche de
  -- Madrid del 9 son las 22:00 UTC del 8. Truncando en UTC la ventana
  -- empezaría a las 02:00 de Madrid y se comería el servicio de madrugada,
  -- que en Alcalá llega pasada la una.
  v_hasta_dia date      := (now() at time zone 'Europe/Madrid')::date;
  v_desde_dia date      := v_hasta_dia - (v_dias - 1);
  v_desde     timestamptz := (v_desde_dia::timestamp) at time zone 'Europe/Madrid';
  v_resultado jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account)) then
    raise exception 'Sin permiso para ver los extras de la cuenta %', p_account
      using errcode = '42501';
  end if;

  with copias as (
    -- Una copia = una opción de modificador que COBRA. La marca sale del grupo,
    -- y el grupo lleva su propio account_id (regla 9): sin eso, el catálogo
    -- plantilla del sistema entraría en la cuenta del cliente.
    select mo.id,
           btrim(mo.name)                          as nombre,
           mo.price_impact::numeric                as precio,
           mg.brand_id,
           coalesce(b.name, '(sin marca)')         as marca,
           mg.name                                 as grupo,
           lower(btrim(regexp_replace(regexp_replace(mo.name, '[.]', '', 'g'), '\s+', ' ', 'g'))) as clave,
           coalesce((
             select sum(case when i.impact_type in ('add_item','bundle','replace_item')
                             then public._impact_cost(i.target_recipe_item_id, i.quantity, i.unit_id)
                             else 0 end)
               from modifier_recipe_impact i
              where i.modifier_option_id = mo.id and i.status = 'confirmed'), 0)::numeric as coste,
           (select count(*) from modifier_recipe_impact i
             where i.modifier_option_id = mo.id and i.status = 'confirmed')::int as impactos,
           -- B84.5: DÓNDE lo ve el cliente. El grupo no lo dice —cuatro copias
           -- de «Algun extra en tu pita?» son cuatro platos distintos—, así que
           -- viajan los platos vivos a los que ese grupo está asignado, con su
           -- id para poder enlazar a la ficha. Por cuenta, como todo (regla 9).
           (select coalesce(jsonb_agg(jsonb_build_object('id', mi.id, 'nombre', mi.name)
                                      order by mi.name), '[]'::jsonb)
              from modifier_group_assignment ga
              join menu_item mi on mi.id = ga.menu_item_id
                               and mi.account_id = p_account
                               and mi.is_active
                               and mi.archived_at is null
             where ga.modifier_group_id = mg.id
               and ga.account_id = p_account) as platos
      from modifier_option mo
      join modifier_group mg on mg.id = mo.modifier_group_id
                            and mg.account_id = p_account            -- regla 9
      left join brand b on b.id = mg.brand_id and b.account_id = p_account
     where mo.account_id = p_account
       and mo.is_active
       and coalesce(mo.price_impact, 0) > 0
  ),
  ventas as (
    select m.modifier_option_id as id, count(*)::int as vendidas
      from sale_line m
      join sale s on s.id = m.sale_id
                 and s.account_id = p_account                        -- regla 9
                 and s.sold_at >= v_desde                            -- días enteros, Madrid
                 and coalesce(s.status, '') <> 'cancelled'
     where m.account_id = p_account
       and m.line_type = 'modifier'
     group by 1
  ),
  c as (
    select copias.*, coalesce(ventas.vendidas, 0) as vendidas
      from copias left join ventas using (id)
  ),
  grupos as (
    select c.clave,
           -- El nombre que se pinta: el de la copia que más se vende. Si nadie
           -- vende, el primero por orden. Determinista a propósito: una fila que
           -- cambia de nombre al recargar no se puede señalar por teléfono.
           (array_agg(c.nombre order by c.vendidas desc, c.nombre))[1] as nombre,
           count(*)::int                                as copias,
           count(distinct c.brand_id)::int              as marcas,
           sum(c.vendidas)::int                         as vendidas,
           round(sum(c.vendidas * c.precio), 2)         as cobrado,
           min(c.precio)                                as precio_min,
           max(c.precio)                                as precio_max,
           (min(c.precio) <> max(c.precio))             as precios_distintos,
           case when min(c.coste) > 0      then 'con_coste'
                when max(c.coste) > 0      then 'mixto'
                when max(c.impactos) > 0   then 'puesto_pero_cero'
                else                            'nada_puesto' end as estado,
           -- Para «usar el mismo que en Meraki»: lo que ya cuesta una copia del
           -- grupo, si alguna lo tiene. No se pisa lo que ya está hecho.
           max(c.coste) filter (where c.coste > 0)      as coste_ya_puesto,
           (array_agg(c.marca order by c.coste desc, c.marca)
             filter (where c.coste > 0))[1]             as marca_que_ya_lo_tiene,
           jsonb_agg(jsonb_build_object(
             'opcion',    c.id,
             'marca',     c.marca,
             'marca_id',  c.brand_id,
             'grupo',     c.grupo,
             'precio',    c.precio,
             'vendidas',  c.vendidas,
             'coste',     c.coste,
             'tiene_coste', (c.coste > 0),
             'platos',    c.platos
           ) order by c.vendidas desc, c.marca, c.nombre)  as donde
      from c
     group by c.clave
  )
  select jsonb_build_object(
    'cuenta',        p_account,
    'medido_en',     now(),
    'ventana_dias',  v_dias,
    -- QUÉ DÍAS SE HAN CONTADO. La pantalla los pinta tal cual; no los vuelve a
    -- calcular. Dos sitios calculando la misma ventana es cómo nacen los dos
    -- relojes.
    'ventana_desde', v_desde_dia,
    'ventana_hasta', v_hasta_dia,
    'cifras', jsonb_build_object(
      'cobran',             (select count(*) from c),
      'marcas_que_cobran',  (select count(distinct brand_id) from c),
      'con_coste',          (select count(*) from c where coste > 0),
      'sin_coste',          (select count(*) from c where coste = 0),
      'nombres',            (select count(*) from grupos),
      'nombres_sin_coste',  (select count(*) from grupos where estado <> 'con_coste'),
      'vendidos_sin_coste', (select count(*) from c where coste = 0 and vendidas > 0),
      'veces_vendidos',     (select coalesce(sum(vendidas),0) from c where coste = 0),
      'cobrado_eur',        (select coalesce(round(sum(vendidas * precio), 2), 0) from c where coste = 0)
    ),
    'filas', (
      select coalesce(jsonb_agg(to_jsonb(g) order by g.vendidas desc, g.copias desc, g.clave), '[]'::jsonb)
        from grupos g
    )
  ) into v_resultado;

  return v_resultado;
end;
$function$;

comment on function public.kitchen_extras_por_nombre(uuid, interval) is
  'Sección Extras. Una fila por nombre normalizado dentro de la cuenta, no por copia: copias, marcas, lo vendido, lo cobrado, si los precios difieren y si alguna copia ya tiene coste. Cada copia dice en qué platos aparece (B84.5). Devuelve TODOS los grupos; el filtro «sólo los que hay que arreglar» es de la pantalla. Sólo claves, ningún texto de pantalla.';

revoke execute on function public.kitchen_extras_por_nombre(uuid, interval) from public, anon;

-- ── GUARDA ────────────────────────────────────────────────────────────────
do $guarda$
declare v_oid oid; v_src text;
begin
  select p.oid into v_oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'kitchen_extras_por_nombre'
     and pg_get_function_identity_arguments(p.oid) = 'p_account uuid, p_ventana interval';

  if v_oid is null then
    raise exception 'GUARDA: kitchen_extras_por_nombre(uuid, interval) no existe despues de aplicar.';
  end if;
  if has_function_privilege('public', v_oid, 'EXECUTE')
     or has_function_privilege('anon', v_oid, 'EXECUTE') then
    raise exception 'GUARDA: sigue siendo ejecutable por public/anon (regla 16).';
  end if;

  select p.prosrc into v_src from pg_proc p where p.oid = v_oid;

  -- Regla 9: las tres tablas con account_id lo llevan filtrado.
  if v_src not like '%mg.account_id = p_account%' then
    raise exception 'GUARDA: el grupo de modificadores no filtra por cuenta (regla 9).';
  end if;
  if v_src not like '%s.account_id = p_account%' then
    raise exception 'GUARDA: la venta no filtra por cuenta (regla 9).';
  end if;

  -- Nada de castellano de pantalla dentro de la funcion: el texto vive en lib/.
  if v_src ~ 'nada puesto|no lleva nada|entra por caja|Decir que lleva' then
    raise exception 'GUARDA: hay texto de pantalla dentro de la funcion; el castellano va en lib/ (B83).';
  end if;

  -- La ventana tiene que ser de dias enteros y en hora de Madrid: si vuelve la
  -- movil, la frase de la pantalla promete dias que no se han contado.
  if v_src not like '%Europe/Madrid%' then
    raise exception 'GUARDA: la ventana no trunca en Europe/Madrid (regla 4).';
  end if;
  if v_src like '%sold_at >= now() -%' then
    raise exception 'GUARDA: ha vuelto la ventana movil; la pantalla prometeria dias enteros que no se cuentan.';
  end if;
  if v_src not like '%ventana_desde%' or v_src not like '%ventana_hasta%' then
    raise exception 'GUARDA: la funcion no dice que dias ha contado; la pantalla tendria que calcularlos por su cuenta.';
  end if;

  -- B84.5: los platos viajan, y los cuenta por cuenta (regla 9). Sin esto,
  -- «Ver donde» vuelve a decir el grupo, que es lo que no dice donde.
  if v_src not like '%modifier_group_assignment%' then
    raise exception 'GUARDA: las copias no dicen en que platos aparecen (B84.5).';
  end if;
  if v_src not like '%mi.account_id = p_account%' then
    raise exception 'GUARDA: los platos no se filtran por cuenta (regla 9).';
  end if;
end
$guarda$;

-- ── LA COMPROBACION EJECUTADA NO VA AQUI DENTRO, Y ESTUVO A PUNTO ────────
-- La escribi como un `do` dentro de esta migracion: llamaba a la RPC recien
-- creada y abortaba si ninguna copia traia platos. Tenia DOS fallos y los dos
-- habrian tumbado la migracion entera:
--   · usaba `from account a` y la tabla se llama `accounts` (42P01);
--   · y dentro de una migracion no hay sesion, asi que la propia RPC habria
--     lanzado 42501 «Sin permiso» antes de devolver nada.
-- Es la leccion del 06/09 —una guarda mia aborto una migracion buena— y esta
-- vez se caza antes. La comprobacion se hace DESPUES, como consulta
-- independiente con la sesion puesta, igual que las tres del 07/09: no basta el
-- «Success», pero tampoco vale una guarda que no puede funcionar donde vive.
