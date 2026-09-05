-- 0911 — Barrido diario de costes de venta (11/08/2026, aprobado por Julio:
-- "sí, dale. Pero sobre todo que no suceda más").
--
-- CAUSA RAÍZ que tapa: la venta se costea AL ENTRAR; si en ese momento la
-- receta aún no tiene coste, la línea queda a NULL para siempre — nadie
-- volvía a intentarlo cuando la receta se costeaba después. Resultado
-- medido hoy: 3.712 líneas / 52.686 € de venta ciega para el margen,
-- con la receta ya costeada. Recuperadas hoy a mano; esto evita la recaída.
--
-- QUÉ HACE: cada madrugada recalcula el coste de las líneas producto con
-- computed_cost NULL cuya receta YA tiene coste, PERO solo si la receta
-- cambió después del último intento (o nunca se intentó) — así no machaca
-- eternamente las rotas de verdad. Máximo 2.000 por noche.
-- compute_sale_line_cost SOLO escribe computed_cost/cost_computed_at en la
-- línea: no toca stock, ni importes, ni estados (verificado en su cuerpo).
--
-- SIN FALLOS MUDOS: si repara más de 300 en una noche, avisa por el canal
-- de system_alert (el flujo de entrada está costeando antes de tiempo de
-- forma masiva); el resultado de cada barrido queda en raise warning.

do $$
begin
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='compute_sale_line_cost') then
    raise exception '0911: falta compute_sale_line_cost — parar';
  end if;
  if not exists (select 1 from pg_proc where pronamespace='public'::regnamespace and proname='_queue_system_alert') then
    raise exception '0911: falta _queue_system_alert (0910) — parar';
  end if;
  if not exists (select 1 from pg_extension where extname='pg_cron') then
    raise exception '0911: falta pg_cron — parar';
  end if;
end $$;

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

revoke all on function public.sale_line_cost_sweep(integer) from public, anon, authenticated;
grant execute on function public.sale_line_cost_sweep(integer) to service_role;

-- Cron: cada madrugada a las 04:50 UTC (antes del arranque del día, después de cierres)
select cron.schedule(
  'sale-line-cost-sweep',
  '50 4 * * *',
  $$select * from public.sale_line_cost_sweep(2000)$$
);