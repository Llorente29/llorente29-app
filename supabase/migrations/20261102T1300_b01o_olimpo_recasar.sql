-- ============================================================================
-- B01 · Cola 2 · OLIMPO: CADA PAGO CON SU FACTURA (solo Foodint, arreglo de datos)
-- ----------------------------------------------------------------------------
-- Visto bueno de Julio a la lista (02/11) y su decisión (respuesta B01·6): los
-- asientos de pago mal casados se BORRAN, no se anulan con contraasiento (un
-- error del programa se borra, como los 123 duplicados de Glovo y Just Eat).
--
-- Dos transferencias del 26/10 a Olimpo quedaron casadas el 30/10 con lo que no
-- era (propuestas calculadas el 29/10, antes de la S01c, y aceptadas después):
--   1. −363,67 («FACT: 26A/10966»), casado con la 26/13028, que la S01c anuló
--      (era el albarán). Asiento de pago 4/3312.
--   2. −170,10 («FACT: 26A/10965»), casado «a cuenta» con el saldo de Olimpo en
--      el libro. Asiento de pago 4/3310 (sin tercero).
-- Lo que hace, en este orden:
--   a. suelta los dos casados (_bank_casado_soltar, de la 1310: deshechos, sin
--      asiento, y el pago de la 26/13028 fuera);
--   b. BORRA los asientos 4/3312 y 4/3310 con la función de borrado de Sumied
--      (_conta_asientos_borrar, S01q): respaldo en conta_asiento_borrado,
--      renumera la serie 4 y recalcula la cadena; nunca antes del corte;
--   c. casa el −363,67 con la 26A/10966 y el −170,10 con la 26A/10965
--      (bank_casar), que quedan pagadas el 26/10; sus asientos de pago nuevos,
--      «Por validar».
-- Como la persona que aceptó las dos propuestas (bank_match.created_by), solo
-- dentro de esta transacción (request.jwt.claims), como la S01c.
--
-- Cada cosa se ancla y se comprueba antes de tocarla: si no está como se midió
-- el 02/11 (o la 26A/10965 no está aprobada), PARA sin tocar nada. Si ya está
-- hecho, no hace nada. En staging no está Foodint: no hace nada.
-- Lo de antes (los dos casados, sus movimientos y el pago de la 26/13028) queda
-- en conta_b01o_antes, para la vuelta atrás exacta.
-- Va después de la 1310 (usa _bank_casado_soltar). Nada en el camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261102T1300_b01o_olimpo_recasar.down.sql
-- ============================================================================

do $$
declare
  v_acc  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  -- 1 · el −363,67
  v_c1   constant uuid := 'a79e4d17-44f8-4f97-b13d-e2e9b3fe04b6';
  v_mov1 constant uuid := '0e62eb54-1b29-463a-a67f-242c03174f0a';
  v_as1  constant uuid := 'cb8a8506-0110-4d20-9303-2e4a91e91e0f';
  v_alb  constant uuid := '37060996-e406-4046-9a5d-c45bf94a260c';  -- 26/13028, anulada (era el albarán)
  v_f1   constant uuid := 'e33d20d2-45d6-479e-b5ea-89f338299bb4';  -- 26A/10966
  -- 2 · el −170,10
  v_c2   constant uuid := 'e7e87d64-c7d4-4118-966a-d8c30613addf';
  v_mov2 constant uuid := '910ca451-c900-4fe4-97b0-9afd40cc287d';
  v_as2  constant uuid := '68821b3e-a0ce-4ac1-8132-312a6b3173a9';
  v_f2   constant uuid := '8f11ef90-8535-4d24-882c-5a1d743c5d43';  -- 26A/10965
  -- Olimpo: su cuenta y su tercero (los del asiento 4/3312)
  v_cuenta  constant text := '40000004';
  v_tercero constant uuid := 'dcdbb774-dcfe-4247-93f0-d21bf7d1c5cb';
  v_quien uuid; b public.bank_match; m public.bank_movement; e public.journal_entry; f public.supplier_invoice; v_n int; r jsonb; v_empresa uuid;
begin
  if not exists (select 1 from public.accounts where id = v_acc) then
    raise notice 'B01 cola 2 · 1300: esta base no tiene a Foodint: no hay nada que arreglar.';
    return;
  end if;

  -- Ya hecho: las dos pagadas y cada pago casado con la suya.
  if (select count(*) from public.supplier_invoice where id in (v_f1, v_f2) and status = 'pagada') = 2
     and exists (select 1 from public.bank_match bm join public.bank_match_item it on it.match_id = bm.id where bm.movement_id = v_mov1 and bm.status = 'vivo' and it.supplier_invoice_id = v_f1)
     and exists (select 1 from public.bank_match bm join public.bank_match_item it on it.match_id = bm.id where bm.movement_id = v_mov2 and bm.status = 'vivo' and it.supplier_invoice_id = v_f2) then
    raise notice 'B01 cola 2 · 1300: ya estaba hecho: no se toca nada.';
    return;
  end if;

  -- ── Las anclas (como se midieron el 02/11) ────────────────────────────────
  select * into m from public.bank_movement where id = v_mov1;
  if m.account_id is distinct from v_acc or m.amount <> -363.67 or m.op_date <> date '2026-10-26' or m.bank_concept not like '%26A/10966%' then
    raise exception 'B01 cola 2 · 1300: el movimiento del −363,67 no es el medido.';
  end if;
  select * into m from public.bank_movement where id = v_mov2;
  if m.account_id is distinct from v_acc or m.amount <> -170.10 or m.op_date <> date '2026-10-26' or m.bank_concept not like '%26A/10965%' then
    raise exception 'B01 cola 2 · 1300: el movimiento del −170,10 no es el medido.';
  end if;
  select * into b from public.bank_match where id = v_c1;
  if b.status is distinct from 'vivo' or b.movement_id <> v_mov1 or b.kind <> 'factura_recibida' or b.journal_entry_id <> v_as1 or not b.entry_created
     or not exists (select 1 from public.bank_match_item where match_id = v_c1 and supplier_invoice_id = v_alb)
     or (select count(*) from public.bank_match_item where match_id = v_c1) <> 1 then
    raise exception 'B01 cola 2 · 1300: el casado del −363,67 no es el medido (con la 26/13028).';
  end if;
  v_quien := b.created_by;
  select * into b from public.bank_match where id = v_c2;
  if b.status is distinct from 'vivo' or b.movement_id <> v_mov2 or b.kind <> 'cuenta' or b.journal_entry_id <> v_as2 or not b.entry_created
     or exists (select 1 from public.bank_match_item where match_id = v_c2) then
    raise exception 'B01 cola 2 · 1300: el casado del −170,10 no es el medido («a cuenta», sin factura).';
  end if;
  if b.created_by is distinct from v_quien then raise exception 'B01 cola 2 · 1300: los dos casados no los aceptó la misma persona.'; end if;
  if (select count(*) from public.journal_entry where id in (v_as1, v_as2) and status = 'validado' and account_id = v_acc) <> 2 then
    raise exception 'B01 cola 2 · 1300: los asientos 4/3312 y 4/3310 no están validados.';
  end if;
  if (select status from public.supplier_invoice where id = v_alb) <> 'anulada' then raise exception 'B01 cola 2 · 1300: la 26/13028 no está anulada.'; end if;
  select * into f from public.supplier_invoice where id = v_f1;
  if f.account_id is distinct from v_acc or f.invoice_number <> '26A/10966' or f.grand_total <> 363.67 or f.status <> 'aprobada' or f.paid_at is not null then
    raise exception 'B01 cola 2 · 1300: la 26A/10966 no es como se midió (estado %, total %).', f.status, f.grand_total;
  end if;
  select * into f from public.supplier_invoice where id = v_f2;
  if f.account_id is distinct from v_acc or f.invoice_number <> '26A/10965' or f.grand_total <> 170.10 or f.paid_at is not null then
    raise exception 'B01 cola 2 · 1300: la 26A/10965 no es como se midió (total %).', f.grand_total;
  end if;
  if f.status <> 'aprobada' then
    raise exception 'B01 cola 2 · 1300: la 26A/10965 no está aprobada (está «%»): la tanda para sin tocar nada.', f.status;
  end if;
  if exists (select 1 from public.bank_match_item it join public.bank_match bm on bm.id = it.match_id where it.supplier_invoice_id in (v_f1, v_f2) and bm.status = 'vivo') then
    raise exception 'B01 cola 2 · 1300: la 26A/10966 o la 26A/10965 ya tienen un pago casado.';
  end if;

  -- ── Lo de antes, para la vuelta atrás exacta ──────────────────────────────
  create table if not exists public.conta_b01o_antes as
    select bm.id match_id, bm.journal_entry_id, mv.id movement_id, mv.status mov_status, mv.confidence mov_confidence, mv.reason mov_reason, mv.proposal mov_proposal,
           (select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) from public.supplier_invoice_payment p where p.bank_match_id = bm.id) pagos
      from public.bank_match bm join public.bank_movement mv on mv.id = bm.movement_id
     where bm.id in (v_c1, v_c2);
  alter table public.conta_b01o_antes enable row level security;
  revoke all on table public.conta_b01o_antes from public, anon, authenticated;

  -- ── Como la persona que aceptó las propuestas ─────────────────────────────
  perform set_config('request.jwt.claims', json_build_object('sub', v_quien, 'role', 'authenticated')::text, true);
  if not public.current_user_is_admin_of(v_acc) then
    raise exception 'B01 cola 2 · 1300: quien aceptó las propuestas ya no es administrador de Foodint.';
  end if;

  -- a · Soltar los dos casados.
  if public._bank_casado_soltar(v_c1, 'El banco dice «FACT: 26A/10966»: la 26/13028 era el albarán, anulado por la S01c (arreglo de la cola 2, 02/11).', 'Sumied · B01 cola 2, con el visto bueno de Julio') <> v_as1
     or public._bank_casado_soltar(v_c2, 'El banco dice «FACT: 26A/10965»: es esa factura, no el saldo del libro (arreglo de la cola 2, 02/11).', 'Sumied · B01 cola 2, con el visto bueno de Julio') <> v_as2 then
    raise exception 'B01 cola 2 · 1300: los casados no llevaban los asientos medidos.';
  end if;

  -- b · Borrar los dos asientos, con la función de borrado de Sumied.
  -- La empresa, antes y en su variable: la función hace ALTER TABLE journal_entry y no puede
  -- con una consulta abierta sobre esa tabla en la misma llamada (55006, el primer ensayo).
  select company_id into v_empresa from public.journal_entry where id = v_as1;
  r := public._conta_asientos_borrar(v_empresa, array[v_as1, v_as2],
         'B01 · Olimpo: asiento de pago casado con lo que no era (cola 2, 02/11)', 'Sumied · B01 cola 2, con el visto bueno de Julio');
  raise notice 'B01 cola 2 · 1300: %', r->>'texto';

  -- c · Casar cada pago con su factura.
  perform public.bank_casar(v_mov1,
    jsonb_build_object('tipo', 'factura_recibida', 'facturas', jsonb_build_array(jsonb_build_object('id', v_f1, 'importe', 363.67)),
                       'cuenta_tercero', v_cuenta, 'tercero_id', v_tercero, 'concepto', 'Pago a OLIMPO GOURMET, S.L · 26A/10966', 'metodo', 'transfer'),
    'seguro', 'El banco dice «FACT: 26A/10966»: es esa factura (arreglo de la cola 2, 02/11).', '[]'::jsonb, 'persona', null);
  perform public.bank_casar(v_mov2,
    jsonb_build_object('tipo', 'factura_recibida', 'facturas', jsonb_build_array(jsonb_build_object('id', v_f2, 'importe', 170.10)),
                       'cuenta_tercero', v_cuenta, 'tercero_id', v_tercero, 'concepto', 'Pago a OLIMPO GOURMET, S.L · 26A/10965', 'metodo', 'transfer'),
    'seguro', 'El banco dice «FACT: 26A/10965»: es esa factura (arreglo de la cola 2, 02/11).', '[]'::jsonb, 'persona', null);

  perform set_config('request.jwt.claims', '', true);

  -- ── Cómo queda ────────────────────────────────────────────────────────────
  select count(*) into v_n from public.supplier_invoice where id in (v_f1, v_f2) and status = 'pagada' and paid_at = date '2026-10-26';
  if v_n <> 2 then raise exception 'B01 cola 2 · 1300: las dos facturas no han quedado pagadas el 26/10 (% de 2).', v_n; end if;
  if (select count(*) from public.bank_match where id in (v_c1, v_c2) and status = 'deshecho') <> 2 then
    raise exception 'B01 cola 2 · 1300: los dos casados de antes no se han deshecho.';
  end if;
  if exists (select 1 from public.journal_entry where id in (v_as1, v_as2)) then
    raise exception 'B01 cola 2 · 1300: los asientos 4/3312 y 4/3310 siguen ahí.';
  end if;
  if public._conta_cadena_rota(v_empresa) <> 0 then
    raise exception 'B01 cola 2 · 1300: la cadena de huellas no cuadra después de borrar.';
  end if;
  if (select status from public.supplier_invoice where id = v_alb) <> 'anulada' or (select payment_entry_id from public.supplier_invoice where id = v_alb) is not null
     or exists (select 1 from public.supplier_invoice_payment where invoice_id = v_alb) then
    raise exception 'B01 cola 2 · 1300: la 26/13028 no ha quedado anulada y sin pago.';
  end if;
  raise notice 'B01 cola 2 · 1300: el −363,67 con la 26A/10966 y el −170,10 con la 26A/10965, las dos pagadas el 26/10; 4/3312 y 4/3310 borrados (lote %).', r->>'lote';
end $$;
