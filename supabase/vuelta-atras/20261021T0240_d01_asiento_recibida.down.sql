-- Vuelta atrás de 20261021T0240 (D01): las dos funciones. PARA si ya hay
-- facturas recibidas con su documento enlazado: quitar la función no los
-- borra, pero dejaría sin camino lo que una persona ya hizo.
do $$
begin
  if exists (select 1 from public.journal_entry_document where kind = 'factura_recibida') then
    raise exception 'Vuelta atrás D01 0240: hay % factura(s) recibida(s) con su documento; no se quita nada.', (select count(*) from public.journal_entry_document where kind = 'factura_recibida');
  end if;
end $$;
drop function if exists public.conta_documento_factura_guardar(uuid, text, text, text, integer, text);
drop function if exists public.conta_gasto_aprendido(uuid, uuid);
