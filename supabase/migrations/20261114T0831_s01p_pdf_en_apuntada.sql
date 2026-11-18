-- supabase/migrations/20261114T0831_s01p_pdf_en_apuntada.sql
--
-- S01p·22 · Subir el PDF a una factura recibida ya apuntada que no lo tiene (Julio, 14/11).
-- Caso real: GLOVOAPP I170326000585810, asiento 2/3438; y en Foodint, las otras cinco recibidas de
-- octubre sin PDF están igual, todas con su asiento validado (medido en solo lectura).
--
-- conta_recibida_papel_poner rechazaba CUALQUIER factura con su asiento validado («Ya está
-- contabilizada: su documento va con el asiento»). Eso protege CAMBIAR el documento de una
-- apuntada, que sigue igual. Pero PONER el PDF a una que no tiene ninguno no cambia el asiento
-- (no lleva el documento: lleva sus importes y cuentas), y el PDF es obligatorio en Sumied y para Diez.
--
-- cambia: public.conta_recibida_papel_poner · prueba: supabase/staging/sql/20261114_s01p_pdf_en_apuntada_prueba.sql
--   Con la MISMA firma y el cuerpo vigente con un solo trozo cambiado: el guardia del asiento validado
--   solo para si la factura ya tenía documento. Respaldo antes, para la vuelta atrás.
--
-- No toca ningún dato. Nada en el camino del pedido.

select public._respaldar_funcion('public.conta_recibida_papel_poner(uuid,text,text,text)', '20261114T0831_s01p_pdf_en_apuntada');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_recibida_papel_poner(uuid,text,text,text)'::regprocedure);
  v_viejo text := $viejo$  if exists (select 1 from public.journal_entry e where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice'$viejo$;
  v_nuevo text := $nuevo$  -- S01p·22: una apuntada SIN documento sí admite su PDF (no cambia el asiento); cambiarlo, no.
  if v_f.raw_document_url is not null and exists (select 1 from public.journal_entry e where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice'$nuevo$;
begin
  if strpos(v_def, 'S01p·22') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'S01p·22: conta_recibida_papel_poner no es la medida (el guardia del asiento no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;
