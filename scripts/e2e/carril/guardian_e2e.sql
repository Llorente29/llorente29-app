-- scripts/e2e/carril/guardian_e2e.sql — lo corre carril.sh coger en segundo
-- plano y se queda dormido: mientras viva esta conexión, la e2e tiene su carril
-- y nadie migra staging. Cada línea que escribe la lee carril.sh.
set statement_timeout = 0;
set lock_timeout = :'espera';
select 'migrar-espera';
-- Compartido: entran todas las e2e a la vez; quien migra (exclusivo) espera a
-- que acaben, y mientras espera no entra ninguna nueva.
select pg_advisory_lock_shared(4202, 0);
select 'migrar-libre';
-- El primer carril libre de 1 a :max (0 si no queda ninguno).
select 'carril ' || coalesce((select n from generate_series(1, :max) n where pg_try_advisory_lock(4203, n) limit 1), 0);
select pg_sleep(7200);
