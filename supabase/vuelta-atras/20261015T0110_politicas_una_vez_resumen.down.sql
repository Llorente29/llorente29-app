-- ============================================================================
-- Vuelta atrás de 20261015T0110_politicas_una_vez_resumen: la política de SELECT
-- vuelve a belongs_to_account(account_id), con su rol y su texto de antes
-- (tests/conta/produccion/politicas-c00-c05-produccion-20261009.json). No
-- toca datos. Vuelve a ser lento: el libro diario de producción vuelve a
-- pasar del límite de 8 s.
-- ============================================================================

drop policy if exists sales_day_summary_select on public.sales_day_summary;
create policy sales_day_summary_select on public.sales_day_summary as permissive for select to public using (public.belongs_to_account(account_id));

do $$
declare n int;
begin
  -- Cada política, con su nombre, su rol y su texto exactos de antes.
  select count(*) into n
    from (values
      ('sales_day_summary', 'sales_day_summary_select', 'public', 'belongs_to_account(account_id)')
    ) e(t, p, roles, qual)
    join pg_policies x on x.schemaname = 'public' and x.tablename = e.t and x.policyname = e.p
                      and x.cmd = 'SELECT' and x.permissive = 'PERMISSIVE'
                      and array_to_string(x.roles, ',') = e.roles and x.qual = e.qual;
  if n <> 1 then
    raise exception 'Vuelta atrás de las políticas de conta: % de 1 han quedado como estaban.', n;
  end if;
end $$;
