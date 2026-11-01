-- supabase/vuelta-atras/20261101T1732_s01o_foodint.down.sql
--
-- Vuelta atrás de la 1732: el interruptor de Foodint apagado y fuera las cuentas
-- que puso en las fichas de las plataformas. Lo que ya se apuntó solo NO se
-- deshace aquí: un asiento validado es inalterable y solo lo anula un
-- administrador; se deshace desde «Apuntadas solas» › «Deshacer» (que lo anula
-- con su contraasiento y devuelve la factura a «Por revisar»). Los enlaces por
-- número se quedan: son los buenos.
update public.company_purchase_setting set post_safe_invoices = false, updated_at = now(), updated_by_name = 'Sumied (S01o, vuelta atrás)'
 where company_id = '658728c0-fcd7-46ef-a860-d4e5e6eb21d9' and account_id = '51ad1792-6629-4ef7-833a-b57b09a86710';
delete from public.company_account_link k using public.s01o_ficha_puesta p where p.link_id = k.id and p.account_id = k.account_id;
drop table if exists public.s01o_ficha_puesta;
