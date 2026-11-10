-- supabase/vuelta-atras/20261110T1342_g05_ficha_facturas.down.sql
-- G05 · Vuelta atrás de la 1342: fuera conta_ficha_facturas. La ficha publicada
-- antes no la lee; la de después vuelve a decir «Sin factura en Sumied».
drop function if exists public.conta_ficha_facturas(uuid, uuid);
