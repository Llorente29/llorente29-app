-- supabase/vuelta-atras/20261127T0731_q10i_decisiones_julio.down.sql
--
-- Vuelta atrás de la 0731: quita solo las dos decisiones que puso, si siguen siendo suyas.

do $vuelta$
begin
  if to_regclass('public.conta_banco_decision') is null then return; end if;
  delete from public.conta_banco_decision
   where company_id = '58e574ec-012a-4483-9f5b-3501cc023ba4' and quien = 'Julio (27/11, Q10 · 0731)'
     and clave in ('mov:a7434fbc-03f9-40b6-88a9-441ec18aa64f', 'mov:310e448a-57e8-445e-87e3-f89cb5084486');
end $vuelta$;
