-- scripts/e2e/carril/guardian_migrar.sql — lo corre carril.sh migrar-coger
-- (aplicar-staging-conta) en segundo plano: espera a que acaben las e2e de
-- carril que están tocando staging y, mientras viva, no deja empezar ninguna.
set statement_timeout = 0;
set lock_timeout = :'espera';
select 'migrar-espera';
select pg_advisory_lock(4202, 0);
select 'migrar-cogido';
select pg_sleep(7200);
