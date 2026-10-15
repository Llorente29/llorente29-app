-- ============================================================================
-- PRUEBA (staging) · B01 · nunca se guarda una tarjeta entera (0190 y 0191).
-- Todo en una transacción con ROLLBACK. Fichero entero; el camino de verdad
-- (bank_importar) como USUARIO (el administrador de A, rol «authenticated»).
-- Números de tarjeta de PRUEBA (los públicos de las pasarelas), nunca reales.
--
--   1. Luhn: 4111111111111111 y 5555555555554444 son tarjeta; 4111111111111112
--      y 123456789012345 no.
--   2. Importando como usuario un movimiento con la tarjeta entera en el
--      concepto, en una referencia y en la huella: se guarda «····1111» en los
--      tres; una referencia de 15 cifras que no pasa Luhn se queda como está.
--   3. Un update que intenta volver a poner el número entero: tampoco entra.
--   4. Lo ya guardado (una fila de antes del disparador, sembrada con él
--      apagado): la 0191, de verdad, la deja con las 4 últimas y su
--      comprobación final no encuentra ninguna.
-- ============================================================================

\set ON_ERROR_STOP 1
begin;

create temp table _r (que text primary key, id uuid) on commit drop;
grant all on _r to authenticated;

-- ── 1 · Luhn ────────────────────────────────────────────────────────────────
do $$
begin
  if not public._bank_pasa_luhn('4111111111111111') or not public._bank_pasa_luhn('5555555555554444')
     or public._bank_pasa_luhn('4111111111111112') or public._bank_pasa_luhn('123456789012345') or public._bank_pasa_luhn('41111111111') then
    raise exception 'PRUEBA B01 · 1: Luhn no distingue tarjeta de referencia.';
  end if;
  if public._bank_ocultar_tarjetas('COMPRA 4111111111111111 MERCADO 123456789012345') is distinct from 'COMPRA ····1111 MERCADO 123456789012345' then
    raise exception 'PRUEBA B01 · 1: ocultar dio «%».', public._bank_ocultar_tarjetas('COMPRA 4111111111111111 MERCADO 123456789012345');
  end if;
  if public._bank_ocultar_tarjetas('X94111111111111111') is distinct from 'X94111111111111111' then
    raise exception 'PRUEBA B01 · 1: tocó una tira con cifras pegadas (17 cifras que no pasan Luhn).';
  end if;
  raise notice '1 · Luhn y ocultar: bien';
end $$;

-- ── 2 · Importar como usuario ───────────────────────────────────────────────
select set_config('request.jwt.claims', json_build_object('sub', 'c01a0000-0000-4000-8000-0000000000a1', 'role', 'authenticated')::text, true);
set local role authenticated;
do $$
declare r jsonb; m record;
begin
  r := public.bank_importar('b0100000-0000-4000-8000-0000000000b3', 'fichero', 'norma43', 'prueba-tarjeta.n43', repeat('f', 64),
    date '2026-09-10', date '2026-09-10', null, null, 'prueba', null,
    jsonb_build_array(jsonb_build_object('fecha', '2026-09-10', 'importe', -12.5,
      'concepto_banco', 'COMPRA TARJ 4111111111111111 MERCADO PRUEBA', 'concepto_limpio', 'Compra tarj 4111111111111111 Mercado prueba',
      'ref1', '5555555555554444', 'ref2', '123456789012345',
      'huella', '2026-09-10|-1250||5555555555554444|123456789012345|1', 'huella_suave', 'prueba-tarjeta-s1')));
  select * into m from public.bank_movement where statement_id = (r->>'extracto')::uuid;
  if m.bank_concept <> 'COMPRA TARJ ····1111 MERCADO PRUEBA' or m.clean_concept <> 'Compra tarj ····1111 Mercado prueba'
     or m.reference_1 <> '····4444' or m.reference_2 <> '123456789012345' or m.fingerprint <> '2026-09-10|-1250||····4444|123456789012345|1' then
    raise exception 'PRUEBA B01 · 2: se guardó «%» / «%» / «%» / «%» / «%».', m.bank_concept, m.clean_concept, m.reference_1, m.reference_2, m.fingerprint;
  end if;
  insert into _r values ('mov', m.id);
  raise notice '2 · importado como usuario: «%», ref «%», la de 15 cifras intacta', m.bank_concept, m.reference_1;
end $$;
reset role;

-- ── 3 · Un update con el número entero tampoco entra ────────────────────────
update public.bank_movement set bank_concept = 'OTRA VEZ 4111111111111111' where id = (select id from _r where que = 'mov');
do $$
begin
  if (select bank_concept from public.bank_movement where id = (select id from _r where que = 'mov')) <> 'OTRA VEZ ····1111' then
    raise exception 'PRUEBA B01 · 3: el update guardó la tarjeta entera.';
  end if;
  raise notice '3 · update: bien';
end $$;

-- ── 4 · Lo ya guardado: la 0191 de verdad ───────────────────────────────────
alter table public.bank_movement disable trigger bank_movement_sin_tarjetas;
update public.bank_movement set bank_concept = 'DE ANTES 4111111111111111', document_no = '5555555555554444' where id = (select id from _r where que = 'mov');
alter table public.bank_movement enable trigger bank_movement_sin_tarjetas;
\ir ../../migrations/20261101T0191_b01_tarjeta_oculta_guardado.sql
do $$
declare m record;
begin
  select * into m from public.bank_movement where id = (select id from _r where que = 'mov');
  if m.bank_concept <> 'DE ANTES ····1111' or m.document_no <> '····4444' then
    raise exception 'PRUEBA B01 · 4: la 0191 dejó «%» / «%».', m.bank_concept, m.document_no;
  end if;
  raise notice '4 · la 0191: lo de antes, con las 4 últimas';
end $$;

rollback;
