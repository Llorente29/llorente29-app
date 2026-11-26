-- supabase/vuelta-atras/20261126T1139_r20b_cifras_del_banco.down.sql
-- Vuelta atrás del R20b: quita la función de lo cobrado por el banco para «Te deben».
drop function if exists public.conta_cifras_del_banco(uuid);
