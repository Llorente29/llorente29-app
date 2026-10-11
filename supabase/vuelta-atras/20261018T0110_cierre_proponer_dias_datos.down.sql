-- Vuelta atrás de «Cierre del día · 2 — DATOS».
-- Quita lo que propuso la puesta al día (solo lo que sigue «propuesto»: lo que
-- alguien ya validó no se toca) y sus resúmenes, y devuelve el resumen a medias
-- del 09/10 de Carabanchel desde su copia.
do $$
begin
  create temp table _quitar on commit drop as
  select e.id from public.journal_entry e
   where e.source_type = 'sales_day' and e.status = 'propuesto' and e.created_by_name = 'Folvy (cierre del día, puesta al día)';

  delete from public.sales_day_summary s using _quitar q where s.entry_id = q.id;
  delete from public.journal_entry e using _quitar q where e.id = q.id;

  insert into public.sales_day_summary
  select b.* from public._backup_cierre_proponer_resumen b
   where not exists (select 1 from public.sales_day_summary s where s.company_id = b.company_id and s.location_id = b.location_id and s.sales_day = b.sales_day);

  delete from public.sales_day_proposal_log g where g.result in ('propuesto', 'ya_estaba')
     and g.entry_id is not null and not exists (select 1 from public.journal_entry e where e.id = g.entry_id);
end $$;
