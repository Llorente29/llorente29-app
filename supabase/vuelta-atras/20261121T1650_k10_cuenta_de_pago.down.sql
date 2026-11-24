-- K10 · vuelta atrás de 20261121T1650: quita los enlaces «pago» que puso la tanda (los apuntados, y solo si siguen
-- siendo esos), conta_recibida_motivos desde su respaldo (sin la 480 ni el 21x como contrapartida),
-- company_account_misma_cuenta desde el suyo (la cuenta de pago, otra vez solo 57 o 43) y lo nuevo.
-- Las cuentas de pago que se pongan a mano en la ficha después se quedan: son de quien las puso.
delete from public.company_account_link l
 using public.conta_k10_pago_desde_plataforma k
 where l.id = k.link_id and l.role = 'pago' and l.entity = 'supplier' and l.company_account_id = k.company_account_id;
select public._restaurar_funcion('public.conta_recibida_motivos(uuid,uuid)', '20261121T1650_k10_cuenta_de_pago');
select public._restaurar_funcion('public.company_account_misma_cuenta()', '20261121T1650_k10_cuenta_de_pago');
drop function if exists public.conta_k10_pago_desde_plataforma();
drop table if exists public.conta_k10_pago_desde_plataforma;
