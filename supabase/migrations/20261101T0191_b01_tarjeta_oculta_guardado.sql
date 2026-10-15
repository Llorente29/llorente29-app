-- ============================================================================
-- B01 · LO YA GUARDADO, SIN TARJETAS ENTERAS (Julio, 15/10).
-- ----------------------------------------------------------------------------
-- Pasa por el disparador de la 0190 los movimientos que tienen una tira de 13
-- a 19 cifras que pasa Luhn en el concepto, el concepto limpio, el documento,
-- las referencias o la huella: se quedan con las 4 últimas («····1234»).
-- En Foodint, medido el 15/10 en solo lectura: 10 movimientos (16 cifras,
-- concepto común 99), todos del extracto del 13/10. Tabla entera a propósito
-- (regla 9): ninguna cuenta puede guardar una tarjeta entera.
--
-- Al final COMPRUEBA que no queda ninguna y, si queda, PARA (y no se aplica).
--
-- Vuelta atrás: NINGUNA, a propósito: el número entero no se guarda en ningún
-- sitio para poder devolverlo (supabase/vuelta-atras/20261101T0191_…).
-- ============================================================================

update public.bank_movement
   set bank_concept = public._bank_ocultar_tarjetas(bank_concept),
       clean_concept = public._bank_ocultar_tarjetas(clean_concept),
       document_no = public._bank_ocultar_tarjetas(document_no),
       reference_1 = public._bank_ocultar_tarjetas(reference_1),
       reference_2 = public._bank_ocultar_tarjetas(reference_2),
       fingerprint = public._bank_ocultar_tarjetas(fingerprint)
 where concat_ws(' ', bank_concept, clean_concept, document_no, reference_1, reference_2, fingerprint) ~ '[0-9]{13}'
   and concat_ws(' ', bank_concept, clean_concept, document_no, reference_1, reference_2, fingerprint)
       is distinct from concat_ws(' ', public._bank_ocultar_tarjetas(bank_concept), public._bank_ocultar_tarjetas(clean_concept),
         public._bank_ocultar_tarjetas(document_no), public._bank_ocultar_tarjetas(reference_1), public._bank_ocultar_tarjetas(reference_2),
         public._bank_ocultar_tarjetas(fingerprint));

do $$
declare n int;
begin
  select count(*) into n from public.bank_movement m,
         regexp_matches(concat_ws(' ', m.bank_concept, m.clean_concept, m.document_no, m.reference_1, m.reference_2, m.fingerprint),
                        '(?<![0-9])([0-9]{13,19})(?![0-9])', 'g') x
   where public._bank_pasa_luhn(x[1]);
  if n > 0 then raise exception 'B01 · 0191: quedan % tiras de tarjeta entera en bank_movement.', n; end if;
  raise notice 'B01 · 0191: ninguna tarjeta entera en bank_movement.';
end $$;
