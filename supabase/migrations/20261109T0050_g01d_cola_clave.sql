-- supabase/migrations/20261109T0050_g01d_cola_clave.sql
--
-- cambia: public.conta_aviso · prueba: supabase/staging/sql/20261109_g01d_cola_clave_prueba.sql
--
-- G01d · La clave única de la cola de avisos, sin «where» (Julio, nº24).
--
-- La 1620 la hizo como índice parcial («… where clave is not null»). Las dos
-- funciones que reciben avisos la usan con un upsert de PostgREST
-- («on conflict (account_id, clave) do nothing»), que no puede decir el
-- «where» del índice: Postgres contesta 42P10 («there is no unique or
-- exclusion constraint matching the ON CONFLICT specification») y cada aviso
-- auténtico acababa en un 500 sin entrar en la cola. Medido en staging el
-- 09/11 con «explain», sin escribir nada.
--
-- Un índice único normal sobre (account_id, clave) vale igual para lo que no
-- tiene clave (los rechazados, los ignorados): en un índice único dos «null»
-- nunca chocan. Mismo nombre, mismas filas. La tabla es pequeña y solo la
-- escriben las dos funciones de los avisos, apagados en producción.
--
-- No toca nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261109T0050_g01d_cola_clave.down.sql

drop index if exists public.conta_aviso_clave_idx;
create unique index conta_aviso_clave_idx on public.conta_aviso (account_id, clave);
comment on index public.conta_aviso_clave_idx is
  'G01d · Una clave por aviso y cuenta: cada aviso se trata una vez. Sin «where», para que case con el «on conflict (account_id, clave)» de las funciones.';
