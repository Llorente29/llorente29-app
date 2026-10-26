-- supabase/vuelta-atras/20261025T2141_v03_verifactu_engancha.down.sql
-- Vuelta atrás de la 2141: quita el disparador y su función. La emisión queda
-- como en la V01. Los registros que ya hubiera se quedan (la 2140 los guarda).
drop trigger if exists customer_invoice_verifactu on public.customer_invoice;
drop function if exists public._verifactu_al_emitir();
