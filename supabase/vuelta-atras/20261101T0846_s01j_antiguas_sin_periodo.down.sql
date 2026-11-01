-- supabase/vuelta-atras/20261101T0846_s01j_antiguas_sin_periodo.down.sql
-- S01j · Vuelta atrás de la 0846: quita el disparador y su función. Las antiguas
-- que ya se hubieran sustituido no vuelven (no tenían nada ligado; la nueva
-- guarda en raw->'sustituye' su clave, su origen y su fecha).
drop trigger if exists s01j_liquidacion_sustituye on public.channel_settlement;
drop function if exists public._s01j_liquidacion_sustituye();
