-- supabase/migrations/20261114T1155_dl1_hacienda_compensacion.sql
--
-- DL1·27 y su anexo (Julio, 13/11) · Hacienda: la devolución del IS 2025
-- (1.126,10, en la 47090000 desde la apertura) se va en dos partes. Nada en el
-- camino del pedido. Sin IVA: no toca ninguna declaración presentada.
--   1. Acuerdo de compensación de oficio 282630448208C, con efectos del 21/07/2026
--      (apuntado a 01/10: el 3T está cerrado y la validación no deja el 21/07):
--      se cobra el 111 del 2T de 2026 (661,33, de él 354,34 ya compensados el 05/10
--      con el 4/3306) y su recargo ejecutivo del 5 % (33,07).
--      Debe 47510000 306,99 · Debe 67800000 33,07 · Haber 47090000 340,06.
--   2. Lo que sobraba (786,04) lo embargó la TGSS (orden del 30/09/2026,
--      notificación del 10/11/2026) por la deuda en apremio del expediente
--      28 01 25 01471259. Debe 47600000 786,04 · Haber 47090000 786,04, a 10/11.
-- Con los dos, la 47090000 queda a 0. El recargo y los intereses del apremio
-- (3.372,31 y 384,93) NO se apuntan: los decide la gestoría.
-- Validado como Julio.
--
-- sin hueco: no retira ningún asiento ni resumen del día; solo añade dos asientos.
--
-- SIN VUELTA ATRÁS, a propósito: un asiento validado se anula con un
-- contraasiento.

do $$
declare
  v_acc constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_e constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_julio constant uuid := '673fca49-f6b5-40ed-a8f7-558390acce10';
  v_saldo numeric; v_id1 uuid; v_id2 uuid; v_n int; v_r jsonb;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'DL1 Hacienda compensación: sin la cuenta de Foodint, no hay nada que apuntar.';
    return;
  end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_saldo
    from public.journal_line l join public.journal_entry e on e.id = l.entry_id join public.company_account a on a.id = l.company_account_id
   where e.company_id = v_e and a.code = '47090000' and e.status in ('validado', 'anulado') and (e.voided_at is null or e.voided_by_entry_id is not null);
  if v_saldo <> 1126.10 then
    raise exception 'DL1 Hacienda compensación: la 47090000 está en %, no en 1.126,10: no se apunta nada.', v_saldo;
  end if;
  if not exists (select 1 from public.journal_entry e where e.company_id = v_e and e.status = 'validado' and e.series = 4 and e.number = 3306
                  and e.concept like 'AEAT compensación de oficio 282630417974P%') then
    raise exception 'DL1 Hacienda compensación: no está el 4/3306 (los 354,34 del 111 del 2T): no se apunta nada.';
  end if;
  if exists (select 1 from public.journal_entry e where e.company_id = v_e and e.status <> 'anulado'
              and (e.concept like '%282630448208C%' or e.concept like '%28 01 25 01471259%')) then
    raise exception 'DL1 Hacienda compensación: ya hay un asiento de este acuerdo o de este embargo: no se apunta nada.';
  end if;

  begin
  -- Por _journal_entry_proponer: la línea de la 4751 lleva su modelo y su periodo de retención (111, 2026-2T), como el 4/3306.
  v_r := public._journal_entry_proponer(v_e,
    jsonb_build_object('series', 4, 'fecha', '2026-10-01', 'source_type', 'manual', 'source_id', null, 'confianza', 'seguro',
      'concepto', 'AEAT compensación de oficio 282630448208C: 111 del 2T de 2026 con la devolución del IS 2025 (efectos 21/07/2026; a 01/10 porque el 3T está cerrado)',
      'porque', 'DL1·27 (Julio, 13/11): el 111 del 2T no se ingresó (falló la domiciliación) y entró en ejecutiva; Hacienda se lo cobra de la devolución del IS 2025. Principal 661,33, de él 354,34 ya compensados (4/3306); recargo ejecutivo del 5 %, 33,07.',
      'razones', '[]'::jsonb, 'party_id', null, 'documento', '282630448208C'),
    jsonb_build_array(
      jsonb_build_object('cuenta', '47510000', 'debe', 306.99, 'haber', 0, 'comun', true, 'concepto', '111 del 2T de 2026, lo que quedaba del principal (661,33 − 354,34)',
        'retencion', jsonb_build_object('modelo', '111', 'periodo', '2026-2T')),
      jsonb_build_object('cuenta', '67800000', 'debe', 33.07, 'haber', 0, 'comun', true, 'concepto', 'Recargo ejecutivo del 5 % del 111 del 2T de 2026'),
      jsonb_build_object('cuenta', '47090000', 'debe', 0, 'haber', 340.06, 'comun', true, 'concepto', 'Devolución del IS 2025, compensada')),
    null, 'Julio (tanda DL1)', null);
  v_id1 := (v_r->>'id')::uuid;
  if v_id1 is null or coalesce((v_r->>'existente')::boolean, false) then raise exception 'DL1 Hacienda compensación: la compensación no ha salido nueva (%).', v_r; end if;
  exception when others then raise exception using errcode = format('DH1%s', left(sqlstate, 2)), message = sqlerrm; end;

  begin
  v_id2 := public._dl1_asiento_iva(v_e, date '2026-11-10', 4,
    'TGSS embargo de la devolución de la AEAT, expediente 28 01 25 01471259 (orden del 30/09/2026, notificación del 10/11/2026)',
    'DL1·27, anexo (Julio, 13/11): lo que sobraba de la devolución del IS 2025 tras la compensación del 21/07 lo embargó la TGSS por la deuda en apremio (principal 15.300,49, recargo 3.372,31, intereses 384,93; total 19.057,73). No se sabe qué día movió el dinero la AEAT entre el 30/09 y el 10/11.',
    jsonb_build_array(
      jsonb_build_object('cuenta', '47600000', 'debe', 786.04, 'concepto', 'Embargo a cuenta de la deuda en apremio, expediente 28 01 25 01471259'),
      jsonb_build_object('cuenta', '47090000', 'haber', 786.04, 'concepto', 'Devolución del IS 2025, lo que sobraba, embargado por la TGSS')));
  exception when others then raise exception using errcode = format('DH2%s', left(sqlstate, 2)), message = sqlerrm; end;

  begin
  v_n := public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(jsonb_build_object('id', v_id1, 'importe', 340.06)));
  exception when others then raise exception using errcode = format('DV1%s', left(sqlstate, 2)), message = sqlerrm; end;
  begin
  v_n := v_n + public._dl1_validar(v_e, v_julio, 'Julio', jsonb_build_array(jsonb_build_object('id', v_id2, 'importe', 786.04)));
  exception when others then raise exception using errcode = format('DV2%s', left(sqlstate, 2)), message = sqlerrm; end;
  raise notice 'DL1 Hacienda compensación: % asientos validados como Julio.', v_n;
end $$;
