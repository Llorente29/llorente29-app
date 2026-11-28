-- K13 · vuelta atrás de 20261123T2347: quita las funciones y la tabla del código corto (con ella, los códigos propuestos
-- y los puestos a mano desde la tanda). No toca locations, brand ni sales_channel.
drop function if exists public.conta_codigo_corto_poner(text, uuid, text);
drop function if exists public.conta_codigos_cortos(uuid);
drop function if exists public._conta_codigo_corto_rellenar(uuid);
drop function if exists public._conta_codigo_corto_propuesto(text, uuid, text);
drop table if exists public.conta_codigo_corto;
