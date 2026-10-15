-- ============================================================================
-- B01 · QUÉ ES UNA TARJETA ENTERA, AFINADO (Julio, 15/10, opción a).
-- ----------------------------------------------------------------------------
-- La 0190 tapaba toda tira de 13 a 19 cifras que pasara Luhn. En el Excel de
-- BBVA hay referencias de 14 a 16 cifras (códigos 00163, 00379, 00925, 00230,
-- 00007) y una de 14 pasa Luhn por casualidad: se la habría comido, y sirve
-- para casar. Desde aquí se tapa solo la tira de 15 a 19 cifras que EMPIEZA
-- COMO UNA TARJETA (Visa 4, Mastercard 51–55 o 2221–2720, Amex 34/37) y pasa
-- Luhn. El mismo criterio en el front (pareceTarjeta, extractoBanco.ts).
--
-- Una función nueva, _bank_parece_tarjeta, y _bank_ocultar_tarjetas con la
-- misma firma y el criterio nuevo. El disparador no cambia. Lo ya tapado no se
-- destapa (no hay número entero guardado en ningún sitio).
--
-- Vuelta atrás: supabase/vuelta-atras/20261101T0192_b01_tarjeta_criterio.down.sql
-- (vuelve al criterio de 13 a 19 cifras de la 0190).
-- cambia: public._bank_ocultar_tarjetas · prueba: supabase/staging/sql/20261101_b01_tarjeta_criterio_prueba.sql
-- ============================================================================

create or replace function public._bank_parece_tarjeta(p text)
returns boolean language sql immutable set search_path = public as $$
  select p ~ '^[0-9]{15,19}$'
     and (p ~ '^4' or p ~ '^5[1-5]' or left(p, 4)::int between 2221 and 2720 or p ~ '^3[47]')
     and public._bank_pasa_luhn(p)
$$;

create or replace function public._bank_ocultar_tarjetas(p text)
returns text language plpgsql immutable set search_path = public as $$
declare v_t text; r text := p;
begin
  if p is null or p !~ '[0-9]{15}' then return p; end if;
  for v_t in select distinct x[1] from regexp_matches(p, '(?<![0-9])([0-9]{15,19})(?![0-9])', 'g') x loop
    if public._bank_parece_tarjeta(v_t) then
      r := regexp_replace(r, '(?<![0-9])' || v_t || '(?![0-9])', '····' || right(v_t, 4), 'g');
    end if;
  end loop;
  return r;
end $$;

revoke all on function public._bank_parece_tarjeta(text) from public, anon, authenticated;
comment on function public._bank_ocultar_tarjetas(text) is
  'B01 (15/10, criterio de la 0192). Deja solo las 4 últimas («····1234») de cada tira de 15 a 19 cifras que empieza como Visa, Mastercard o Amex y pasa Luhn. La usa el disparador bank_movement_sin_tarjetas.';
