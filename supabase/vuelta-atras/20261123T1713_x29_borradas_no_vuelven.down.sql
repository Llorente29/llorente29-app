-- supabase/vuelta-atras/20261123T1713_x29_borradas_no_vuelven.down.sql
--
-- X29 · Vuelta atrás de la 1713: quita el disparador y deja bank_importar como estaba (de su respaldo, con su huella).
drop trigger if exists trg_bank_movimiento_no_borrado on public.bank_movement;
drop function if exists public._bank_movimiento_no_borrado();
select public._restaurar_funcion(
  'public.bank_importar(uuid,text,text,text,text,date,date,numeric,numeric,text,text,jsonb)', '20261123T1713_x29_borradas_no_vuelven');
