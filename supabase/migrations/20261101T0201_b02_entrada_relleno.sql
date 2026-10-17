-- ============================================================================
-- B02 · LO YA GUARDADO, LEGIBLE (tanda T2): contraparte y tipo de movimiento.
-- ----------------------------------------------------------------------------
-- Rellena bank_movement.counterparty y .movement_type (0200) de lo subido
-- antes, sacándolos del texto del banco con la MISMA regla que el lector:
-- en el Excel de BBVA el concepto guardado es «CONCEPTO · BENEFICIARIO/
-- ORDENANTE · OBSERVACIONES» sin vacías ni repetidas, así que el tipo es la
-- primera parte y la contraparte la segunda, limpia (_bank_contraparte_limpia).
-- Solo los de extractos «csv:bbva» y solo los que aún no la tienen. Tabla
-- entera a propósito (regla 9): el formato es del banco, no de la cuenta.
-- En producción, medido el 16/10 en solo lectura: 108, los tres Excel de BBVA
-- de Foodint (···6536 47, ···0133 37, ···4525 24), todos con « · » y ninguno
-- con tipo ni contraparte. Solo toca esas dos columnas: ningún asiento.
--
-- Al final COMPRUEBA que no queda ninguno de esos sin tipo y, si queda, PARA.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0201_b02_entrada_relleno.down.sql
-- ============================================================================

update public.bank_movement m
   set movement_type = nullif(trim(split_part(m.bank_concept, ' · ', 1)), ''),
       counterparty = public._bank_contraparte_limpia(nullif(split_part(m.bank_concept, ' · ', 2), ''))
  from public.bank_statement s
 where s.id = m.statement_id and s.format = 'csv:bbva' and m.movement_type is null and m.counterparty is null and m.bank_concept <> '';

do $$
declare n int;
begin
  select count(*) into n from public.bank_movement m join public.bank_statement s on s.id = m.statement_id
   where s.format = 'csv:bbva' and m.bank_concept <> '' and m.movement_type is null;
  if n > 0 then raise exception 'B02 · 0201: quedan % movimientos del Excel de BBVA sin tipo.', n; end if;
  raise notice 'B02 · 0201: lo del Excel de BBVA, con su tipo y su contraparte.';
end $$;
