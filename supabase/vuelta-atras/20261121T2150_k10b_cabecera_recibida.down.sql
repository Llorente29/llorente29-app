-- K10b · vuelta atrás de 20261121T2150: conta_motivos_para_validar desde su respaldo (la regla 11 con el tipo de su
-- ficha, como antes), fuera conta_recibida_cabecera y las dos funciones del tipo de operación, y las tres columnas
-- nuevas de supplier_invoice solo si nadie las ha usado (con algo escrito, se quedan: son de quien lo escribió, y
-- sin las funciones nadie las lee). Las observaciones (notes) y la marca (brand_id) ya existían: no se tocan.
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261121T2150_k10b_cabecera_recibida');
drop function if exists public.conta_recibida_cabecera(uuid, jsonb, text);
drop function if exists public.conta_operacion_nombre(text);
drop function if exists public.conta_operacion_clase(text);
do $$ begin
  if not exists (select 1 from public.supplier_invoice where vat_operation is not null or deduct_from is not null or entry_concept is not null) then
    alter table public.supplier_invoice drop constraint if exists supplier_invoice_vat_operation_check;
    alter table public.supplier_invoice drop column if exists vat_operation;
    alter table public.supplier_invoice drop column if exists deduct_from;
    alter table public.supplier_invoice drop column if exists entry_concept;
  else
    raise notice 'K10b · vuelta atrás: hay recibidas con el tipo de operación, el trimestre o el concepto escritos; sus columnas se quedan.';
  end if;
end $$;
