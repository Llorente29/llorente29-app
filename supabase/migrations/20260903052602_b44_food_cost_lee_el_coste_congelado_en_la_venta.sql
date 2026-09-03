-- B44 · 03/09/2026 — EL FOOD COST DE UN MES CERRADO DEJA DE CAMBIAR SOLO.
-- ===========================================================================
-- ANTES: food_cost_dashboard hacia `join recipe_item ri` y sumaba
--   `quantity * ri.computed_cost` — el coste de HOY. Dos consecuencias:
--     1) cada albaran reescribia agosto. Medido: 317 de 392 recetas tocadas en
--        30 dias, 214 en 7. Un mes cerrado no paraba quieto.
--     2) los modificadores no contaban NADA: `ri.computed_cost` es el coste
--        base de la receta; el queso extra salia gratis.
--
-- AHORA: suma `sale_line.computed_cost`, que es lo que `compute_sale_line_cost`
--   congela EN LA VENTA — ya multiplicado por la cantidad, con modificadores
--   aplicados, y en el combo escrito en la linea PADRE (el NULL de los hijos es
--   el diseño, ver C6). Por eso `sum(line_cost)` y no `sum(quantity*...)`.
--
-- ORDEN DE LOS FACTORES — ESTO NO SE PODIA APLICAR SOLO:
--   Cambiar la lectura movia julio de 22,01 % a 29,42 %. Los 7,4 puntos salian
--   enteros de 103 lineas congeladas entre el 7 y el 11 de julio con el coste
--   inflado hasta x50 (Patatas Clasicas Meraki: 43,37 EUR de coste en una racion
--   de 5,50 EUR). 5.152 EUR de coste fantasma que con las recetas de hoy son
--   180 EUR. Se repararon PRIMERO (B49, respaldo en
--   _backup_b49_julio_contaminado_20260903). **El bug de lectura llevaba dos
--   meses tapando ese dato corrupto: como el panel leia la receta de hoy, el
--   115 % de food cost nunca llego a la pantalla.**
--
-- CONSECUENCIA MEDIDA (regla 11), Foodint:
--   junio  22,46 % -> 26,50 %   ·  cobertura 96,2 % -> 86,0 %
--   julio  22,01 % -> 22,87 %   ·  cobertura 97,5 % -> 92,7 %
--   agosto 22,35 % -> 23,95 %   ·  cobertura 95,8 % -> 90,3 %
--   La cobertura BAJA a proposito: esas unidades no tienen coste congelado de
--   verdad. Antes se las tapaba con el coste de la receta de hoy. Ese trabajo
--   es A17 y A35, y ahora se ve.
--
-- OJO AL UMBRAL DEL 40 % que vive mas abajo en esta funcion: se calibro con la
--   metrica VIEJA (maximo real 33,1 %). Con la metrica nueva los numeros suben
--   ~1,5 puntos. Sigue habiendo margen, pero el 40 se recalibra cuando exista
--   el objetivo de la cuenta (A7 / E14). No se toca aqui.
--
-- FORMA DEL PARCHE: no se reescribe la funcion a mano. Se lee su definicion
--   viva y se sustituyen CINCO fragmentos, comprobando uno a uno que aparecian
--   exactamente una vez. Si alguno no aparece o aparece dos veces, aborta.

do $do$
declare
  v_def   text;
  v_pares text[][] := array[
    array[
      $q$ri.computed_cost, coalesce(ri.packaging_cost,0) as packaging,$q$,
      $q$ri.computed_cost, coalesce(ri.packaging_cost,0) as packaging,
           -- B44 (03/09/2026): el coste CONGELADO EN LA VENTA. Ya lleva la
           -- cantidad multiplicada y los modificadores aplicados; en el combo
           -- vive en la linea PADRE. No se vuelve a multiplicar por quantity.
           sl.computed_cost as line_cost,$q$
    ],
    array[
      $q$(ri.computed_cost is not null)$q$,
      $q$(sl.computed_cost is not null)$q$
    ],
    array[
      $q$sum(quantity * computed_cost) filter (where costed)$q$,
      $q$sum(line_cost) filter (where costed)$q$
    ],
    array[
      $q$round(avg(computed_cost),2) as food,$q$,
      $q$round(avg(line_cost / nullif(quantity,0)),2) as food,$q$
    ],
    array[
      $q$sum(quantity*computed_cost)/nullif(sum(quantity*unit_price),0)$q$,
      $q$sum(line_cost)/nullif(sum(quantity*unit_price),0)$q$
    ]
  ];
  v_old   text;
  v_new   text;
  v_veces int;
  i       int;
begin
  select pg_get_functiondef(p.oid)
    into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'food_cost_dashboard';

  if v_def is null then
    raise exception 'B44: no se encuentra public.food_cost_dashboard';
  end if;

  for i in 1 .. array_length(v_pares, 1) loop
    v_old := v_pares[i][1];
    v_new := v_pares[i][2];
    v_veces := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    if v_veces <> 1 then
      raise exception 'B44: el fragmento % aparece % veces, se esperaba 1. No se toca nada. Fragmento: %', i, v_veces, v_old;
    end if;
    v_def := replace(v_def, v_old, v_new);
  end loop;

  execute v_def;
end
$do$;
