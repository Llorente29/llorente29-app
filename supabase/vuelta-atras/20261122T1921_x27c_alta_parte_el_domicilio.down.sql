-- supabase/vuelta-atras/20261122T1921_x27c_alta_parte_el_domicilio.down.sql
-- X27c · La vuelta atrás de la 1921: quita el disparador y su función. Lo que partió al dar de alta se queda.
drop trigger if exists x27c_alta_parte_el_domicilio on public.supplier;
drop function if exists public.tg_x27c_alta_parte_el_domicilio();
