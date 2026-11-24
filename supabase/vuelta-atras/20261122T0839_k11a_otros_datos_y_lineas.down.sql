-- K11a · vuelta atrás de 20261122T0839 (después de la de la 0840): fuera conta_recibida_otros_datos y
-- conta_recibida_por_defecto. Lo que guarda datos (las columnas de «Otros datos», journal_line.channel_id, los
-- datos por línea y los catálogos) solo se quita si nadie lo ha usado: con algo escrito, se queda (es de quien lo
-- escribió, y sin las funciones nadie lo escribe).
drop function if exists public.conta_recibida_otros_datos(uuid, jsonb, text);
drop function if exists public.conta_recibida_por_defecto(uuid);
do $$ begin
  if not exists (select 1 from public.supplier_invoice
                  where invoice_type is not null or regime_key is not null or exclude_from_vat_return is not null
                     or deduction_rectification is not null or exclude_from_347 is not null or vat_deductible_pct is not null)
     and not exists (select 1 from public.supplier_invoice_expense_dato)
     and not exists (select 1 from public.journal_line where channel_id is not null) then
    drop table if exists public.supplier_invoice_expense_dato;
    alter table public.journal_line drop column if exists channel_id;
    alter table public.supplier_invoice drop column if exists vat_deductible_pct;
    alter table public.supplier_invoice drop column if exists exclude_from_347;
    alter table public.supplier_invoice drop column if exists deduction_rectification;
    alter table public.supplier_invoice drop column if exists exclude_from_vat_return;
    alter table public.supplier_invoice drop column if exists regime_key;
    alter table public.supplier_invoice drop column if exists invoice_type;
    drop table if exists public.conta_clave_regimen;
    drop table if exists public.conta_tipo_factura;
  else
    raise notice 'K11a · vuelta atrás: hay «Otros datos», datos por línea o plataformas escritos; sus columnas y tablas se quedan.';
  end if;
end $$;
