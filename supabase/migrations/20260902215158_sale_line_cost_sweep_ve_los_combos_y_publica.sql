-- DROP + CREATE, no CREATE OR REPLACE: cambia el tipo de retorno (se añade
-- `rechazadas`). Regla 2 del proyecto.
drop function if exists public.sale_line_cost_sweep(integer);

create function public.sale_line_cost_sweep(p_limit integer DEFAULT 2000)
 returns table(examinadas integer, reparadas integer, rechazadas integer)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_line record;
  v_exam int := 0;
  v_ok   int := 0;
  v_no   int := 0;
begin
  -- ── RAMA 1: linea de producto con receta propia. Comportamiento de siempre.
  for v_line in
    select sl.id
    from sale_line sl
    join menu_item mi on mi.id = sl.menu_item_id
    join recipe_item ri on ri.id = mi.recipe_item_id
    where coalesce(sl.line_type,'product') = 'product'
      and sl.computed_cost is null
      and coalesce(ri.computed_cost, ri.fixed_cost) is not null
      and (sl.cost_computed_at is null or sl.cost_computed_at < ri.updated_at)
    limit greatest(p_limit, 1)
  loop
    v_exam := v_exam + 1;
    begin
      if public.compute_sale_line_cost(v_line.id) is not null then
        v_ok := v_ok + 1;
      end if;
    exception when others then
      raise warning 'sale_line_cost_sweep: fallo en linea % — %', v_line.id, sqlerrm;
    end;
  end loop;

  -- ── RAMA 2 (02/09): EL PADRE DE COMBO. Era el punto ciego.
  --
  -- La rama 1 hace `join recipe_item on ri.id = mi.recipe_item_id`, y un combo
  -- NO TIENE RECETA PROPIA — es lo que lo hace un combo. El INNER JOIN lo tira.
  -- Resultado: el reparador nocturno nunca podia recoger un combo, justo el
  -- caso para el que existe («venta de hoy costeada mañana al escandallar»).
  --
  -- VENTANA DE 30 DIAS, Y ES DELIBERADA. Decision de Julio del 02/09: reparar
  -- lo reciente y arreglar hacia delante, NO rellenar la historia. Motivo
  -- medido: de las 606 lineas reparables de toda la vida, 598 (98,7 %) se
  -- costearian con una receta tocada DESPUES de la venta, y `recipe_item_version`
  -- —la tabla con la que se costearia al precio de entonces— tiene 0 filas.
  -- Escribir el coste de hoy sobre una venta del 7 de junio es inventar una
  -- cifra con cara de medida. Con la ventana, un combo tiene 30 dias para que
  -- alguien coste sus componentes; pasado eso, se queda sin coste y se ve.
  --
  -- La rama 1 NO lleva ventana, y se deja como estaba: cambiar su alcance seria
  -- un cambio de comportamiento que nadie ha pedido. La asimetria esta anotada.
  for v_line in
    select p.id
    from sale_line p
    join sale s on s.id = p.sale_id
    where coalesce(p.line_type,'product') = 'product'
      and p.computed_cost is null                    -- nunca recalcular
      and s.sold_at >= now() - interval '30 days'
      and exists (select 1 from sale_line h
                   where h.parent_sale_line_id = p.id and h.line_type = 'combo_item')
      and not exists (
        select 1 from sale_line h
          left join menu_item hmi on hmi.id = h.menu_item_id
          left join recipe_item hri on hri.id = hmi.recipe_item_id
         where h.parent_sale_line_id = p.id and h.line_type = 'combo_item'
           and (h.menu_item_id is null or hmi.recipe_item_id is null
                or coalesce(hri.computed_cost, hri.fixed_cost) is null))
    limit greatest(p_limit, 1)
  loop
    v_exam := v_exam + 1;
    begin
      if public.compute_sale_line_cost(v_line.id) is not null then
        v_ok := v_ok + 1;
      end if;
    exception when others then
      raise warning 'sale_line_cost_sweep: fallo en combo % — %', v_line.id, sqlerrm;
    end;
  end loop;

  -- ── LO QUE NO SE PUDO REPARAR, QUE ES LA COLA DE TRABAJO DE CASADO ────────
  -- Combos de la ventana, sin coste, con AL MENOS UN COMPONENTE SIN CASAR. El
  -- motor se niega con razon: un combo con un componente sin receta no tiene
  -- coste, tiene un trozo de coste. Este numero no existia en ninguna parte —
  -- y es exactamente lo que hay que casar.
  select count(*) into v_no
  from sale_line p
  join sale s on s.id = p.sale_id
  where coalesce(p.line_type,'product') = 'product'
    and p.computed_cost is null
    and s.sold_at >= now() - interval '30 days'
    and exists (select 1 from sale_line h
                 where h.parent_sale_line_id = p.id and h.line_type = 'combo_item')
    and exists (
      select 1 from sale_line h
        left join menu_item hmi on hmi.id = h.menu_item_id
        left join recipe_item hri on hri.id = hmi.recipe_item_id
       where h.parent_sale_line_id = p.id and h.line_type = 'combo_item'
         and (h.menu_item_id is null or hmi.recipe_item_id is null
              or coalesce(hri.computed_cost, hri.fixed_cost) is null));

  -- EL BARRIDO DICE QUE HIZO, SIEMPRE. Corre a las 04:50 y hasta hoy no se lo
  -- contaba a nadie. `raise warning` aterriza en cron.job_run_details.return_message,
  -- que es lo que ya lee el panel «Mis agentes»: sin tabla nueva y en una
  -- pantalla que alguien mira.
  raise warning 'sale_line_cost_sweep: % examinadas, % reparadas, % rechazadas por componente sin casar',
    v_exam, v_ok, v_no;

  -- Un goteo es normal (venta de hoy costeada mañana al escandallar). Un
  -- aluvion significa que el flujo de entrada esta costeando antes de tiempo de
  -- forma sistematica: eso se avisa, no se tapa.
  if v_ok > 300 then
    perform public._queue_system_alert(
      'cost_sweep',
      'Barrido de costes: ' || v_ok || ' lineas reparadas en una noche',
      'El barrido nocturno ha tenido que reparar ' || v_ok || ' lineas de venta que se costearon antes de que su receta tuviera coste. Un goteo es normal; este volumen indica que el flujo de entrada esta calculando costes demasiado pronto o que una campana de escandallos acaba de completarse. Revisar folvy_estado.',
      'cost_sweep_aluvion'
    );
  end if;

  examinadas := v_exam;
  reparadas  := v_ok;
  rechazadas := v_no;
  return next;
end;
$function$;

comment on function public.sale_line_cost_sweep(integer) is
  'Barrido nocturno de costes de linea. Rama 1: producto con receta propia (sin ventana, como siempre). Rama 2 (02/09): PADRE DE COMBO, que la rama 1 no podia ver porque un combo no tiene receta propia y el INNER JOIN lo tiraba; acotada a 30 dias por decision de Julio para no costear historia con recetas de hoy. Devuelve tambien `rechazadas`: combos sin coste por tener algun componente sin casar, que es la cola de trabajo de Casado.';