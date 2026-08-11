-- Aplicada: SÍ — por Julio vía MCP, 11/08 ~20:14. Sincronizada al repo desde
-- la base viva (list_migrations + pg_get_functiondef + cron.job), no al
-- revés. No forma parte del encargo TPV T1.d — es un frente propio de Julio
-- (costes de línea de venta), documentado aquí solo para que el repo no
-- desconozca una función y un cron reales que ya corren en producción.
--
-- sale_line_cost_sweep(p_limit): barrido de reparación — busca sale_line de
-- tipo 'product' con computed_cost null cuya receta YA tiene coste (llegó
-- la venta antes de que el escandallo tuviera coste; típico cuando se
-- vende un plato el mismo día que se acaba de costear). Repara llamando a
-- compute_sale_line_cost(id) uno a uno, con su propio try/catch por línea
-- (un fallo aislado no aborta el barrido completo). Si repara más de 300 en
-- una noche, encola una alerta ('cost_sweep_aluvion') vía _queue_system_alert
-- — un goteo es normal, un aluvión indica que el flujo de entrada está
-- costeando demasiado pronto de forma sistemática.
--
-- Cron: diario a las 04:50 UTC (jobid 42 en producción), fuera de horario de
-- servicio, con límite de 2000 líneas por pasada.

CREATE OR REPLACE FUNCTION public.sale_line_cost_sweep(p_limit integer DEFAULT 2000)
 RETURNS TABLE(examinadas integer, reparadas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_line record;
  v_exam int := 0;
  v_ok   int := 0;
begin
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
      raise warning 'sale_line_cost_sweep: fallo en línea % — %', v_line.id, sqlerrm;
    end;
  end loop;

  if v_ok > 0 then
    raise warning 'sale_line_cost_sweep: % líneas reparadas de % examinadas', v_ok, v_exam;
  end if;

  -- Un goteo es normal (venta de hoy costeada mañana al escandallar).
  -- Un aluvión significa que el flujo de entrada está costeando antes de
  -- tiempo de forma sistemática: eso se avisa, no se tapa.
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
  return next;
end;
$function$;

select cron.schedule('sale-line-cost-sweep', '50 4 * * *', $$select * from public.sale_line_cost_sweep(2000)$$);
