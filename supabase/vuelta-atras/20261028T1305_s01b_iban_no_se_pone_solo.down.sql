-- supabase/vuelta-atras/20261028T1305_s01b_iban_no_se_pone_solo.down.sql
--
-- Vuelta atrás de la 1305: el disparador del IBAN de la factura, byte a byte
-- como estaba (_restaurar_funcion). Va antes que la de la 1304.
select public._restaurar_funcion('public._pc01e2b_iban_de_la_factura()', '20261028T1305_s01b_iban_no_se_pone_solo');
