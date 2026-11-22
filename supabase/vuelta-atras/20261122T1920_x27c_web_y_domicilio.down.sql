-- supabase/vuelta-atras/20261122T1920_x27c_web_y_domicilio.down.sql
-- X27c · La vuelta atrás de la 1920 (después de la de la 1921): quita las dos funciones y la web del cliente.
drop function if exists public._x27c_partir_domicilio(text);
drop function if exists public._x27c_provincia_de_cp(text);
alter table public.customer_fiscal drop column if exists website;
