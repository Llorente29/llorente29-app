-- ============================================================================
-- PRUEBA (staging) · B01 · qué es una tarjeta entera, afinado (0192).
-- Todo en una transacción con ROLLBACK. Fichero entero; el camino de verdad
-- (bank_importar) como USUARIO (el administrador de A, rol «authenticated»).
-- Números INVENTADOS o los públicos de prueba de las pasarelas, nunca reales.
--
--   1. Se tapan: Visa, Mastercard (51–55 y 2221–2720) y Amex que pasan Luhn.
--      No se tapan: la referencia de 14 cifras que pasa Luhn por casualidad,
--      ni una de 16 que pasa Luhn pero no empieza como tarjeta.
--   2. Importando como usuario: la tarjeta en un movimiento de código 99, sin
--      «TARJ» en el texto, se tapa; las dos referencias pasan sin tocar.
--   3. La vuelta atrás, de verdad: vuelve el criterio de 13 a 19 cifras (la
--      de 14 se taparía otra vez) y _bank_parece_tarjeta desaparece.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

-- ── 1 · El criterio ─────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['4111111111111111', '5555555555554444', '2221000000000009', '2720000000000005', '378282246310005'] loop
    if not public._bank_parece_tarjeta(t) then raise exception 'PRUEBA B01 · 1: % es tarjeta y no la reconoce.', t; end if;
  end loop;
  foreach t in array array['12345678901237', '1234567890123452', '2721000000000004', '6011000000000004', '4111111111111112'] loop
    if public._bank_parece_tarjeta(t) then raise exception 'PRUEBA B01 · 1: % no es tarjeta y la tapa.', t; end if;
  end loop;
  if not public._bank_pasa_luhn('12345678901237') or not public._bank_pasa_luhn('1234567890123452') then
    raise exception 'PRUEBA B01 · 1: las dos referencias tenían que pasar Luhn (si no, la prueba no prueba nada).';
  end if;
  if public._bank_ocultar_tarjetas('REF 12345678901237 RECIBO 1234567890123452 COMERCIO 4111111111111111')
     is distinct from 'REF 12345678901237 RECIBO 1234567890123452 COMERCIO ····1111' then
    raise exception 'PRUEBA B01 · 1: ocultar dio «%».', public._bank_ocultar_tarjetas('REF 12345678901237 RECIBO 1234567890123452 COMERCIO 4111111111111111');
  end if;
  raise notice '1 · criterio: bien';
end $$;

-- ── 2 · Importar como usuario ───────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; m record;
begin
  r := public.bank_importar('b0100000-0000-4000-8000-0000000000b3', 'fichero', 'norma43', 'prueba-criterio.n43', repeat('e', 64),
    date '2026-09-11', date '2026-09-11', null, null, 'prueba', null,
    jsonb_build_array(
      jsonb_build_object('fecha', '2026-09-11', 'importe', -9.9, 'comun', '99', 'propio', '956',
        'concepto_banco', 'COMERCIO INVENTADO 4111111111111111', 'concepto_limpio', 'Comercio inventado 4111111111111111',
        'huella', 'prueba-criterio-1', 'huella_suave', 'prueba-criterio-s1'),
      jsonb_build_object('fecha', '2026-09-11', 'importe', 120, 'comun', '04', 'propio', '163',
        'concepto_banco', 'TRANSFERENCIA REF 12345678901237', 'ref2', '1234567890123452',
        'huella', '2026-09-11|12000||1234567890123452|2', 'huella_suave', 'prueba-criterio-s2')));
  select * into m from public.bank_movement where statement_id = (r->>'extracto')::uuid and common_code = '99';
  if m.bank_concept <> 'COMERCIO INVENTADO ····1111' or m.clean_concept <> 'Comercio inventado ····1111' then
    raise exception 'PRUEBA B01 · 2: la tarjeta en código 99 quedó «%» / «%».', m.bank_concept, m.clean_concept;
  end if;
  select * into m from public.bank_movement where statement_id = (r->>'extracto')::uuid and common_code = '04';
  if m.bank_concept <> 'TRANSFERENCIA REF 12345678901237' or m.reference_2 <> '1234567890123452' or m.fingerprint <> '2026-09-11|12000||1234567890123452|2' then
    raise exception 'PRUEBA B01 · 2: las referencias se tocaron: «%» / «%» / «%».', m.bank_concept, m.reference_2, m.fingerprint;
  end if;
  raise notice '2 · importado como usuario: la tarjeta tapada, las referencias intactas';
end $$;
reset role;

-- ── 3 · La vuelta atrás, de verdad ──────────────────────────────────────────
\ir ../../vuelta-atras/20261101T0192_b01_tarjeta_criterio.down.sql
do $$
begin
  if to_regprocedure('public._bank_parece_tarjeta(text)') is not null then raise exception 'PRUEBA B01 · 3: _bank_parece_tarjeta sigue.'; end if;
  if public._bank_ocultar_tarjetas('REF 12345678901237') is distinct from 'REF ····1237' then
    raise exception 'PRUEBA B01 · 3: la vuelta atrás no devuelve el criterio de 13 a 19 cifras («%»).', public._bank_ocultar_tarjetas('REF 12345678901237');
  end if;
  raise notice '3 · vuelta atrás: criterio de 13 a 19 cifras otra vez';
end $$;

rollback;
