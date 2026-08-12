-- 20260812T1500_cron_autoclose_daily_counts.sql
-- Aplicada: 2026-08-12 por MCP (verificada: funcion creada, ejecutada en vacio sin error)
--
-- Cierra y ASIENTA los autoinventarios sin esperar aprobacion de oficina.
--
-- POR QUE: existe cron_generate_daily_counts (genera los conteos a las 04:00)
-- pero NADA los cierra. autoclose_daily_count() hace lo correcto pero solo se
-- dispara si alguien pulsa en pantalla. Resultado: conteos con el trabajo hecho
-- que se quedan parados (INV-00154 llevaba >20h en_revision) y cuyo ajuste NO
-- existe en el stock. Mientras tanto se hacen pedidos con datos no asentados.
--
-- DECISION DE JULIO (12/08): el movimiento se genera al CONTAR/CERRAR, no al
-- aprobar. La aprobacion de oficina pasa a ser solo el registro del MOTIVO de
-- la desviacion, no la condicion para que el dato exista.
--
-- NO se puede llamar a autoclose_daily_count desde cron: sus guardas usan
-- auth.uid(), nulo en cron -> excepcion. Este despachador replica el flujo
-- llamando a las piezas internas sin guarda de sesion (corre como owner).
--
-- NO reejecutar contra produccion: ya esta aplicada.

create or replace function public.cron_autoclose_daily_counts()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_applied integer;
  v_errores integer := 0;
begin
  for r in
    select ic.id, ic.code, ic.account_id, ic.status
      from public.inventory_count ic
     where ic.kind = 'cycle'
       and ic.status in ('abierto','contando','en_revision')
       and exists (
         select 1 from public.inventory_count_line l
          where l.inventory_count_id = ic.id and l.counted_qty is not null)
       -- margen: no tocar lo que se esta contando ahora mismo
       and coalesce(ic.closed_at, ic.started_at, ic.created_at) < now() - interval '2 hours'
  loop
    begin
      if r.status in ('abierto','contando') then
        perform public.close_inventory_count(r.id);
      end if;

      select adjustments into v_applied
        from public.apply_inventory_count(r.id, null, 'Autocierre programado', true);

      raise notice 'cron_autoclose_daily_counts: % asentado (% ajustes)', r.code, v_applied;
    exception when others then
      -- NUNCA silencioso: se registra y se sigue con los demas.
      v_errores := v_errores + 1;
      raise warning 'cron_autoclose_daily_counts: fallo en % : %', r.code, sqlerrm;
    end;
  end loop;

  if v_errores > 0 then
    raise warning 'cron_autoclose_daily_counts: % conteos fallaron', v_errores;
  end if;
end;
$function$;

revoke all on function public.cron_autoclose_daily_counts() from public, anon, authenticated;

do $$
begin
  if to_regprocedure('public.cron_autoclose_daily_counts()') is null then
    raise exception 'cron_autoclose_daily_counts no quedo creada';
  end if;
end $$;
