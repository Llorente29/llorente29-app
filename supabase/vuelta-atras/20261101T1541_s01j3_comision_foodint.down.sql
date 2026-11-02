-- supabase/vuelta-atras/20261101T1541_s01j3_comision_foodint.down.sql
--
-- Vuelta atrás de la 1541: la comisión de antes, solo a las que corrigió ella y siguen como las dejó.
update public.channel_settlement cs set commission = a.commission_antes, updated_at = now()
  from public.s01j3_comision_antes a
 where a.settlement_id = cs.id and a.account_id = cs.account_id and cs.commission = a.commission_ahora;
drop table if exists public.s01j3_comision_antes;
