-- R08 · la vuelta atrás de 1945: quita las dos funciones nuevas. Solo las lee la pantalla de Bancos.
drop function if exists public.bank_saldo_extracto(uuid, date);
drop function if exists public.bank_saldo_diario(uuid, date, text);
