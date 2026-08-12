-- 20260812T1520_consumo_al_entrar_la_venta.sql
-- Aplicada: 2026-08-12 por MCP (verificada: 2 triggers activos, funcion con 'accepted', 0 movimientos retroactivos)
--
-- DECISION DE JULIO (12/08): el stock se descuenta AL RECIBIR LA VENTA, no al
-- cerrarla. Si luego se cancela, se revierte (cancel_sale ya lo hace).
--
-- POR QUE (datos de produccion, 90 dias):
--   cancelaciones ...........  20 de 6.080 =  0,33 %   <- el caso del que protegia
--   ventas nunca cerradas ... 224 de 6.080 =  3,68 %   <- el fallo que provocaba
-- Protegia el caso raro rompiendo el frecuente: 5.103 EUR de ventas sin
-- descontar desde el 12/06, y nadie se entero en dos meses.
--
-- Y las lineas NO cambian entre entrada y cierre: 0 eventos tab:updated /
-- tab_products:updated en 30 dias (2.549 tab:created, 2.537 tab:closed). El
-- motivo tecnico para esperar al cierre no existe en delivery.
--
-- COMO: generate_sale_consumption YA es idempotente (borra su consumo previo
-- antes de reescribir), asi que puede dispararse varias veces sin duplicar.
-- Solo se amplia CUANDO se dispara. NO se toca la funcion de consumo ni
-- close_sale ni cancel_sale.
--
-- Se mantiene el disparo en 'completed': si la venta cambia entre medias, el
-- consumo se recalcula (idempotente) con las lineas definitivas.
--
-- NO reejecutar contra produccion: ya esta aplicada.

create or replace function public.tg_sale_consumption_on_complete()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- 1) AL ENTRAR / ACEPTARSE la venta: descuenta ya. (nuevo)
  if new.order_status in ('accepted','received','new','completed')
     and (tg_op = 'INSERT' or old.order_status is distinct from new.order_status)
     and coalesce(new.status,'') <> 'cancelled'
     and coalesce(new.is_active, true) then
    perform public.generate_sale_consumption(new.id);
  end if;

  return new;
end;
$function$;

-- El trigger existente solo cubre UPDATE. Anadimos INSERT para que una venta
-- que nace ya aceptada (caso de Last: nace 'accepted') descuente en el acto.
drop trigger if exists trg_sale_consumption_on_insert on public.sale;
create trigger trg_sale_consumption_on_insert
  after insert on public.sale
  for each row execute function public.tg_sale_consumption_on_complete();

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid='public.sale'::regclass
                    and tgname='trg_sale_consumption_on_insert') then
    raise exception 'falta el trigger trg_sale_consumption_on_insert';
  end if;
  if not exists (select 1 from pg_trigger
                  where tgrelid='public.sale'::regclass
                    and tgname='trg_sale_consumption_on_complete') then
    raise exception 'falta el trigger trg_sale_consumption_on_complete';
  end if;
end $$;
