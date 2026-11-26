-- supabase/vuelta-atras/20261126T0654_q10d_conceptos_noviembre.down.sql
--
-- Vuelta atrás de la 0654: quita los conceptos que eligió (por su «quien»), y solo esos.

do $vuelta$
begin
  if to_regclass('public.conta_cegid_concepto_elegido') is null then return; end if;
  delete from public.conta_cegid_concepto_elegido where quien = 'Julio (respuesta Q10 · 4, 26/11)';
end $vuelta$;
