-- supabase/migrations/20261126T1241_k14b_qbo_un_banco.sql
--
-- K14b · QBO Integrity: un solo banco, «CaixaBank», con la subcuenta 57200000 y sus 847 movimientos (Julio, 26/11).
-- Necesita la 20261126T1240 delante (_bank_juntar y _bank_antes_del_inicio_recalcular).
--
-- Lo que pasó el 26/11: el extracto de DiezBank (sin IBAN) no encontró banco y se dio de alta otro, «57200000», con
-- el IBAN ···7181 del «CaixaBank» del 06/11 (sin movimientos). Los 847 movimientos quedaron en el nuevo, con su
-- subcuenta 57200004. Y como QBO aún no tenía día de inicio, ninguno quedó «de antes del inicio», y el agente casó y
-- validó los 37 ingresos de GoCardless (57200004 / 57200002, 132.876,37 €): 33 de junio a octubre, que ERP10 ya tiene
-- (en Sumied, dos veces), y 4 de noviembre en la subcuenta que no es.
--
-- En este orden, y todo o nada:
--   1. Se deshacen los 37 casados (bank_deshacer, como «Deshacer» en Bancos): cada asiento se anula con su
--      contraasiento (de hoy; ni el anulado ni el contraasiento salen a ERP10) y su movimiento vuelve a «pendiente».
--      No se borra ningún movimiento. (Julio, 26/11: «Deshacerlos».)
--   2. Se juntan los dos bancos en el de los movimientos (_bank_juntar): lo que apuntaba al «CaixaBank» del 06/11 pasa a
--      él (hoy, solo su enlace a la 57200001, la tarjeta, que se quita) y ese banco se borra.
--   3. El que queda se llama «CaixaBank» y su subcuenta es la 57200000 (la del banco en el libro mayor de QBO).
--   4. Lo de antes del 01/11 (el día de inicio de QBO) queda «de antes del inicio» (_bank_antes_del_inicio_recalcular):
--      708 movimientos. Ya no piden revisión, y el agente no propone ni valida nada de ellos.
--   5. Los 4 ingresos de GoCardless de noviembre se vuelven a casar con su pago de GoCardless
--      (conta_abono_gocardless_casar), quitando antes la marca de «descartado» que les dejó la anulación (los 33 de
--      antes del 01/11 la conservan: el agente no los vuelve a proponer): el ingreso, 57200000 / 57200002, que es el que el X33 da por hecho («una
--      liquidación ya casada en Bancos ya tiene su asiento»).
--
-- Cobros casados del K14 (conta_banco_cobro): 383, todos del banco que queda; no se tocan.
-- Como un administrador de la cuenta (las funciones de Bancos lo piden): el primero, como en la 20261124T2311.
-- Destruye y mueve: lleva AUTORIZO. Nada en el camino del pedido.

do $$
declare
  emp constant uuid := '58e574ec-012a-4483-9f5b-3501cc023ba4';
  cta constant uuid := 'f4e8032d-510a-4e57-914c-4b67732d8655';
  queda constant uuid := '0094f430-89a8-45b4-b115-bbae8f4cbda1';
  se_va constant uuid := 'ad66f6b8-d878-4e3c-87f8-09d3dcc76d28';
  v_admin uuid; v_572 uuid; v_corte date; r record; v_deshechos int := 0; v_recasados int := 0; v_j jsonb; v_a jsonb;
begin
  -- Solo en producción: en una base sin QBO Integrity (staging, la local) no hay nada que juntar.
  if not exists (select 1 from public.company where id = emp) then
    raise notice 'K14b: esta base no tiene QBO Integrity: no hay nada que juntar.';
    return;
  end if;
  -- 0 · Que todo esté como se midió el 26/11 (si no, para y no hace nada).
  if (select count(*) from public.treasury_account where company_id = emp and kind = 'bank' and iban like '%7181') <> 2
     or not exists (select 1 from public.treasury_account where id = queda and company_id = emp and name = '57200000')
     or not exists (select 1 from public.treasury_account where id = se_va and company_id = emp and name = 'CaixaBank') then
    raise exception 'K14b · 0: los dos bancos de QBO no están como se midieron (ya juntados, o cambiados).';
  end if;
  if exists (select 1 from public.bank_movement where treasury_account_id = se_va) or exists (select 1 from public.bank_statement where treasury_account_id = se_va) then
    raise exception 'K14b · 0: el «CaixaBank» del 06/11 ya tiene movimientos: hay que mirarlo antes de juntar.';
  end if;
  v_corte := public._conta_corte(emp);
  if v_corte is distinct from date '2026-11-01' then raise exception 'K14b · 0: el día de inicio de QBO no es el 01/11/2026 (es %).', v_corte; end if;
  select id into v_572 from public.company_account where company_id = emp and code = '57200000';
  if v_572 is null then raise exception 'K14b · 0: QBO no tiene la 57200000.'; end if;
  if exists (select 1 from public.company_account_link where company_account_id = v_572 and entity = 'bank_account') then
    raise exception 'K14b · 0: la 57200000 ya es de un banco.';
  end if;
  if (select count(*) from public.bank_match b join public.bank_movement m on m.id = b.movement_id
       where m.treasury_account_id = queda and b.status = 'vivo') <> 37
     or exists (select 1 from public.bank_match b join public.bank_movement m on m.id = b.movement_id
                 where m.treasury_account_id = queda and b.status = 'vivo'
                   and (not b.entry_created or not exists (select 1 from public.conta_gc_payout p where p.match_id = b.id))) then
    raise exception 'K14b · 0: los casados del banco no son los 37 ingresos de GoCardless que se midieron.';
  end if;

  select up.user_id into v_admin from public.user_profiles up
   where up.account_id = cta and up.active and up.role = 'admin' order by up.created_at limit 1;
  if v_admin is null then raise exception 'K14b · 0: la cuenta de QBO no tiene administrador.'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform set_config('folvy.cuenta_activa', v_admin::text || ':' || cta::text, true);

  -- 1 · Deshacer los 37, recordando su pago de GoCardless.
  create temp table _k14b_payout (movement_id uuid primary key, payout text not null, fecha date not null) on commit drop;
  insert into _k14b_payout
  select b.movement_id, p.gc_id, m.op_date
    from public.bank_match b join public.bank_movement m on m.id = b.movement_id join public.conta_gc_payout p on p.match_id = b.id
   where m.treasury_account_id = queda and b.status = 'vivo';
  for r in select b.id from public.bank_match b join public.bank_movement m on m.id = b.movement_id
            where m.treasury_account_id = queda and b.status = 'vivo' order by m.op_date, b.id loop
    perform public.bank_deshacer(r.id, 'K14b: casado cuando QBO aún no tenía día de inicio, y en la subcuenta del banco repetido');
    v_deshechos := v_deshechos + 1;
  end loop;

  -- 2 y 3 · Un solo banco, «CaixaBank», con la 57200000.
  v_j := public._bank_juntar(queda, se_va);
  update public.treasury_account set name = 'CaixaBank' where id = queda;
  update public.company_account_link set company_account_id = v_572
   where entity = 'bank_account' and entity_id = queda::text and role = 'principal';
  if not found then
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source, created_by)
    values (cta, emp, v_572, 'bank_account', queda::text, 'principal', 'manual', v_admin);
  end if;

  -- 4 · Lo de antes del 01/11.
  v_a := public._bank_antes_del_inicio_recalcular(emp);

  -- 5 · Los 4 de noviembre, otra vez con su pago de GoCardless (ahora, en la 57200000).
  for r in select x.movement_id, x.payout from _k14b_payout x where x.fecha >= v_corte order by x.fecha loop
    -- Al anularlo, su asiento dejó el movimiento «descartado» (journal_dismissal) para que nadie lo vuelva a proponer
    -- solo. Este sí se vuelve a casar, a propósito: se quita esa marca (solo la de estos 4; los 33 de antes la guardan).
    delete from public.journal_dismissal d
     where d.company_id = emp and d.source_type = 'bank' and d.source_key = r.movement_id::text;
    perform public.conta_abono_gocardless_casar(r.movement_id, r.payout, 'seguro',
      'K14b: el ingreso de su pago de GoCardless (el mismo importe y día), en la subcuenta del banco', 'folvy');
    v_recasados := v_recasados + 1;
  end loop;

  raise notice 'K14b · % deshechos · juntados: % · antes del inicio: % · % de noviembre casados otra vez.', v_deshechos, v_j, v_a, v_recasados;
end $$;
