-- supabase/vuelta-atras/20261029T1013_s01c_arreglo_foodint.down.sql
--
-- Vuelta atrás de 20261029T1013_s01c_arreglo_foodint, lo que se puede deshacer:
--   · Amirsa vuelve a «al momento» (sin decir cuándo llegan sus facturas);
--   · la dirección «documentos» foodint@entrada.folvy.app vuelve, apagada.
-- Lo que NO se deshace, y por qué:
--   · FAC-00100 y su asiento 2/3177: el contraasiento es un asiento validado y
--     un contraasiento no se anula (journal_entry_anular). Si hiciera falta
--     volver a tener la factura, se da de alta otra vez desde su papel.
--   · ALB-00218: queda esperando factura, que es lo correcto con su ficha.
-- En una base sin Foodint (staging) no hace nada.

do $$
declare v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'; v_co uuid;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'S01c 1013 (vuelta atrás): esta base no tiene a Foodint: nada que deshacer.';
    return;
  end if;
  update public.supplier set invoice_arrival = null, updated_at = now()
   where account_id = v_acc and archived_at is null and name ilike 'AMIRSA%' and invoice_arrival = 'inicio_mes_siguiente';
  select company_id into v_co from public.company_inbound_address where account_id = v_acc and kind = 'facturas' and local_part = 'facturas-foodint';
  if v_co is not null and not exists (select 1 from public.company_inbound_address where account_id = v_acc and kind = 'documentos') then
    insert into public.company_inbound_address (account_id, company_id, kind, local_part, active, created_by_name)
    values (v_acc, v_co, 'documentos', 'foodint', false, 'Folvy · vuelta atrás de la S01c');
  end if;
  raise notice 'S01c 1013 (vuelta atrás): FAC-00100 sigue anulada con su contraasiento (no se anula un contraasiento).';
end $$;
