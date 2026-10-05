-- supabase/vuelta-atras/20261007T0100_c02_pgc_account.down.sql
--
-- Deshace 20261007T0100_c02_pgc_account.sql (y con ella la 0110, que solo
-- llena esta tabla): borra la serie del plan contable. No se pierde nada que
-- no se pueda regenerar: la serie sale entera del BOE descargado y de
-- supabase/conta/pgc/. Si ya hubiera company_account (tarea 3) colgando de
-- ella, esa vuelta atrás va antes que ésta.
drop table if exists public.pgc_account;
