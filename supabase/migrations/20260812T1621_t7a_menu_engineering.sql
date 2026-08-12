-- supabase/migrations/20260812T1621_t7a_menu_engineering.sql
--
-- ENCARGO T7.a — RPC `menu_engineering` + normalización de canales. SOLO
-- LECTURA (no toca ninguna tabla). Diseño aprobado por Julio 12/08:
-- docs/folvy_t7_rentabilidad_viva_diseno_20260812.md.
-- ============================================================================
-- Aplicada: (pendiente — la ejecuta Julio y verifica)
--
-- RECON contra producción antes de escribir esto (cuenta
-- 51ad1792-6629-4ef7-833a-b57b09a86710, ventana 90 días):
--
-- 1) "93 de 336 ingredientes sin coste" (cifra citada en el diseño) se
--    reproduce EXACTO con: count(*) sobre TODO recipe_item (336 filas, los
--    5 `type`: dish/packaging/raw/recipe/tool) donde computed_cost IS NULL
--    OR computed_cost = 0. Confirma que "sin coste" = null-o-cero, no solo
--    null — un recipe_item con datos incompletos cae a computed_cost=0
--    (visto en vivo: un plato con 0 líneas de receta tiene computed_cost='0'
--    Y completeness->>'cost_incomplete'=false — ese campo `completeness` NO
--    sirve para detectar "receta vacía", da un falso "completo" vacuo. Y
--    tampoco sirve para "incompleta": para esta cuenta, TODAS las recetas
--    con líneas tienen cost_incomplete=false, incluidas las que de verdad
--    tienen ingredientes a 0€. Está descartado como fuente; la salud se
--    recalcula aquí desde recipe_line + recipe_item.computed_cost.
--
-- 2) salud_escandallo se calcula con un recorrido RECURSIVO de recipe_line
--    (un plato puede tener sub-recetas, no solo ingredientes crudos —
--    recipe_line es minúscula, 956 filas totales, recorrerla entera no
--    pesa). vacia = 0 líneas directas. incompleta = existe alguna HOJA
--    (nodo sin hijos en recipe_line) del árbol completo con computed_cost
--    null o 0. completa = todo lo demás.
--    Verificado contra los 115 recetas-en-uso de hoy: vacía da 17/17 y
--    6.911€ — coincide con el diseño (17 recetas, 6.906€) casi exacto.
--
-- 3) ⚠️ DESVIACIÓN frente a las cifras reconfirmadas por Julio (77
--    completa / 21 incompleta): esta regla da 72 completa / 26 incompleta
--    (mismo total, 98). Rastreado hasta el detalle: 8 de esas 26 SOLO
--    tienen un problema de packaging (p.ej. "Bolsa Marron Con Asas" o
--    "Caja Milanesa Neutra" a 0€) — si el packaging no contara para la
--    salud del escandallo, subirían a completa, pero probado así da 84/14
--    (se pasa en la otra dirección: 84 > 77). No hay una regla que
--    reproduzca 77/21 exacto sin excluir packaging de forma parcial y no
--    documentada. Se implementa la versión MÁS ESTRICTA (packaging cuenta
--    igual que un ingrediente crudo: 72/26) porque es la que sigue al pie
--    de la letra la regla del §2 ("todos los ingredientes con coste") sin
--    inventar una excepción — y porque el principio rector de este mismo
--    encargo es no confiar de más en datos incompletos. Julio decide si
--    hay que excluir packaging de la salud del escandallo; con ese dato
--    esto se ajusta en una migración aparte (sustitución quirúrgica, no
--    tocar esta).
--
-- 4) ⚠️ HALLAZGO MÁS IMPORTANTE — la regla del §2 no resuelve el caso que
--    motivó todo el diseño. "The Mixed Master: Pita Mixta Gyros" (el
--    ejemplo citado en el propio diseño, coste 2,17€) sigue clasificando
--    como COMPLETA con esta regla: todos sus ingredientes tienen ALGÚN
--    coste registrado (ninguno es null ni 0), solo que ese coste es
--    demasiado bajo — probablemente un error de cantidad/unidad en el
--    escandallo, no un dato ausente. "Sin coste" (dato que falta) y
--    "coste implausible" (dato que está mal) son problemas DISTINTOS; el
--    diseño solo blinda contra el primero. No se implementa aquí ninguna
--    detección de "coste implausible" (p.ej. food_cost_pct fuera de un
--    rango razonable) porque eso exigiría inventar un umbral — exactamente
--    lo que el §2 prohíbe ("no se rellena con un valor plausible"). Queda
--    como pregunta abierta para Julio: ¿hace falta una CUARTA categoría de
--    salud ("sospechoso") además de completa/incompleta/vacía?
--
-- 5) Canales duplicados por mayúsculas confirmado en vivo: Glovo 78.797€ +
--    glovo 15.256€, Uber 32.800€ + uber 8.689€, JustEat 3.572€ + justeat
--    547€. lower(btrim(...)) los colapsa correctamente sin mapa adicional
--    (ningún canal usa un alias distinto, solo mayúsculas). fuente:
--    coalesce(sales_channel.name, sale.external_channel_text) — confirma
--    la sospecha del diseño (§3.2).
--
-- 6) Rendimiento medido con EXPLAIN ANALYZE ANTES de escribir esto (regla
--    obligatoria del encargo): consulta completa (agregado + salud
--    recursiva + cuadrante) = 1.139 ms sobre 90 días / ~13.000 filas de
--    sale_line. El cuello de botella es sale_line (idx_sale_line_menu_item
--    no lleva account_id como columna líder → post-filtra 994 filas de
--    más); recipe_line (956 filas totales) no pesa nada. No se crea índice
--    nuevo aquí — el encargo es "solo lectura" y 1,1s es tolerable para
--    una pantalla de gerencia sin refresco automático, a diferencia de
--    orders_feed_by_token. Si T7.b necesita filtros interactivos más
--    ágiles, el índice a añadir sería sale_line(account_id, menu_item_id).
--
-- 7) Cuadrante: agrupado por MARCA (brand_id) — es lo único listado como
--    dimensión de salida en el diseño y respeta de raíz la separación
--    propias/cedidas (ownership_type es un atributo de marca, nunca mixto
--    dentro de una marca). Popularidad = unidades por encima/debajo de la
--    media simple del grupo. Margen = por encima/debajo de la media
--    PONDERADA del grupo (sum(margen_total)/sum(unidades) — no la media
--    simple de margen_ud, tal como pide el diseño literalmente). Los
--    umbrales se calculan SOLO sobre platos con salud_escandallo='completa'
--    (un plato incompleto/vacío no contamina la media del grupo).
--
-- 8) comision_canal / margen_neto (columnas listadas en el diseño §4) NO
--    se incluyen aquí — el propio diseño las asigna a T7.c ("Eje canal con
--    comisiones"), fase posterior. Se omiten en vez de devolver un null de
--    relleno, para no dar la falsa impresión de "ya calculado, da 0".
--
-- 9) ⚠️ GRANULARIDAD — una fila por (plato, MARCA), no por receta. El
--    diseño pide "plato · marca" como columnas de salida, y una misma
--    receta puede venderse bajo varias marcas (p.ej. "Tarta 3 Leches" está
--    en 14 marcas): cada combinación es una fila. Consecuencia medida: 271
--    filas totales hoy, de las que 117 salen 'vacia' — NO son 17 recetas
--    vacías repetidas 117 veces por azar, son 17 recetas × cuántas marcas
--    comparten cada una. Para "qué escandallos arreglar" (pregunta de
--    receta, no de carta) hay que agrupar aparte por recipe_item_id — así
--    se construyó la lista priorizada que se entrega en el informe de este
--    encargo, no está en esta función. Si T7.b necesita ambas vistas,
--    valorar una función hermana `menu_engineering_por_receta` en vez de
--    forzar dos formas de leer la misma tabla.
--
-- Guard: current_user_is_admin_or_manager_of (mismo patrón que
-- search_products_86 / set_products_availability_bulk — RPC de sesión web,
-- no de dispositivo).
-- ============================================================================

create or replace function public.menu_engineering(
  p_account_id uuid,
  p_from timestamptz default (now() - interval '90 days'),
  p_to timestamptz default now(),
  p_ownership text default null,   -- 'own' | 'licensed' | null (ambas)
  p_channel text default null,     -- canal normalizado (case-insensitive) | null (todos)
  p_location_id uuid default null  -- null = todos los locales
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if not (public.current_user_is_admin()
          or public.current_user_is_admin_or_manager_of(p_account_id)) then
    raise exception 'menu_engineering: sin acceso a la cuenta %', p_account_id;
  end if;
  if p_ownership is not null and p_ownership not in ('own', 'licensed') then
    raise exception 'menu_engineering: p_ownership debe ser own, licensed o null';
  end if;

  with recursive base as (
    select mi.recipe_item_id, ri.name as plato, b.id as brand_id, b.name as marca,
      b.ownership_type, ri.cost_updated_at,
      sum(sl.quantity) as unidades,
      sum(sl.line_total) as ingresos,
      ri.computed_cost as coste_ud
    from sale_line sl
    join sale s on s.id = sl.sale_id
    join menu_item mi on mi.id = sl.menu_item_id
    join brand b on b.id = mi.brand_id
    join recipe_item ri on ri.id = mi.recipe_item_id
    left join sales_channel sc on sc.id = s.channel_id
    where sl.account_id = p_account_id
      and s.sold_at >= p_from and s.sold_at < p_to
      and s.status <> 'cancelled'
      and mi.recipe_item_id is not null
      and (p_ownership is null or b.ownership_type = p_ownership)
      and (p_location_id is null or s.location_id = p_location_id)
      and (p_channel is null
           or lower(btrim(coalesce(sc.name, s.external_channel_text))) = lower(btrim(p_channel)))
    group by mi.recipe_item_id, ri.name, b.id, b.name, b.ownership_type, ri.cost_updated_at, ri.computed_cost
  ),
  arbol as (
    select b.recipe_item_id as raiz, b.recipe_item_id as nodo, 0 as profundidad
    from base b
    union all
    select a.raiz, rl.child_item_id, a.profundidad + 1
    from arbol a
    join recipe_line rl on rl.parent_item_id = a.nodo
    where a.profundidad < 10
  ),
  salud as (
    select a.raiz,
      (select count(*) from recipe_line rl2 where rl2.parent_item_id = a.raiz) as n_lineas,
      bool_or(
        not exists(select 1 from recipe_line rl3 where rl3.parent_item_id = a.nodo)
        and (ri2.computed_cost is null or ri2.computed_cost = 0)
        and a.nodo <> a.raiz
      ) as hoja_sin_coste
    from arbol a
    join recipe_item ri2 on ri2.id = a.nodo
    group by a.raiz
  ),
  clasif as (
    select b.*,
      case when s.n_lineas = 0 then 'vacia'
           when s.hoja_sin_coste then 'incompleta'
           else 'completa' end as salud_escandallo
    from base b
    join salud s on s.raiz = b.recipe_item_id
  ),
  umbrales as (
    -- Solo platos completa contaminan los umbrales del grupo (marca).
    select brand_id,
      avg(unidades) as media_unidades,
      sum(ingresos - coste_ud * unidades) / nullif(sum(unidades), 0) as margen_medio_ponderado
    from clasif
    where salud_escandallo = 'completa'
    group by brand_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'plato', c.plato,
    'marca', c.marca,
    'ownership_type', c.ownership_type,
    'unidades', c.unidades,
    'ingresos', round(c.ingresos::numeric, 2),
    'pvp_medio', round((c.ingresos / nullif(c.unidades, 0))::numeric, 2),
    'coste_ud', round(c.coste_ud::numeric, 2),
    'margen_ud', round((c.ingresos / nullif(c.unidades, 0) - c.coste_ud)::numeric, 2),
    'margen_total', round((c.ingresos - c.coste_ud * c.unidades)::numeric, 2),
    'food_cost_pct', round((c.coste_ud / nullif(c.ingresos / nullif(c.unidades, 0), 0) * 100)::numeric, 1),
    'cost_updated_at', c.cost_updated_at,
    'salud_escandallo', c.salud_escandallo,
    'cuadrante', case
      when c.salud_escandallo <> 'completa' then null
      when c.unidades >= u.media_unidades
           and (c.ingresos / nullif(c.unidades, 0) - c.coste_ud) >= u.margen_medio_ponderado then 'estrella'
      when c.unidades >= u.media_unidades then 'caballo'
      when (c.ingresos / nullif(c.unidades, 0) - c.coste_ud) >= u.margen_medio_ponderado then 'puzzle'
      else 'perro'
    end
  ) order by c.ingresos desc), '[]'::jsonb)
  into v_result
  from clasif c
  left join umbrales u on u.brand_id = c.brand_id;

  return v_result;
end;
$function$;

-- ── guard: aborta si el objeto no quedó creado con la firma esperada ───────
do $$
begin
  if to_regprocedure('public.menu_engineering(uuid, timestamptz, timestamptz, text, text, uuid)') is null then
    raise exception 'guard: menu_engineering no se creó con la firma esperada';
  end if;
end $$;

-- Firma NUEVA (función no existía antes) → notify pgrst para que PostgREST
-- la exponga.
notify pgrst, 'reload schema';

-- ── Verificación tras aplicar (§3 del encargo) ──────────────────────────────
-- 1) select jsonb_array_length(menu_engineering('51ad1792-6629-4ef7-833a-b57b09a86710'::uuid));
--    -- ~115-ish platos (ventana de 90 días desde el momento de la llamada).
-- 2) select jsonb_agg(x) from jsonb_array_elements(
--      menu_engineering('51ad1792-6629-4ef7-833a-b57b09a86710'::uuid)
--    ) x where x->>'salud_escandallo' = 'incompleta'
--    order by (x->>'ingresos')::numeric desc;
--    -- LA LISTA PRIORIZADA que pidió Julio como primer entregable.
-- 3) select x->>'plato', x->>'salud_escandallo', x->>'food_cost_pct'
--    from jsonb_array_elements(menu_engineering(...)) x
--    where x->>'plato' ilike '%mixed master%';
--    -- Debe seguir dando 'completa' y food_cost_pct=16.4 — es el hallazgo
--    -- §4 de esta migración, no un bug: confirma que la regla no detecta
--    -- costes implausibles, solo costes ausentes.
