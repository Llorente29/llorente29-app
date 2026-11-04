-- supabase/vuelta-atras/20261104T1121_s01p_dias_foodint.down.sql
-- Vuelta atrás de la 1121: los dos días de Foodint, vacíos (como antes: las columnas no existían).
update public.company set month_close_day = null, payroll_pay_days = null
 where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
