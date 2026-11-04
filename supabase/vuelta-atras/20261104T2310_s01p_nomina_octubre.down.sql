-- supabase/vuelta-atras/20261104T2310_s01p_nomina_octubre.down.sql
-- Vuelta atrás de la 2310: fuera el asiento propuesto de la nómina de octubre de Foodint (si sigue propuesto:
-- uno propuesto no deja rastro en el libro), y fuera la función. Si Julio ya lo validó, no se toca: para.
do $$ begin
  if exists (select 1 from public.journal_entry where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and source_type = 'payroll'
              and entry_date = date '2026-10-31' and created_by_name = 'Julio (tanda S01p)' and status <> 'propuesto') then
    raise exception 'S01p nómina: el asiento ya no está propuesto (lo han validado): no se deshace aquí.';
  end if;
  delete from public.journal_entry where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and source_type = 'payroll'
     and entry_date = date '2026-10-31' and created_by_name = 'Julio (tanda S01p)' and status = 'propuesto';
end $$;
drop function if exists public._s01p_nomina_proponer(uuid, date, uuid, jsonb, jsonb, text);
