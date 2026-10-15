-- Vuelta atrás de B01 · 0192: vuelve al criterio de la 0190 (toda tira de 13 a
-- 19 cifras que pase Luhn), con el mismo cuerpo de la 0190 byte a byte, y quita
-- _bank_parece_tarjeta. Lo tapado mientras tanto se queda tapado.
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
comment on function public._bank_ocultar_tarjetas(text) is
  'B01 (15/10). Deja solo las 4 últimas («····1234») de cada tira de 13 a 19 cifras que pasa Luhn. La usa el disparador bank_movement_sin_tarjetas.';
drop function if exists public._bank_parece_tarjeta(text);
