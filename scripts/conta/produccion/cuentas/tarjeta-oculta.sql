-- scripts/conta/produccion/cuentas/tarjeta-oculta.sql
--
-- B01 · LO QUE CUENTA LA TANDA «NUNCA UNA TARJETA ENTERA» (0190 y 0191), antes y
-- después. SOLO LEE. Mira lo que la vuelta atrás repone (el disparador, sus
-- funciones y que no se pierde ni se mueve ningún movimiento). Las tarjetas
-- enteras (10 → 0) no van aquí: la vuelta atrás no las devuelve, a propósito;
-- lo comprueba la propia 0191, que para si queda alguna.
-- TABLA ENTERA, a propósito y dicho (regla 9).
select clave, valor from (
  select 1 o, 'disparador bank_movement_sin_tarjetas' clave,
         exists (select 1 from pg_trigger where tgname = 'bank_movement_sin_tarjetas' and tgrelid = 'public.bank_movement'::regclass)::text valor union all
  select 2, 'función _bank_ocultar_tarjetas', (to_regprocedure('public._bank_ocultar_tarjetas(text)') is not null)::text union all
  select 3, 'movimientos (todas las cuentas)', (select count(*) from public.bank_movement)::text union all
  select 4, 'movimientos por estado (todas las cuentas)', (select coalesce(string_agg(status || ' ' || n, ' · ' order by status), '') from (select status, count(*) n from public.bank_movement group by 1) x) union all
  select 5, 'suma de importes (todas las cuentas)', (select coalesce(sum(amount), 0) from public.bank_movement)::text
) t order by o;
