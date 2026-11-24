-- K06 · vuelta atrás de 20261120T0840: quita la función nueva. Los pagos que ya
-- hizo se quedan: cada uno tiene su asiento validado (un asiento validado se
-- anula con un contraasiento, no se borra), y lo leen igual Pagos y Bancos.
drop function if exists public.conta_recibida_pagar_con_cuenta(uuid, uuid, text, date, text);
