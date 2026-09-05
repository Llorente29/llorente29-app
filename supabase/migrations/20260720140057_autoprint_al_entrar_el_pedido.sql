-- Auto-print AL ENTRAR el pedido (INSERT), además de al pasar a aceptado (UPDATE).
-- A prueba de fallos: un error de impresión NUNCA bloquea la entrada del pedido.
-- Anti-duplicado: como mucho un juego 'auto' por pedido.
create or replace function public.tg_auto_print_on_accept()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_printer record;
  v_doc text;
  v_fire boolean := false;
begin
  if new.order_status = 'accepted' then
    if TG_OP = 'INSERT' then
      v_fire := true;
    elsif old.order_status is distinct from new.order_status then
      v_fire := true;
    end if;
  end if;

  if v_fire
     and not exists (select 1 from print_job pj where pj.sale_id = new.id and pj.source = 'auto') then
    begin
      for v_printer in
        select id, doc_types from printer
        where account_id = new.account_id
          and location_id = new.location_id
          and is_active
      loop
        foreach v_doc in array v_printer.doc_types loop
          insert into print_job (account_id, location_id, printer_id, sale_id, doc_type, payload, source, status)
          values (new.account_id, new.location_id, v_printer.id, new.id, v_doc,
                  jsonb_build_object('sale_id', new.id, 'mode', 'by_order'),
                  'auto', 'pending');
        end loop;
      end loop;
    exception when others then
      null; -- nunca romper la entrada del pedido por un fallo de impresión
    end;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_auto_print_on_insert on public.sale;
create trigger trg_auto_print_on_insert
  after insert on public.sale
  for each row execute function public.tg_auto_print_on_accept();