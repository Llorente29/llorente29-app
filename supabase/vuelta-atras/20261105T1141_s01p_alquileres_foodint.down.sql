-- supabase/vuelta-atras/20261105T1141_s01p_alquileres_foodint.down.sql
-- Vuelta atrás de la 1141: los apuntes de alquiler que propuso (solo si siguen
-- propuestos: uno validado no se borra, se anula, y entonces esto para), el
-- alquiler esperado del arrendador 1 sin contrato, Plaza Castilla sin fin, y
-- fuera el contrato de Carabanchel.
do $$
declare v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710'; v_c uuid;
begin
  select id into v_c from public.recurring_contract where account_id = v_acc and kind = 'alquiler' and created_by_name = 'Julio (tanda S01p)';
  if v_c is null then return; end if;
  if exists (select 1 from public.journal_entry e join public.recurring_contract_month m on m.id = e.source_id
              where e.source_type = 'manual' and m.contract_id = v_c and e.status in ('validado', 'anulado')) then
    raise exception 'S01p alquileres: hay un apunte de alquiler ya validado: no se deshace (se anula desde el libro).';
  end if;
end $$;
-- sin hueco: los apuntes propuestos no tienen número de su serie.
delete from public.journal_entry
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and source_type = 'manual' and status in ('propuesto', 'borrador') and number is null
   and source_id in (select m.id from public.recurring_contract_month m join public.recurring_contract c on c.id = m.contract_id
                      where c.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and c.kind = 'alquiler' and c.created_by_name = 'Julio (tanda S01p)');
update public.supplier_expected_invoice set covered_by_recurring_id = null
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and id = 'f2c13b5e-ee18-4281-8f1e-1508486e9b36';
update public.supplier_expected_invoice set ends_on = null
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and ends_on = '2026-09-30'
   and id in ('42b1c16f-238d-4d09-8510-33e0a03a27ca', 'c7d5e755-e8c9-42d7-930f-7f6de6914ff1', 'bbb2a2e7-9e5b-463b-a899-785f448abc08');
delete from public.recurring_contract
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and kind = 'alquiler' and created_by_name = 'Julio (tanda S01p)';
