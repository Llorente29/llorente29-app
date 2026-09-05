-- 20260812T1700_consumo_al_escribir_lineas.sql
-- CORRIGE la 20260812T1520 (mia): el trigger disparaba en el sitio equivocado
-- del ciclo y por eso los pedidos de Last SEGUIAN sin descontar.
--
-- CAUSA (verificada en produccion 12/08 con G334 y G639, ambos a 0 movimientos):
-- el webhook hace INSERT en sale -> el trigger salta -> pero las LINEAS todavia
-- no existen (las escribe adapt_lastapp_order DESPUES). generate_sale_consumption
-- recorre sale_line, no encuentra nada y escribe 0. Nadie vuelve a lanzarlo.
-- Comprobado: relanzando a mano salieron 2 y 12 movimientos. El motor estaba
-- bien; el momento del disparo estaba mal.
--
-- SOLUCION: disparar cuando se escriben las LINEAS, que es cuando existe la
-- informacion necesaria. Trigger AFTER INSERT ... FOR EACH STATEMENT sobre
-- sale_line: una sola ejecucion por lote (el adaptador inserta linea a linea,
-- pero cada INSERT es su propia sentencia; generate_sale_consumption es
-- IDEMPOTENTE -borra su consumo previo y reescribe- asi que repetir no duplica).
--
-- Se CONSERVAN los triggers sobre sale (1520): cubren el caso de la venta que
-- cambia de estado despues, y al ser idempotente el consumo se recalcula.

create or replace function public.tg_sale_line_consumption()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_sale_id uuid;
  v_sale    record;
begin
  -- Con FOR EACH ROW tenemos new; resolvemos la venta y recalculamos su consumo.
  v_sale_id := new.sale_id;
  if v_sale_id is null then return new; end if;

  select id, status, order_status, is_active into v_sale
    from public.sale where id = v_sale_id;
  if not found then return new; end if;

  -- No consumir ventas canceladas ni inactivas.
  if coalesce(v_sale.status,'') = 'cancelled'
     or coalesce(v_sale.order_status,'') in ('cancelled','rejected')
     or not coalesce(v_sale.is_active, true) then
    return new;
  end if;

  -- Solo lineas de producto aportan consumo; las hijas las resuelve el motor.
  if coalesce(new.line_type,'product') <> 'product' then
    return new;
  end if;

  perform public.generate_sale_consumption(v_sale_id);
  return new;
exception when others then
  -- NUNCA silencioso, pero tampoco puede tumbar la ingesta de un pedido.
  raise warning 'tg_sale_line_consumption: venta % : %', v_sale_id, sqlerrm;
  return new;
end;
$function$;

drop trigger if exists trg_sale_line_consumption on public.sale_line;
create trigger trg_sale_line_consumption
  after insert or update of menu_item_id on public.sale_line
  for each row execute function public.tg_sale_line_consumption();

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgrelid='public.sale_line'::regclass
                    and tgname='trg_sale_line_consumption') then
    raise exception 'falta el trigger trg_sale_line_consumption';
  end if;
end $$;