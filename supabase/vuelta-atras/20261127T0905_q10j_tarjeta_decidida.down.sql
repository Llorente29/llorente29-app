-- supabase/vuelta-atras/20261127T0905_q10j_tarjeta_decidida.down.sql
--
-- Vuelta atrás de la 0905: quita solo las 5 decisiones de tarjeta que puso, si siguen siendo suyas y si ninguna se ha
-- mandado ya a Cegid (entonces para: lo mandado se deshace antes en «Facturas del mes»).

do $vuelta$
declare v_e constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4';
  v_claves constant text[] := array['tpv:2026-11-19T12:41:55Z|48.40', 'tpv:2026-11-19T15:55:17Z|48.40', 'tpv:2026-11-24T17:45:56Z|48.40', 'tpv:2026-11-05T08:37:18Z|1000.00', 'tpv:2026-11-20T10:09:39Z|121.00'];
begin
  if to_regclass('public.conta_banco_decision') is null then return; end if;
  if exists (select 1 from public.conta_cegid_incidencia where company_id = v_e and origen_clave = any (v_claves) and estado in ('mandando', 'mandada', 'facturada')) then
    raise exception 'Q10 · 0905 vuelta atrás: alguno de los 5 pagos ya está mandado a Cegid; primero «Deshacer» en Facturas del mes.';
  end if;
  delete from public.conta_banco_decision where company_id = v_e and quien = 'Julio (27/11)' and decision = 'facturar' and clave = any (v_claves);
end $vuelta$;
