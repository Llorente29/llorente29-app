-- supabase/vuelta-atras/20261105T0045_s01p_nomina_retencion.down.sql
-- Vuelta atrás de la 0045: la 4751 del asiento propuesto de octubre de Foodint sin su retención (si sigue
-- propuesto), _s01p_nomina_proponer desde su respaldo, y fuera _s01p_nomina_retencion_poner.
update public.journal_line jl set withholding_rate_id = null, withholding_base = null, withholding_model = null
  from public.journal_entry e, public.company_account a
 where e.id = jl.entry_id and a.id = jl.company_account_id and e.company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and e.source_type = 'payroll' and e.series = 9 and e.entry_date = date '2026-10-31' and e.status = 'propuesto' and e.created_by_name = 'Julio (tanda S01p)' and a.code = '47510000';
select public._restaurar_funcion('public._s01p_nomina_proponer(uuid,date,uuid,jsonb,jsonb,text)', '20261105T0045_s01p_nomina_retencion');
drop function if exists public._s01p_nomina_retencion_poner(uuid, text, numeric);
