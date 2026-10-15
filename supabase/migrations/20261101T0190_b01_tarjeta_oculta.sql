-- ============================================================================
-- B01 · NUNCA SE GUARDA UNA TARJETA ENTERA (Julio, 15/10).
-- ----------------------------------------------------------------------------
-- El segundo Norma 43 de Foodint trajo el número entero de la tarjeta en el
-- concepto (10 movimientos, 16 cifras que pasan Luhn). Desde aquí, la base
-- solo guarda las 4 últimas, «····1234», venga de donde venga el movimiento
-- (fichero, correo, agregador o un front viejo): un disparador BEFORE INSERT /
-- UPDATE sobre bank_movement enmascara concepto, concepto limpio, documento,
-- referencias y la huella.
--
-- Qué es una tarjeta: una tira de 13 a 19 cifras, sin cifras pegadas a los
-- lados, que pasa el control de Luhn. Las que no lo pasan (referencias de
-- recibos y transferencias: 3 en Foodint) se quedan como están (Julio, 15/10).
-- «····1234» es además lo que el motor reconoce como tarjeta
-- (digitosTarjeta en src/modules/conta/lib/conciliacion.ts).
--
-- Lo ya guardado lo corrige 20261101T0191, aparte: es un update y pide autorizo.
-- Vuelta atrás: supabase/vuelta-atras/20261101T0190_b01_tarjeta_oculta.down.sql
-- cambia: public.bank_movement · prueba: supabase/staging/sql/20261101_b01_tarjeta_oculta_prueba.sql
-- ============================================================================

create or replace function public._bank_pasa_luhn(p text)
returns boolean language sql immutable set search_path = public as $$
  select p ~ '^[0-9]{13,19}$' and (
    select sum(case when (length(p) - i) % 2 = 1 then (case when d * 2 > 9 then d * 2 - 9 else d * 2 end) else d end) % 10 = 0
      from (select i, substr(p, i, 1)::int d from generate_series(1, length(p)) i) q)
$$;

create or replace function public._bank_ocultar_tarjetas(p text)
returns text language plpgsql immutable set search_path = public as $$
declare v_t text; r text := p;
begin
  if p is null or p !~ '[0-9]{13}' then return p; end if;
  for v_t in select distinct x[1] from regexp_matches(p, '(?<![0-9])([0-9]{13,19})(?![0-9])', 'g') x loop
    if public._bank_pasa_luhn(v_t) then
      r := regexp_replace(r, '(?<![0-9])' || v_t || '(?![0-9])', '····' || right(v_t, 4), 'g');
    end if;
  end loop;
  return r;
end $$;

create or replace function public._bank_movimiento_sin_tarjetas()
returns trigger language plpgsql set search_path = public as $$
begin
  new.bank_concept := public._bank_ocultar_tarjetas(new.bank_concept);
  new.clean_concept := public._bank_ocultar_tarjetas(new.clean_concept);
  new.document_no := public._bank_ocultar_tarjetas(new.document_no);
  new.reference_1 := public._bank_ocultar_tarjetas(new.reference_1);
  new.reference_2 := public._bank_ocultar_tarjetas(new.reference_2);
  new.fingerprint := public._bank_ocultar_tarjetas(new.fingerprint);
  return new;
end $$;

drop trigger if exists bank_movement_sin_tarjetas on public.bank_movement;
create trigger bank_movement_sin_tarjetas
  before insert or update of bank_concept, clean_concept, document_no, reference_1, reference_2, fingerprint on public.bank_movement
  for each row execute function public._bank_movimiento_sin_tarjetas();

revoke all on function public._bank_pasa_luhn(text) from public, anon, authenticated;
revoke all on function public._bank_ocultar_tarjetas(text) from public, anon, authenticated;
revoke all on function public._bank_movimiento_sin_tarjetas() from public, anon, authenticated;
comment on function public._bank_ocultar_tarjetas(text) is
  'B01 (15/10). Deja solo las 4 últimas («····1234») de cada tira de 13 a 19 cifras que pasa Luhn. La usa el disparador bank_movement_sin_tarjetas.';
