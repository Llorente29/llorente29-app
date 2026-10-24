-- supabase/vuelta-atras/20261122T0260_i01c_justificantes.down.sql
--
-- Vuelta atrás de la 0260: fuera las tres funciones de los justificantes y el
-- CHECK de tax_return_box.origin, el de la 0110 (solo 'calculated' y
-- 'manual'). Las declaraciones apuntadas con justificante se quedan (son de la
-- empresa); si alguna casilla tiene origen 'justificante', el CHECK de antes
-- no entra y esta vuelta atrás para entera: antes hay que decidir qué hacer
-- con ellas (no se borran ni se cambian solas).
-- Ensayada en staging: supabase/staging/sql/20261122_i01c_justificantes_prueba.sql.

drop function if exists public.conta_impuesto_justificante_apuntar(uuid, jsonb);
drop function if exists public.conta_impuesto_justificantes_repasar(uuid, jsonb);
drop function if exists public.conta_impuesto_justificante_mirar(uuid, jsonb);
alter table public.tax_return_box drop constraint if exists tax_return_box_origin_check;
alter table public.tax_return_box add constraint tax_return_box_origin_check
  check (origin in ('calculated', 'manual'));
