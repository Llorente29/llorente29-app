-- supabase/vuelta-atras/20261127T1126_q10k_decisiones_qbo.down.sql
--
-- Vuelta atrás de la 1126: quita solo las 3 decisiones que puso, si siguen siendo suyas y si ninguna se ha mandado ya a
-- Cegid (entonces para: lo mandado se deshace antes en «Facturas del mes»).

do $vuelta$
declare v_e constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4';
  v_claves constant text[] := array['mov:507a9bad-9961-47ac-aa49-658ec2fe14a0', 'mov:e99b91f6-a5cf-4e6f-8e8e-b0242187eaa9', 'mov:b346eefb-b9ed-436c-a235-4b9d28bc7792'];
begin
  if to_regclass('public.conta_banco_decision') is null then return; end if;
  if exists (select 1 from public.conta_cegid_incidencia where company_id = v_e and origen_clave = any (v_claves) and estado in ('mandando', 'mandada', 'facturada')) then
    raise exception 'Q10 · 1126 vuelta atrás: alguno de los 3 cobros ya está mandado a Cegid; primero «Deshacer» en Facturas del mes.';
  end if;
  delete from public.conta_banco_decision where company_id = v_e and quien = 'QBO vía Julio (27/11)' and clave = any (v_claves);
end $vuelta$;
