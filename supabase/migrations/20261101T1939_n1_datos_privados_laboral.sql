-- supabase/migrations/20261101T1939_n1_datos_privados_laboral.sql
--
-- cambia: public.empleados_datos_privados · prueba: supabase/staging/sql/20261101_n1_laboral_prueba.sql
--
-- N1 · PR 1 · Respuesta 1 de Julio (01/11/2026): el salario, el DNI, el
-- nacimiento y el coste de Seguridad Social los ve también quien tiene el
-- permiso de Laboral (lab_permiso, de la 1937), no solo el administrador. El
-- encargado sigue sin verlos por ser encargado.
--
-- Misma firma y mismas columnas: solo cambia la condición
-- (current_user_is_admin_of → current_user_ve_laboral, que incluye al
-- administrador). Nada en el camino del pedido.
--
-- Va después de la 1937 (current_user_ve_laboral). Respaldo con
-- _respaldar_funcion; la vuelta atrás la restaura de él.
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T1939_n1_datos_privados_laboral.down.sql

select public._respaldar_funcion('public.empleados_datos_privados(uuid)', '20261101T1939_n1_datos_privados_laboral');

create or replace function public.empleados_datos_privados(p_account_id uuid)
returns table (id uuid, salary numeric, dni text, birth_date date, employer_ss_annual numeric)
language sql stable security definer set search_path = public as $$
  select e.id, e.salary, e.dni, e.birth_date, e.employer_ss_annual
    from public.employees e
   where e.account_id = p_account_id
     and public.current_user_ve_laboral(p_account_id)
$$;
comment on function public.empleados_datos_privados(uuid) is
  'L1a (27/10) y N1 (01/11): el salario, el DNI, la fecha de nacimiento y el coste de Seguridad Social de las personas de la cuenta, para su administrador y para quien tiene el permiso de Laboral (current_user_ve_laboral). A cualquier otro le devuelve cero filas.';
revoke all on function public.empleados_datos_privados(uuid) from public, anon;
grant execute on function public.empleados_datos_privados(uuid) to authenticated;
