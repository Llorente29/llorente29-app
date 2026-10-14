-- Vuelta atrás de 20261021T0290 (D01). PARA si ya hay peticiones confirmadas:
-- son de una persona; quitar la función no las borra, pero dejaría sin camino lo hecho.
do $$
begin
  if exists (select 1 from public.supplier_invoice_request where status in ('confirmado', 'enviado')) then
    raise exception 'Vuelta atrás D01 0290: hay peticiones de factura confirmadas; no se quita nada.';
  end if;
end $$;
drop function if exists public.conta_factura_pedir(uuid, uuid, date, text, text, boolean, text, text, text);
drop function if exists public.conta_factura_para_revisar(uuid);
