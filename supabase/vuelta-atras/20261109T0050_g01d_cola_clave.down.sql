-- supabase/vuelta-atras/20261109T0050_g01d_cola_clave.down.sql
--
-- Vuelta atrás de la 0050: la clave única de la cola, otra vez como estaba en
-- la 1620 (parcial, «where clave is not null»). Con ella, los avisos vuelven a
-- no entrar en la cola: solo para deshacer, no para dejarlo así.

drop index if exists public.conta_aviso_clave_idx;
create unique index conta_aviso_clave_idx on public.conta_aviso (account_id, clave) where clave is not null;
