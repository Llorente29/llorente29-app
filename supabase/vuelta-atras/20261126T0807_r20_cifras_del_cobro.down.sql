-- supabase/vuelta-atras/20261126T0807_r20_cifras_del_cobro.down.sql
-- Vuelta atrás del R20 (0807): quita la función de las cifras del cobro.
drop function if exists public.conta_cifras_del_cobro(uuid);
