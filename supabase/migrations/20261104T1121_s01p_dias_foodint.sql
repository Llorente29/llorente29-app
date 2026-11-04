-- supabase/migrations/20261104T1121_s01p_dias_foodint.sql
--
-- S01p · 2 · DATOS de Foodint (Julio, 04/11, decisiones 1 y 6): el mes se
-- cierra el día 7 del siguiente, y la nómina se paga el 5 y el 6 del mes
-- siguiente. Anclada por cuenta y empresa (regla 9); en otra base no la
-- encuentra y no hace nada. Se puede pasar dos veces.
-- Mueve una fila que existe: va con «autorizo».

do $$
declare v_n int;
begin
  update public.company
     set month_close_day = 7, payroll_pay_days = '{5,6}'
   where id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and (month_close_day is distinct from 7 or payroll_pay_days is distinct from '{5,6}'::smallint[]);
  get diagnostics v_n = row_count;
  raise notice 'S01p·1121: % empresa con sus días (cierre el 7; nómina el 5 y el 6).', v_n;
end $$;
