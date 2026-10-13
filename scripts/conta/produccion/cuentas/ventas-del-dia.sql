-- scripts/conta/produccion/cuentas/ventas-del-dia.sql
--
-- R9 (Julio, 13/10) · LO QUE CUENTA UNA TANDA QUE TOCA LAS VENTAS DEL DÍA,
-- antes y después. Lo declara el manifiesto («cuenta: <este fichero>») y lo
-- comparan deshacer.sh (tras una vuelta atrás automática: tiene que salir
-- igual) y el ensayo de la vuelta atrás. SOLO LEE.
--
-- TABLA ENTERA, a propósito y dicho (regla 9): todas las cuentas y empresas
-- juntas. Es una huella de «esto no se ha movido», más fuerte así.
--
-- Una fila por medida: «clave,valor». No depende de las columnas que trae la
-- tanda (unit_key se lee por to_jsonb): se puede tomar antes de la tanda y
-- después de deshacerla.
select clave, valor from (
  select 1 o, 'asientos de ventas · propuesto' clave, (select count(*) from public.journal_entry where source_type = 'sales_day' and status = 'propuesto')::text valor union all
  select 2, 'asientos de ventas · borrador',  (select count(*) from public.journal_entry where source_type = 'sales_day' and status = 'borrador')::text union all
  select 3, 'asientos de ventas · validado',  (select count(*) from public.journal_entry where source_type = 'sales_day' and status = 'validado')::text union all
  select 4, 'asientos de ventas · anulado',   (select count(*) from public.journal_entry where source_type = 'sales_day' and status = 'anulado')::text union all
  select 5, 'líneas de los asientos de ventas', (select count(*) from public.journal_line l join public.journal_entry e on e.id = l.entry_id where e.source_type = 'sales_day')::text union all
  select 6, 'cobro (430) de los asientos de ventas vivos', (
      select coalesce(sum(l.debit - l.credit), 0)::text
        from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
       where e.source_type = 'sales_day' and e.status in ('propuesto', 'borrador', 'validado') and a.code like '430%') union all
  select 7, 'resúmenes del día · día entero', (select count(*) from public.sales_day_summary d where to_jsonb(d)->>'unit_key' is null)::text union all
  select 8, 'resúmenes del día · por unidad', (select count(*) from public.sales_day_summary d where to_jsonb(d)->>'unit_key' is not null)::text union all
  select 9, 'resúmenes del día · sin asiento', (select count(*) from public.sales_day_summary d where d.entry_id is null)::text union all
  select 10, 'huella de los resúmenes (local · día · unidad · total · tickets · estado del asiento)', (
      select md5(coalesce(string_agg(concat_ws('|', d.location_id, d.sales_day, to_jsonb(d)->>'unit_key', d.total, d.tickets_count, e.status),
                                     ',' order by d.location_id, d.sales_day, to_jsonb(d)->>'unit_key', d.id), ''))
        from public.sales_day_summary d left join public.journal_entry e on e.id = d.entry_id)
) x order by o;
