-- ============================================================================
-- C02 · Plan contable — 10 · ENLACES SIN DUEÑO (visto en las capturas del 05/10)
-- ----------------------------------------------------------------------------
-- company_account_link.entity_id es texto (vale para varias tablas): no hay
-- clave ajena que borre el enlace cuando se borra su dueño. En staging, la e2e
-- de propuestas enlazaba un proveedor de prueba a la 40000000 y luego lo
-- borraba: la 40000000 decía «4 proveedores» con proveedores que ya no
-- existían (5 enlaces huérfanos medidos el 05/10). Lo mismo pasaría al borrar
-- un banco o una fila propia de las tablas generales (borrarFila).
--
--   · Disparador AFTER DELETE en supplier, treasury_account, expense_category,
--     tax_rate y withholding_rate: quita sus enlaces del plan y lo deja en el
--     registro («enlace_quitado», con la cuenta de la que deja de colgar).
--   · Limpia los huérfanos que ya hay, contados.
--
-- Medido en producción (solo lectura, 05/10): ninguna función ni cron borra
-- filas de esas cinco tablas; los borrados vienen de la app. CREATE TRIGGER
-- toma SHARE ROW EXCLUSIVE un instante: no para las lecturas, solo las
-- escrituras en esas tablas durante la creación. Ninguna es del camino del
-- pedido. Tanda 1, después de la 0185.
-- ============================================================================

create function public.company_account_link_sin_dueno() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_entity text := case tg_table_name
    when 'supplier' then 'supplier' when 'treasury_account' then 'bank_account'
    when 'expense_category' then 'expense_category' when 'tax_rate' then 'tax_rate'
    when 'withholding_rate' then 'withholding_rate' end;
  r record;
begin
  for r in
    delete from public.company_account_link l using public.company_account a
     where a.id = l.company_account_id and l.entity = v_entity and l.entity_id = old.id::text
    returning l.account_id, l.company_id, l.role, a.code
  loop
    insert into public.company_account_log (account_id, company_id, que, code, detalle, antes, despues, source)
    values (r.account_id, r.company_id, 'enlace_quitado', r.code,
            format('Se ha borrado un %s: deja de ir a %s (%s).', v_entity, r.code, r.role),
            jsonb_build_object('code', r.code), jsonb_build_object('entity', v_entity, 'entity_id', old.id, 'role', r.role, 'motivo', 'borrado'),
            'serie');
  end loop;
  return old;
end $$;
comment on function public.company_account_link_sin_dueno() is
  'C02. Al borrar un proveedor, banco, tipo de gasto, tipo de IVA o retención, quita sus enlaces del plan y lo deja en el registro.';

create trigger company_account_link_sin_dueno after delete on public.supplier
  for each row execute function public.company_account_link_sin_dueno();
create trigger company_account_link_sin_dueno after delete on public.treasury_account
  for each row execute function public.company_account_link_sin_dueno();
create trigger company_account_link_sin_dueno after delete on public.expense_category
  for each row execute function public.company_account_link_sin_dueno();
create trigger company_account_link_sin_dueno after delete on public.tax_rate
  for each row execute function public.company_account_link_sin_dueno();
create trigger company_account_link_sin_dueno after delete on public.withholding_rate
  for each row execute function public.company_account_link_sin_dueno();

-- Los que ya hay.
do $$
declare n int;
begin
  delete from public.company_account_link l
   where (l.entity = 'supplier' and not exists (select 1 from public.supplier s where s.id::text = l.entity_id))
      or (l.entity = 'bank_account' and not exists (select 1 from public.treasury_account t where t.id::text = l.entity_id))
      or (l.entity = 'expense_category' and not exists (select 1 from public.expense_category g where g.id::text = l.entity_id))
      or (l.entity = 'tax_rate' and not exists (select 1 from public.tax_rate t where t.id::text = l.entity_id))
      or (l.entity = 'withholding_rate' and not exists (select 1 from public.withholding_rate w where w.id::text = l.entity_id));
  get diagnostics n = row_count;
  raise notice 'C02 0187: % enlaces sin dueño quitados.', n;
end $$;
