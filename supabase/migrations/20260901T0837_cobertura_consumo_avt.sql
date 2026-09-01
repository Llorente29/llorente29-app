-- ============================================================================
-- APLICADA el 01/09/2026 a las 08:37 (Madrid) = 06:37 UTC. Registrada como
-- 20260901063742. Cuerpo exacto del fichero, contrastado con diff + md5
-- (d3b8e4a848ab9df882e14a0b5f233400) antes de ejecutar.
--
-- CORRECCION APLICADA JUSTO DESPUES, y queda escrita porque el fichero estaba
-- MAL: el `revoke all ... from public` de abajo NO basta. El ACL por defecto de
-- este proyecto concede EXECUTE a `anon` DIRECTAMENTE, y revocar de PUBLIC no
-- toca una concesion nominal. Verificado al aplicar: anon podia ejecutarla.
-- Se cerro con `revoke all on function ... from anon`, que es lo que ya hacen
-- por nombre las funciones de trigger del lote de fichajes. Mismo hallazgo que
-- salio con inicio-p1 y pg_default_acl.
-- No hubo fuga: la funcion comprueba belongs_to_account antes de leer nada, y
-- para anon eso es falso. Pero un permiso que sobra hoy es el permiso que
-- manana alcanza a una funcion sin guarda.
--
-- VERIFICACION POR CONSULTA, despues de aplicar:
--   firmas de la funcion ......................... 1
--   authenticated puede ejecutarla ............... si
--   anon puede ejecutarla ........................ NO (tras la correccion)
--   stock_movement ............................... 57.425 filas
--     huella ..................................... ef6a0121729824d20cae97e9f02724fe
--   recipe_line .................................. 2.158 filas
--     huella ..................................... baf32a317764f59c6709ccb262145d0c
--   Las DOS huellas identicas a las de antes de aplicar: esto es solo lectura y
--   se demuestra, no se promete.
--
-- La RPC no se puede invocar desde la conexion de servicio (belongs_to_account
-- es falso ahi, que es lo correcto), asi que su logica se verifico con la
-- consulta equivalente sobre INV-00194.
--
-- Y un cambio respecto al ensayo de ayer, que NO es un error: ayer el unico
-- hueco era Milanesa Ternera 5/11; hoy salen DOS, Ternera 5/11 y Milanesa de
-- Pollo 12/14. La ventana es la misma (30/08 19:42 -> 31/08 19:37) y las
-- lineas vendidas tambien (115). Lo que cambio fue el CATALOGO: anoche se
-- tocaron 3 impactos de modificador (ultimo a las 23:04) y ahora hay 23
-- confirmados en vez de 22. Al vincular un modificador mas, la cobertura
-- alcanza a mirar mas cosas -- y descubre que ese tambien esta mudo. La medida
-- no ha cambiado: se ha afinado porque el catalogo crecio. Es exactamente lo
-- que tiene que pasar.
--
-- ENCARGO CODE 31/08 punto 5: "El motor deja de proponer causas que no puede
-- saber". Hoy el AvT afirma «sobre-porción en elaboración — el escandallo es
-- fiable» sin comprobar si el consumo de ese artículo se midió de verdad. Con
-- la cadena rota eso es una acusación sin fundamento, y va a alertas.
--
-- Esto NO cambia ningún movimiento de stock ni ninguna receta. Solo añade una
-- función de LECTURA que mide la cobertura real del periodo de un conteo.
--
-- Doctrina (regla 7 de la casa): la cobertura ORDENA y ETIQUETA, no esconde.
-- Ninguna fila del conteo desaparece por tener cobertura incompleta; lo que
-- desaparece es la CAUSA inventada, sustituida por el hueco declarado.
--
-- QUE MIDE, exactamente:
--   tocan      = lineas de venta del periodo cuyo escandallo (del plato, de sus
--                componentes de combo, o del impacto confirmado de uno de sus
--                modificadores) ALCANZA este articulo. Es lo que el sistema
--                SABE que deberia haber descontado.
--   descuentan = de esas, aquellas en las que el motor devuelve de verdad el
--                articulo. La diferencia son los huecos DEMOSTRABLES.
--
-- Lo que NO puede medir, y por eso se declara aparte en la fila del periodo:
--   · lineas sin mapear (menu_item_id nulo): no se sabe que tocarian.
--   · modificadores sin impacto confirmado: tampoco. Son los 205 huecos.
--   Ninguno de los dos se puede repartir por articulo sin inventar. Se cuentan
--   en la cabecera y ahi es donde el usuario los ve.
--
-- Regla 9: todo anclaje filtra por account_id. Aqui la cuenta y el local salen
-- del propio conteo, no de un nombre.
-- ============================================================================

begin;

drop function if exists public.avt_consumption_coverage(uuid);

create function public.avt_consumption_coverage(p_count_id uuid)
returns table (
  recipe_item_id      uuid,     -- NULL en la fila resumen del periodo
  lineas_tocan        integer,
  lineas_descuentan   integer,
  lineas_vendidas     integer,  -- solo fila resumen
  lineas_con_consumo  integer,  -- solo fila resumen: el motor devuelve algo
  lineas_sin_mapear   integer,  -- solo fila resumen
  modif_vendidos      integer,  -- solo fila resumen
  modif_sin_vinculo   integer,  -- solo fila resumen: opcion sin impacto confirmado
  modif_mudos         integer   -- solo fila resumen: impacto confirmado que aporta cero
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_account  uuid;
  v_location uuid;
  v_fin      timestamptz;
  v_ini      timestamptz;
begin
  select ic.account_id, ic.location_id, coalesce(ic.closed_at, ic.created_at)
    into v_account, v_location, v_fin
    from public.inventory_count ic
   where ic.id = p_count_id;

  if v_account is null then
    raise exception 'avt_consumption_coverage: conteo % no existe', p_count_id;
  end if;
  if not public.belongs_to_account(v_account) then
    raise exception 'avt_consumption_coverage: sin acceso a la cuenta %', v_account;
  end if;

  -- Corte inferior: el conteo aprobado ANTERIOR del mismo local (regla 6 de la
  -- casa: el consumo se mide con corte en el ultimo conteo aprobado).
  select coalesce(p.closed_at, p.created_at) into v_ini
    from public.inventory_count p
   where p.location_id = v_location
     and p.status = 'aprobado'
     and p.id <> p_count_id
     and coalesce(p.closed_at, p.created_at) < v_fin
   order by coalesce(p.closed_at, p.created_at) desc
   limit 1;
  v_ini := coalesce(v_ini, '-infinity'::timestamptz);

  return query
  with lin as (
    select sl.id, sl.menu_item_id, sl.parent_sale_line_id,
           sl.modifier_option_id, coalesce(sl.line_type,'product') as lt
      from public.sale_line sl
      join public.sale s on s.id = sl.sale_id
     where sl.account_id = v_account
       and s.location_id = v_location
       and s.sold_at >  v_ini
       and s.sold_at <= v_fin
       and sl.ignored_at is null
       and coalesce(s.status,'') <> 'cancelled'
       and coalesce(s.order_status,'') not in ('cancelled','rejected')
       and coalesce(s.is_active, true)
  ),
  prod as (select * from lin where lt = 'product'),
  -- Lo que el motor devuelve DE VERDAD, por linea de producto.
  motor as (
    select p.id, t.raw_item_id
      from prod p
      cross join lateral public._sale_line_raw_consumption(p.id) t
  ),
  -- Lo que el sistema SABE que deberia tocar.
  deberia as (
      select p.id, e.raw_item_id
        from prod p
        join public.menu_item m on m.id = p.menu_item_id
        cross join lateral public.explode_recipe_to_raws(m.recipe_item_id, 1) e
    union
      select p.id, e.raw_item_id
        from prod p
        join lin c on c.parent_sale_line_id = p.id and c.lt = 'combo_item'
        join public.menu_item m on m.id = c.menu_item_id
        cross join lateral public.explode_recipe_to_raws(m.recipe_item_id, 1) e
    union
      select p.id, e.raw_item_id
        from prod p
        join lin md on md.parent_sale_line_id = p.id and md.lt = 'modifier'
        join public.modifier_recipe_impact i
          on i.modifier_option_id = md.modifier_option_id and i.status = 'confirmed'
        cross join lateral public.explode_recipe_to_raws(i.target_recipe_item_id, 1) e
    union
      select p.id, e.raw_item_id
        from prod p
        join lin c  on c.parent_sale_line_id = p.id and c.lt = 'combo_item'
        join lin md on md.parent_sale_line_id = c.id and md.lt = 'modifier'
        join public.modifier_recipe_impact i
          on i.modifier_option_id = md.modifier_option_id and i.status = 'confirmed'
        cross join lateral public.explode_recipe_to_raws(i.target_recipe_item_id, 1) e
  ),
  contados as (
    select distinct cl.recipe_item_id as id
      from public.inventory_count_line cl
     where cl.inventory_count_id = p_count_id
       and cl.recipe_item_id is not null
  ),
  por_articulo as (
    select d.raw_item_id as ri,
           count(*)::int as tocan,
           count(*) filter (where mo.id is not null)::int as descuentan
      from deberia d
      join contados c on c.id = d.raw_item_id
      left join motor mo on mo.id = d.id and mo.raw_item_id = d.raw_item_id
     group by d.raw_item_id
  ),
  -- Un modificador APORTA si su impacto confirmado se puede traducir a la
  -- unidad base del destino Y su tipo de impacto lo entiende el motor. Los tres
  -- fallos silenciosos que existen hoy: unidad nula, dimension no convertible
  -- sin tabla de conversion, y un impact_type que ninguna rama del motor mira.
  modif as (
    select md.id,
           exists (
             select 1 from public.modifier_recipe_impact i
              where i.modifier_option_id = md.modifier_option_id
                and i.status = 'confirmed'
           ) as vinculado,
           exists (
             select 1 from public.modifier_recipe_impact i
              where i.modifier_option_id = md.modifier_option_id
                and i.status = 'confirmed'
                and i.impact_type in ('add_item','bundle','replace_item','remove_item','multiply')
                and (
                  i.impact_type = 'multiply'
                  or public._qty_in_base(i.target_recipe_item_id, i.quantity, i.unit_id) is not null
                )
           ) as aporta
      from lin md
     where md.lt = 'modifier'
  ),
  resumen as (
    select
      (select count(*) from prod)::int as vendidas,
      (select count(distinct mo.id) from motor mo)::int as con_consumo,
      (select count(*) from prod p
        where p.menu_item_id is null
          and not exists (select 1 from lin c
                           where c.parent_sale_line_id = p.id and c.lt = 'combo_item'))::int as sin_mapear,
      (select count(*) from modif)::int as mod_total,
      (select count(*) from modif where not vinculado)::int as mod_sin_vinculo,
      (select count(*) from modif where vinculado and not aporta)::int as mod_mudos
  )
  select pa.ri, pa.tocan, pa.descuentan,
         null::int, null::int, null::int, null::int, null::int, null::int
    from por_articulo pa
  union all
  select null::uuid, null::int, null::int,
         r.vendidas, r.con_consumo, r.sin_mapear, r.mod_total, r.mod_sin_vinculo, r.mod_mudos
    from resumen r;
end;
$function$;

comment on function public.avt_consumption_coverage(uuid) is
  'Cobertura real del consumo en la ventana de un conteo. Devuelve una fila por '
  'articulo contado (tocan / descuentan) y UNA fila resumen con recipe_item_id '
  'nulo (lineas vendidas, con consumo, sin mapear, modificadores sin vinculo y '
  'mudos). '
  'Solo lectura: no escribe movimientos ni toca recetas. ENCARGO 31/08 punto 5.';

revoke all on function public.avt_consumption_coverage(uuid) from public;
-- OJO: `from public` NO basta en este proyecto (ver cabecera). Hace falta
-- tambien por nombre, o anon se queda con el EXECUTE del ACL por defecto.
revoke all on function public.avt_consumption_coverage(uuid) from anon;
grant execute on function public.avt_consumption_coverage(uuid) to authenticated;

commit;

-- ============================================================================
-- VERIFICACION (ejecutar despues, pegar resultado):
--
-- 1) La funcion existe una sola vez (regla 2 de la casa: nunca sobrecargas):
--    select proname, pg_get_function_identity_arguments(oid)
--      from pg_proc where proname='avt_consumption_coverage';
--
-- 2) Sobre el conteo INV-00194 (Alcala, 31/08) debe devolver 23 filas de
--    articulo + 1 resumen, y la unica con hueco debe ser Milanesa Ternera
--    Rebozado 5/11:
--    select ri.name, c.lineas_tocan, c.lineas_descuentan
--      from public.avt_consumption_coverage('c25b1941-e8ff-4086-a0c4-dc46a87e8a51') c
--      join public.recipe_item ri on ri.id=c.recipe_item_id
--     where c.lineas_descuentan < c.lineas_tocan;
--
-- 3) Ningun movimiento de stock cambia (huella antes/despues):
--    select count(*), md5(string_agg(id::text, ',' order by id))
--      from public.stock_movement;
-- ============================================================================
