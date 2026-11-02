-- supabase/vuelta-atras/20261101T2212_s01o2_iva_no_deducible_solo.down.sql
--
-- Vuelta atrás de la 2212: la regla 11 como estaba, fuera el disparador y la regla sola, el CHECK sin «sin_roi»
-- (las que lo lleven pasan a «otro», con su texto) y fuera en_roi.
select public._restaurar_funcion('public.conta_motivos_para_validar(uuid)', '20261101T2212_s01o2_iva_no_deducible_solo');
drop trigger if exists s01o2_iva_no_deducible_linea on public.supplier_invoice_tax;
drop function if exists public.tg_s01o2_iva_no_deducible_linea();
drop trigger if exists s01o2_iva_no_deducible on public.supplier_invoice;
drop function if exists public.tg_s01o2_iva_no_deducible();
drop function if exists public._conta_iva_no_deducible_auto(uuid);
update public.supplier_invoice set vat_non_deductible_reason = 'otro', vat_non_deductible_note = 'Proveedor de la UE que cobra IVA español sin estar en el ROI', updated_at = now()
 where vat_non_deductible_reason = 'sin_roi';
alter table public.supplier_invoice drop constraint if exists supplier_invoice_vat_non_deductible_reason_check;
alter table public.supplier_invoice add constraint supplier_invoice_vat_non_deductible_reason_check
  check (vat_non_deductible_reason is null or vat_non_deductible_reason in ('no_a_nombre', 'ticket_sin_nif', 'otro'));
alter table public.company_tax_profile drop column if exists en_roi;
