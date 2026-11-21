-- supabase/vuelta-atras/20261118T0515_x06_comprobar_salida.down.sql
--
-- X06 · Vuelta atrás: quita las cuatro funciones y las dos tablas nuevas (con lo
-- que tengan apuntado: lo metido a mano y lo dado por igualado). Las partidas que
-- «Volver a sacar solo esa» pasó a «retirada» se quedan así: es un estado de la X02.

drop function if exists public.conta_erp10_igualado_poner(uuid, date, text, date, integer, integer, text);
drop function if exists public.conta_erp10_volver_a_sacar(uuid, uuid, text);
drop function if exists public.conta_erp10_a_mano_poner(uuid, uuid, text);
drop function if exists public.conta_erp10_comprobar(uuid, date);
drop table if exists public.conta_erp10_igualado;
drop table if exists public.conta_erp10_a_mano;
