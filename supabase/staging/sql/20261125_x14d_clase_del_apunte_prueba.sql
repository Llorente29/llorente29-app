-- supabase/staging/sql/20261125_x14d_clase_del_apunte_prueba.sql
--
-- SOLO STAGING. Prueba del X14 · 2 (20261125T1042_x14d_clase_del_apunte), que el ensayo de staging pone delante en la misma sesión. Todo en una
-- transacción con ROLLBACK: staging no cambia. Lo que añade: public._conta_traer_clase_apunte.
--   1. Las seis clases, con un ejemplo inventado de cada una (y un nulo, que cuenta como 0).
--   2. La vuelta atrás la quita.
-- sin usuario: la función no lee ninguna tabla ni depende de quién llama, y solo la ejecuta service_role (la llamará
-- conta_traer_seguir, que es security definer); como usuario no hay nada que probar.

begin;
do $$ begin
  if exists (select 1 from public.accounts where id in ('51ad1792-6629-4ef7-833a-b57b09a86710', '00000000-0000-0000-0000-000000000001')) then
    raise exception 'PRUEBA X14d: esta base tiene cuentas de producción. No se toca nada.';
  end if;
  if to_regprocedure('public._conta_traer_clase_apunte(numeric,numeric)') is null then raise exception 'PRUEBA X14d · 0: falta la 1042 delante.'; end if;
end $$;

-- 1 · Las seis clases ------------------------------------------------------------------------------------------------------
do $$
declare r text;
begin
  select string_agg(public._conta_traer_clase_apunte(d, h), ' ' order by o) into r
    from (values (1, 100, 0), (2, 0, 100), (3, 0, 0), (4, null, null), (5, 50, 20), (6, -10, 5), (7, -40, 0), (8, 0, -40)) v(o, d, h);
  if r is distinct from 'normal normal ceros ceros dos_lados dos_lados_con_negativo negativo_debe negativo_haber' then
    raise exception 'PRUEBA X14d · 1: las clases salen «%».', r;
  end if;
  raise notice 'PRUEBA X14d · 1: las seis clases, bien: %.', r;
end $$;

-- 2 · La vuelta atrás ------------------------------------------------------------------------------------------------------
\i supabase/vuelta-atras/20261125T1042_x14d_clase_del_apunte.down.sql
do $$ begin
  if to_regprocedure('public._conta_traer_clase_apunte(numeric,numeric)') is not null then raise exception 'PRUEBA X14d · 2: la vuelta atrás no la quita.'; end if;
  raise notice 'PRUEBA X14d · 2: la vuelta atrás la quita.';
  raise notice 'PRUEBA X14d: 2 de 2 bien.';
end $$;

rollback;
