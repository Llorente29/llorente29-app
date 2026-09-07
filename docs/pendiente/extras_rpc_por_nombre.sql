-- ══════════════════════════════════════════════════════════════════════════
-- PENDIENTE DE APLICAR · sección Extras · maqueta aprobada (§8)
-- Va a `supabase/migrations/` con la versión que registre la base al aplicarla
-- (regla 17). Fuera de la banda 12:15–23:45.
-- ══════════════════════════════════════════════════════════════════════════
--
-- UNA FILA POR NOMBRE, no por copia. Es lo que hace que ponerle coste a «Salsa
-- Yogur» sea una pantalla y no siete.
--
-- LA NORMALIZACIÓN es la del RECON, y no es cosmética: « Sweet Chili T» empieza
-- por espacio y «Salsa coreana.» acaba en punto. Minúsculas, sin puntos,
-- espacios colapsados y recortados. Da 66 grupos sobre las 120 copias que
-- cobran, y 56 con algo que arreglar — comprobado contra producción antes de
-- escribir esto.
--
-- LO QUE NO HACE, a propósito:
--   · no decide qué se enseña: devuelve TODOS los grupos y el filtro «sólo los
--     que hay que arreglar» vive en la pantalla, donde el usuario lo ve y lo
--     puede quitar (regla 7);
--   · no escribe una palabra de lo que se pinta. Aquí sólo viajan claves
--     (`nada_puesto`, `mixto`…) y el castellano vive en `lib/`, como en B83.
--     Una definición técnica no se cuela en pantalla si nunca sale de la base.

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
             where i.modifier_option_id = mo.id and i.status = 'confirmed')::int as impactos
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
                 and s.sold_at >= now() - coalesce(p_ventana, interval '30 days')
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
             'tiene_coste', (c.coste > 0)
           ) order by c.vendidas desc, c.marca, c.nombre)  as donde
      from c
     group by c.clave
  )
  select jsonb_build_object(
    'cuenta',        p_account,
    'medido_en',     now(),
    'ventana_dias',  v_dias,
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
  'Sección Extras. Una fila por nombre normalizado dentro de la cuenta, no por copia: copias, marcas, lo vendido, lo cobrado, si los precios difieren y si alguna copia ya tiene coste. Devuelve TODOS los grupos; el filtro «sólo los que hay que arreglar» es de la pantalla. Sólo claves, ningún texto de pantalla.';

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
end
$guarda$;
