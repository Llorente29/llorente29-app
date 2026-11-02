-- supabase/vuelta-atras/20261101T1218_s01j2_local_foodint.down.sql
--
-- Vuelta atrás de la 1218: quita el local solo a las liquidaciones que puso ella
-- (las apuntadas en s01j2_local_puesto) y que siguen con ese mismo local.
select set_config('s01j2.no_poner_local', '1', true);
update public.channel_settlement cs set location_id = null, updated_at = now()
  from public.s01j2_local_puesto p
 where p.settlement_id = cs.id and p.account_id = cs.account_id and cs.location_id = p.location_id;
drop table if exists public.s01j2_local_puesto;
select set_config('s01j2.no_poner_local', '', true);
