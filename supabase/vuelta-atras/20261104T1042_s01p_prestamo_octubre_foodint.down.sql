-- supabase/vuelta-atras/20261104T1042_s01p_prestamo_octubre_foodint.down.sql
-- Vuelta atrás de la 1042: el préstamo de Foodint, con el cuadro, lo prestado y
-- las cuotas de antes (desde su copia), y fuera la copia.
update public.recurring_contract c
   set schedule = a.schedule, principal = a.principal, installments = a.installments
  from public.conta_s01p_prestamo_antes a
 where a.id = c.id and a.account_id = c.account_id;
drop table if exists public.conta_s01p_prestamo_antes;
