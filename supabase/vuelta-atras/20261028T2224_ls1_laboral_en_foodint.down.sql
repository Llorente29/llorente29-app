-- supabase/vuelta-atras/20261028T2224_ls1_laboral_en_foodint.down.sql
--
-- LS1 · vuelta atrás de la 2224: quita SOLO la fila que puso la 2224 (por su
-- motivo), no una que alguien hubiera puesto antes o después a mano.

delete from public.feature_flags
 where account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
   and feature_key = 'conta_laboral'
   and grant_reason = 'LS1 (28/10/2026): Laboral en Sumied, encendido en Foodint (Julio)';
