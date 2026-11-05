-- supabase/vuelta-atras/20261105T1702_dl1_uber_saldos.down.sql
-- Vuelta atrás de la 1702 (DL1 · Uber): fuera los diez asientos propuestos (si siguen propuestos: uno
-- propuesto no deja rastro en el libro) y fuera la función. Si Julio ya validó alguno, no se toca: para.
do $$ begin
  if exists (select 1 from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
              and created_by_name = 'Julio (tanda DL1)' and source_type = 'manual' and status <> 'propuesto') then
    raise exception 'DL1 Uber: algún asiento ya no está propuesto (lo han validado): no se deshace aquí.';
  end if;
  delete from public.journal_line l using public.journal_entry e
   where l.entry_id = e.id and e.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
     and e.created_by_name = 'Julio (tanda DL1)' and e.source_type = 'manual' and e.status = 'propuesto';
  delete from public.journal_entry where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710' and company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9'
     and created_by_name = 'Julio (tanda DL1)' and source_type = 'manual' and status = 'propuesto';
end $$;
drop function if exists public._dl1_asiento_proponer(uuid, date, text, text, jsonb);
