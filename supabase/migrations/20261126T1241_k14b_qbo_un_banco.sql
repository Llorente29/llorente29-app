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
-- Regla de Julio (26/11): hasta el 31/10 la única verdad es ERP10, y en Sumied no se toca; lo que entró por un error de
-- programación o por una prueba se BORRA, sin anular y sin contraasientos. En este orden, y todo o nada:
--   1. Los 37 asientos de banco que creó el agente se borran, por el mismo camino que _bank_asiento_quitar (cada uno,
--      con su asiento y sus líneas, a conta_asiento_borrado), sin sus dos pegas de hoy («de antes del corte» y «hueco
--      en la numeración»). Antes se comprueba que ninguno ha salido a ERP10, ni a Diez, ni tiene IVA, documentos o
--      anulaciones. Su casado queda deshecho y su movimiento vuelve a «pendiente». No se borra ningún movimiento.
--      La numeración: son los números 1 a 37 de su serie (la 3, de 2026), y en ella no hay ninguno más: no queda hueco.
--   2. Se juntan los dos bancos en el de los movimientos (_bank_juntar): lo que apuntaba al «CaixaBank» del 06/11 pasa a
--      él (hoy, solo su enlace a la 57200001, la tarjeta, que se quita) y ese banco se borra.
--   3. El que queda se llama «CaixaBank» y su subcuenta es la 57200000 (la del banco en el libro mayor de QBO).
--   4. Lo de antes del 01/11 (el día de inicio de QBO) queda «de antes del inicio» (_bank_antes_del_inicio_recalcular):
--      708 movimientos. Ya no piden revisión, y el agente no propone ni valida nada de ellos (ni la base lo deja).
--   5. Los 4 ingresos de GoCardless de noviembre se vuelven a casar con su pago de GoCardless
--      (conta_abono_gocardless_casar): el ingreso, 57200000 / 57200002, que es el que el X33 da por hecho («una
--      liquidación ya casada en Bancos ya tiene su asiento»).
--   0. Además de las guardas de lo medido: el ejercicio 2026 tiene que dejar validar (el paso 5 valida los 4 de
--      noviembre). Hoy no deja: es «mixed» de ERP10, sin lo de enero a octubre traído (0 asientos de 2026 traídos) y sin
--      «Empezar a trabajar ya». Sin esta guarda, el paso 5 paraba en 23514 («falta_historico»); con ella, para antes y
--      dice por qué. Lo decide Julio en Ajustes › Ejercicio; la tanda no lo toca.
--   6. La cadena de huellas del diario de QBO, sin hueco: los 37 eran sus eslabones 1 a 37 y detrás van los 4.425
--      asientos de 2024 traídos de ERP10 (ninguno ha salido a ningún sitio; su contenido no cambia). Se vuelven a numerar desde 1 y se rehace cada huella
--      con la anterior, en orden (journal_huella y journal_entry_canonico, como al validar). Solo cambian chain_seq,
--      prev_hash y hash; para eso se aparta journal_entry_inalterable dentro de esta transacción y se vuelve a poner.
--      Al acabar, _conta_cadena_rota tiene que dar 0.
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
  v_prev text; v_h text; v_seq bigint := 0; v_rehechas int := 0;
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
  -- El ejercicio 2026 tiene que dejar validar (los 4 de noviembre se vuelven a casar y validar): lo anterior traído, o
  -- «empezar a trabajar ya» decidido en Ajustes › Ejercicio (_conta_falta_historico_motivo).
  if exists (select 1 from public.fiscal_year y where y.company_id = emp and y.starts_on = date '2026-01-01'
              and y.origin in ('mixed', 'migrated') and y.origin_program is not null
              and y.history_imported_at is null and y.works_without_history_at is null) then
    raise exception 'K14b · 0: el ejercicio 2026 de QBO no deja validar: falta traer lo anterior al 01/11 o decidir «empezar a trabajar ya» en Ajustes › Ejercicio.';
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

-- sin hueco: los 37 asientos que se borran son los números 1 a 37 de la serie 3 de 2026 de QBO y no hay ningún otro en
-- esa serie (lo comprueba el paso 1); la cadena se rehace entera en el paso 6. No son asientos ni resúmenes del día.
  -- 1 · Borrar los 37, recordando su pago de GoCardless (el mismo camino que _bank_asiento_quitar, sin sus dos pegas).
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || emp, 0));
  create temp table _k14b_payout (movement_id uuid primary key, payout text not null, fecha date not null) on commit drop;
  insert into _k14b_payout
  select b.movement_id, p.gc_id, m.op_date
    from public.bank_match b join public.bank_movement m on m.id = b.movement_id join public.conta_gc_payout p on p.match_id = b.id
   where m.treasury_account_id = queda and b.status = 'vivo';
  for r in select b.id as match_id, b.movement_id, e.id, e.series, e.number, e.status, e.source_type, e.company_id
             from public.bank_match b join public.bank_movement m on m.id = b.movement_id join public.journal_entry e on e.id = b.journal_entry_id
            where m.treasury_account_id = queda and b.status = 'vivo' order by e.chain_seq loop
    if r.status <> 'validado' or r.source_type <> 'bank' or r.company_id <> emp
       or exists (select 1 from public.conta_erp10_salida_partida x where x.entry_id = r.id) or exists (select 1 from public.conta_erp10_envio x where x.entry_id = r.id)
       or exists (select 1 from public.conta_erp10_a_mano x where x.entry_id = r.id) or exists (select 1 from public.external_send x where x.entry_id = r.id)
       or exists (select 1 from public.vat_book_entry x where x.entry_id = r.id) or exists (select 1 from public.journal_entry_document x where x.entry_id = r.id)
       or exists (select 1 from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id where l.entry_id = r.id)
       or exists (select 1 from public.journal_entry o where o.reverses_entry_id = r.id or o.voided_by_entry_id = r.id) then
      raise exception 'K14b · 1: el asiento %/% no se puede borrar: ha salido, tiene IVA, documentos o anulaciones.', r.series, r.number;
    end if;
    update public.bank_match set status = 'deshecho', undone_at = now(), undone_by = v_admin, undone_by_name = public.conta_nombre_actor(),
           undo_reason = 'K14b: casado por el agente cuando QBO aún no tenía día de inicio; su asiento se borra (regla de Julio, 26/11)'
     where id = r.match_id;
    update public.bank_movement set status = 'pendiente', confidence = null, reason = null, proposal = null, updated_at = now() where id = r.movement_id;
    insert into public.conta_asiento_borrado (lote, account_id, company_id, que, entry_id, asiento, lineas, iva, documentos, enlaces, numero_antes, cadena_antes, motivo, quien)
    select gen_random_uuid(), e.account_id, e.company_id, 'asiento', e.id, to_jsonb(e),
           (select coalesce(jsonb_agg(to_jsonb(l) order by l.position), '[]') from public.journal_line l where l.entry_id = e.id),
           '[]'::jsonb, '[]'::jsonb,
           jsonb_build_object('factura_pago', (select coalesce(jsonb_agg(s.id), '[]') from public.supplier_invoice s where s.payment_entry_id = e.id),
                              'actividad', (select coalesce(jsonb_agg(a.id), '[]') from public.document_activity a where a.journal_entry_id = e.id),
                              'casado', r.match_id),
           e.number, jsonb_build_object('chain_seq', e.chain_seq, 'prev_hash', e.prev_hash, 'hash', e.hash),
           'K14b: asiento de banco creado por el agente cuando QBO no tenía día de inicio (hasta el 31/10 manda ERP10; regla de Julio, 26/11)',
           public.conta_nombre_actor()
      from public.journal_entry e where e.id = r.id;
    update public.supplier_invoice set payment_entry_id = null, updated_at = now() where payment_entry_id = r.id;
    update public.document_activity set journal_entry_id = null where journal_entry_id = r.id;
    perform set_config('folvy.asiento_quitar', r.id::text, true);
    delete from public.journal_entry where id = r.id;   -- sus líneas, en cascada
    perform set_config('folvy.asiento_quitar', '', true);
    perform public._bank_log(cta, emp, r.movement_id, r.match_id, null, 'deshecho', 'persona',
      format('Deshecho: su asiento %s/%s se borra (K14b: casado cuando QBO no tenía día de inicio)', r.series, r.number), jsonb_build_object('asiento', r.id));
    v_deshechos := v_deshechos + 1;
  end loop;
  if exists (select 1 from public.journal_entry o where o.company_id = emp and o.series = 3 and o.fiscal_year_id = '0660590d-5b9b-4df6-b248-b70f8655342b') then
    raise exception 'K14b · 1: en la serie 3 de 2026 quedan otros asientos: borrar estos dejaría un hueco en la numeración.';
  end if;

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
    perform public.conta_abono_gocardless_casar(r.movement_id, r.payout, 'seguro',
      'K14b: el ingreso de su pago de GoCardless (el mismo importe y día), en la subcuenta del banco', 'folvy');
    v_recasados := v_recasados + 1;
  end loop;

  -- 6 · La cadena de huellas, sin hueco: desde 1, cada huella con la anterior, como al validar.
  execute 'alter table public.journal_entry disable trigger trg_journal_entry_inalterable';
  v_prev := null; v_seq := 0;
  for r in select e.id, e.chain_seq, e.prev_hash, e.hash from public.journal_entry e
            where e.company_id = emp and e.chain_seq is not null order by e.chain_seq loop
    v_seq := v_seq + 1;
    v_h := public.journal_huella(v_prev, public.journal_entry_canonico(r.id));
    if r.chain_seq <> v_seq or r.prev_hash is distinct from v_prev or r.hash is distinct from v_h then
      update public.journal_entry set chain_seq = v_seq, prev_hash = v_prev, hash = v_h where id = r.id;
      v_rehechas := v_rehechas + 1;
    end if;
    v_prev := v_h;
  end loop;
  execute 'alter table public.journal_entry enable trigger trg_journal_entry_inalterable';
  if public._conta_cadena_rota(emp) <> 0 then raise exception 'K14b · 6: la cadena de QBO no ha quedado entera.'; end if;

  raise notice 'K14b · % asientos borrados · juntados: % · antes del inicio: % · % de noviembre casados otra vez · cadena: % eslabones, % rehechos.',
    v_deshechos, v_j, v_a, v_recasados, v_seq, v_rehechas;
end $$;
