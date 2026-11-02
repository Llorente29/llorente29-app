-- supabase/migrations/20261102T1837_s01q_borrar_asientos.sql
--
-- S01q · La única forma de BORRAR asientos validados en Sumied (Julio, 02/11,
-- respuestas S01q·3 y S01q·5: «un error del programa se borra, no se anula»).
-- AÑADE, sin tocar nada de lo que existe:
--   · conta_asiento_borrado: el registro y el respaldo de cada borrado (lote):
--     el asiento, sus líneas, sus filas del libro de IVA, sus documentos y los
--     enlaces que lo nombraban, y el número y la cadena de antes de cada asiento
--     que se renumera o se vuelve a encadenar;
--   · _conta_asientos_borrar(empresa, asientos, motivo, quién): borra, renumera
--     su serie para que siga seguida, recalcula la cadena de huellas desde el
--     primer borrado con la función de siempre (journal_huella sobre
--     journal_entry_canonico) y comprueba la cadena entera antes de terminar;
--   · _conta_asientos_borrado_deshacer(lote): lo devuelve todo como estaba.
-- Para (y no hace nada) si un asiento: no es de esa empresa, es de antes del
-- corte, se envió a Diez, está en una declaración, está casado en el banco o
-- tiene algo colgando que no sabe deshacer. Y si un asiento que habría que
-- renumerar se envió a Diez o está en una declaración. Lo dice con su motivo.
-- Los dos disparadores «inalterable» se desactivan SOLO dentro de la
-- transacción que llama y se vuelven a activar antes de salir: no queda
-- ninguna puerta abierta. Nadie de fuera puede llamarlas (ni authenticated
-- ni service_role): solo una tanda, como propietaria.
-- sin hueco: el fichero no retira nada al aplicarse; el «delete from journal_entry» va
-- dentro de _conta_asientos_borrar y solo lo llama una tanda (la 1838, con su lista),
-- y no deja hueco: renumera la serie y recalcula la cadena.

create table if not exists public.conta_asiento_borrado (
  id bigserial primary key,
  lote uuid not null,
  account_id uuid not null,
  company_id uuid not null,
  que text not null check (que in ('asiento', 'renumerado')),
  entry_id uuid not null,
  asiento jsonb,
  lineas jsonb,
  iva jsonb,
  documentos jsonb,
  enlaces jsonb,
  numero_antes integer,
  cadena_antes jsonb,
  motivo text not null,
  quien text not null,
  at timestamptz not null default now(),
  deshecho_at timestamptz
);
create index if not exists conta_asiento_borrado_lote on public.conta_asiento_borrado (lote);
alter table public.conta_asiento_borrado enable row level security;
revoke all on table public.conta_asiento_borrado from public, anon, authenticated;
comment on table public.conta_asiento_borrado is 'S01q · Registro y respaldo de los asientos borrados (y de los renumerados por ello), por lote: para saber qué se borró, por qué y quién, y para deshacerlo.';

-- La cadena de una empresa, sin pedir usuario (la usa el borrado antes de salir).
create or replace function public._conta_cadena_rota(p_company uuid)
returns integer language plpgsql stable security definer set search_path = public as $$
declare r record; v_prev text := null; v_mal int := 0;
begin
  for r in select e.id, e.prev_hash, e.hash from public.journal_entry e where e.company_id = p_company and e.chain_seq is not null order by e.chain_seq loop
    if r.prev_hash is distinct from v_prev or r.hash is distinct from public.journal_huella(v_prev, public.journal_entry_canonico(r.id)) then
      v_mal := v_mal + 1;
    end if;
    v_prev := r.hash;
  end loop;
  return v_mal;
end $$;
revoke all on function public._conta_cadena_rota(uuid) from public, anon, authenticated, service_role;
comment on function public._conta_cadena_rota(uuid) is 'S01q · Cuántos eslabones de la cadena de huellas de la empresa no cuadran (0 = íntegra). La misma cuenta que journal_cadena_comprobar.';

create or replace function public._conta_asientos_borrar(p_company uuid, p_entries uuid[], p_motivo text, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_corte date; v_lote uuid := gen_random_uuid(); v_mal text; v_n int;
  v_min_seq bigint; v_prev text; v_seq bigint; r record; v_iva numeric; v_renum int := 0; v_cadena int := 0;
begin
  if coalesce(btrim(p_motivo), '') = '' or coalesce(btrim(p_quien), '') = '' then
    raise exception 'Borrar asientos: falta el motivo o quién lo pide.' using errcode = '22023';
  end if;
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Borrar asientos: esa empresa no está.' using errcode = 'P0002'; end if;
  if coalesce(array_length(p_entries, 1), 0) = 0 then raise exception 'Borrar asientos: no hay ninguno que borrar.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || p_company, 0));
  v_corte := public._conta_corte(p_company);

  -- Lo que impide borrar, con su motivo. Si hay algo, no se hace nada.
  select string_agg(m, ' ') into v_mal from (
    select format('%s no es de esta empresa.', x) m from unnest(p_entries) x
     where not exists (select 1 from public.journal_entry e where e.id = x and e.company_id = p_company)
    union all
    select format('El asiento %s/%s es del %s, antes del corte (%s): no se borra.', e.series, e.number, to_char(e.entry_date, 'DD/MM/YYYY'), to_char(v_corte, 'DD/MM/YYYY'))
      from public.journal_entry e where e.id = any(p_entries) and v_corte is not null and e.entry_date < v_corte
    union all
    select format('El asiento %s/%s se envió a Diez: no se borra aquí.', e.series, e.number)
      from public.journal_entry e where e.id = any(p_entries) and exists (select 1 from public.external_send x where x.entry_id = e.id)
    union all
    select format('El asiento %s/%s está en una declaración: no se borra.', e.series, e.number)
      from public.journal_entry e where e.id = any(p_entries)
       and exists (select 1 from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id where l.entry_id = e.id)
    union all
    select format('El asiento %s/%s %s: deshazlo antes.', e.series, e.number, q.que)
      from public.journal_entry e cross join lateral (
        select 'está casado en el banco' que where exists (select 1 from public.bank_match b where b.journal_entry_id = e.id)
        union all select 'es el pago de una factura' where exists (select 1 from public.supplier_invoice_payment p where p.entry_id = e.id)
        union all select 'es el pago de un lote' where exists (select 1 from public.supplier_batch b where b.payment_entry_id = e.id)
        union all select 'es de una liquidación de plataforma' where exists (select 1 from public.channel_settlement c where c.journal_entry_id = e.id)
        union all select 'es de una liquidación de un socio' where exists (select 1 from public.licensed_settlement c where c.journal_entry_id = e.id)
        union all select 'es de un cierre de ventas' where exists (select 1 from public.sales_day_summary c where c.entry_id = e.id)
        union all select 'es de unas nóminas' where exists (select 1 from public.payroll_summary c where c.entry_id = e.id)
        union all select 'es de un cierre de ejercicio' where exists (select 1 from public.fiscal_year_closing c where e.id in (c.closing_entry_id, c.regularization_entry_id, c.opening_entry_id))
        union all select 'es de un bien de inversión' where exists (select 1 from public.investment_good c where c.entry_id = e.id)
                     or exists (select 1 from public.investment_good_regularization c where c.entry_id = e.id)
        union all select 'es de una factura emitida' where exists (select 1 from public.customer_invoice c where c.entry_id = e.id)
                     or exists (select 1 from public.customer_invoice_payment c where c.entry_id = e.id)
        union all select 'es de un modelo' where exists (select 1 from public.tax_return c where e.id in (c.liquidation_entry_id, c.payment_entry_id))
        union all select 'tiene una corrección' where exists (select 1 from public.journal_correction c where c.entry_id = e.id)
        union all select 'está anulado o anula a otro' where e.status = 'anulado' or e.reverses_entry_id is not null
                     or exists (select 1 from public.journal_entry o where o.reverses_entry_id = e.id or o.voided_by_entry_id = e.id)
        union all select 'tiene un documento enviado fuera' where exists (select 1 from public.external_document c where c.entry_id = e.id)
      ) q
     where e.id = any(p_entries)
  ) z;
  if v_mal is not null then raise exception 'No se borra nada. %', v_mal using errcode = '23514'; end if;

  -- Lo que se renumera y se vuelve a encadenar: tampoco puede estar fuera.
  select min(chain_seq) into v_min_seq from public.journal_entry where id = any(p_entries) and chain_seq is not null;
  select string_agg(format('El asiento %s/%s, que habría que renumerar, %s: no se borra nada.', e.series, e.number,
                           case when exists (select 1 from public.external_send x where x.entry_id = e.id) then 'se envió a Diez' else 'está en una declaración' end), ' ')
    into v_mal
    from public.journal_entry e
   where e.company_id = p_company and not (e.id = any(p_entries))
     and ((v_min_seq is not null and e.chain_seq > v_min_seq)
          or exists (select 1 from public.journal_entry b where b.id = any(p_entries) and b.fiscal_year_id = e.fiscal_year_id and b.series = e.series and e.number > b.number))
     and (exists (select 1 from public.external_send x where x.entry_id = e.id)
          or exists (select 1 from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id where l.entry_id = e.id));
  if v_mal is not null then raise exception '%', v_mal using errcode = '23514'; end if;
  if public._conta_cadena_rota(p_company) <> 0 then
    raise exception 'No se borra nada: la cadena de huellas ya estaba rota antes de empezar.' using errcode = '23514';
  end if;

  -- El respaldo: cada asiento con lo suyo, y lo que lo nombraba.
  insert into public.conta_asiento_borrado (lote, account_id, company_id, que, entry_id, asiento, lineas, iva, documentos, enlaces, numero_antes, cadena_antes, motivo, quien)
  select v_lote, e.account_id, e.company_id, 'asiento', e.id, to_jsonb(e),
         (select coalesce(jsonb_agg(to_jsonb(l) order by l.position), '[]') from public.journal_line l where l.entry_id = e.id),
         (select coalesce(jsonb_agg(to_jsonb(v)), '[]') from public.vat_book_entry v where v.entry_id = e.id),
         (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.journal_entry_document d where d.entry_id = e.id),
         jsonb_build_object(
           'factura', (select coalesce(jsonb_agg(s.id), '[]') from public.supplier_invoice s where s.journal_entry_id = e.id),
           'factura_pago', (select coalesce(jsonb_agg(s.id), '[]') from public.supplier_invoice s where s.payment_entry_id = e.id),
           'actividad', (select coalesce(jsonb_agg(a.id), '[]') from public.document_activity a where a.journal_entry_id = e.id),
           'resolucion', (select coalesce(jsonb_agg(c.id), '[]') from public.conta_liquidacion_resolucion c where c.entry_id = e.id),
           'diez_autorizo', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.conta_diez_autorizo c where c.entry_id = e.id),
           'iva_reabierto', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.vat_reopening_entry c where c.entry_id = e.id)),
         e.number, jsonb_build_object('chain_seq', e.chain_seq, 'prev_hash', e.prev_hash, 'hash', e.hash),
         p_motivo, p_quien
    from public.journal_entry e where e.id = any(p_entries);
  select coalesce(sum(v.tax_amount), 0) into v_iva from public.vat_book_entry v where v.entry_id = any(p_entries);

  -- Solo en esta transacción: sin los dos candados de «inalterable».
  -- Lo diferido de esta transacción se comprueba ya (si no, la tabla no deja desactivar nada).
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
  alter table public.journal_line disable trigger trg_journal_line_inalterable;

  update public.supplier_invoice set journal_entry_id = null, updated_at = now() where journal_entry_id = any(p_entries);
  update public.supplier_invoice set payment_entry_id = null, updated_at = now() where payment_entry_id = any(p_entries);
  update public.document_activity set journal_entry_id = null where journal_entry_id = any(p_entries);
  update public.conta_liquidacion_resolucion set entry_id = null where entry_id = any(p_entries);
  delete from public.vat_book_entry where entry_id = any(p_entries);
  delete from public.journal_entry_document where entry_id = any(p_entries);
  delete from public.journal_entry where id = any(p_entries);   -- sus líneas, envíos pendientes y autorizos, en cascada

  -- Renumerar: en cada serie y ejercicio tocados, lo de detrás del primer borrado, seguido.
  for r in
    select e.id, e.fiscal_year_id, e.series, e.number,
           (select min(b.numero_antes) from public.conta_asiento_borrado b
             where b.lote = v_lote and b.que = 'asiento' and (b.asiento->>'fiscal_year_id')::uuid = e.fiscal_year_id and (b.asiento->>'series')::smallint = e.series) as desde
      from public.journal_entry e
     where e.company_id = p_company and e.number is not null
       and exists (select 1 from public.conta_asiento_borrado b where b.lote = v_lote and b.que = 'asiento'
                     and (b.asiento->>'fiscal_year_id')::uuid = e.fiscal_year_id and (b.asiento->>'series')::smallint = e.series and e.number > b.numero_antes)
     order by e.fiscal_year_id, e.series, e.number
  loop
    insert into public.conta_asiento_borrado (lote, account_id, company_id, que, entry_id, numero_antes, cadena_antes, motivo, quien)
    select v_lote, e.account_id, e.company_id, 'renumerado', e.id, e.number, jsonb_build_object('chain_seq', e.chain_seq, 'prev_hash', e.prev_hash, 'hash', e.hash), p_motivo, p_quien
      from public.journal_entry e where e.id = r.id;
    update public.journal_entry e set number = r.desde + (
             select count(*) from public.journal_entry o
              where o.company_id = p_company and o.fiscal_year_id = r.fiscal_year_id and o.series = r.series
                and o.number is not null and o.number >= r.desde and o.number < r.number)
     where e.id = r.id;
    v_renum := v_renum + 1;
  end loop;

  -- La cadena: desde el primer borrado, eslabones seguidos y cada huella con la función de siempre.
  if v_min_seq is not null then
    select hash into v_prev from public.journal_entry where company_id = p_company and chain_seq is not null and chain_seq < v_min_seq order by chain_seq desc limit 1;
    v_seq := v_min_seq - 1;
    for r in select e.id from public.journal_entry e where e.company_id = p_company and e.chain_seq >= v_min_seq order by e.chain_seq loop
      insert into public.conta_asiento_borrado (lote, account_id, company_id, que, entry_id, numero_antes, cadena_antes, motivo, quien)
      select v_lote, e.account_id, e.company_id, 'renumerado', e.id, e.number, jsonb_build_object('chain_seq', e.chain_seq, 'prev_hash', e.prev_hash, 'hash', e.hash), p_motivo, p_quien
        from public.journal_entry e
       where e.id = r.id and not exists (select 1 from public.conta_asiento_borrado b where b.lote = v_lote and b.entry_id = r.id);
      v_seq := v_seq + 1;
      update public.journal_entry set chain_seq = v_seq, prev_hash = v_prev where id = r.id;
      update public.journal_entry set hash = public.journal_huella(v_prev, public.journal_entry_canonico(r.id)) where id = r.id returning hash into v_prev;
      v_cadena := v_cadena + 1;
    end loop;
  end if;

  alter table public.journal_line enable trigger trg_journal_line_inalterable;
  alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;

  if public._conta_cadena_rota(p_company) <> 0 then
    raise exception 'No se borra nada: después de borrar, la cadena de huellas no cuadra.' using errcode = '23514';
  end if;
  select count(*) into v_n from public.conta_asiento_borrado b where b.lote = v_lote and b.que = 'asiento';
  return jsonb_build_object('lote', v_lote, 'borrados', v_n, 'iva', v_iva, 'renumerados', v_renum, 'reencadenados', v_cadena,
                            'texto', format('Borrados %s asientos (y %s de IVA del libro). Renumerados %s, y la cadena vuelta a encadenar desde el primero (%s eslabones): íntegra.',
                                            v_n, public.conta_euros_exactos(v_iva), v_renum, v_cadena));
end $$;
revoke all on function public._conta_asientos_borrar(uuid, uuid[], text, text) from public, anon, authenticated, service_role;
comment on function public._conta_asientos_borrar(uuid, uuid[], text, text) is 'S01q · La única forma de borrar asientos validados: con respaldo (conta_asiento_borrado), renumerando su serie, recalculando la cadena y comprobándola. Para si algo no se puede deshacer. Solo una tanda.';

create or replace function public._conta_asientos_borrado_deshacer(p_lote uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_company uuid; r record; v_n int := 0; l jsonb;
begin
  select company_id into v_company from public.conta_asiento_borrado where lote = p_lote and deshecho_at is null limit 1;
  if v_company is null then return jsonb_build_object('deshechos', 0, 'texto', 'Ese lote no está, o ya se deshizo.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || v_company, 0));
  -- Lo diferido de esta transacción se comprueba ya (si no, la tabla no deja desactivar nada).
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
  alter table public.journal_line disable trigger trg_journal_line_inalterable;
  -- Primero se apartan los números y eslabones de los que se movieron, para que no choquen.
  update public.journal_entry e set number = e.number + 100000000, chain_seq = e.chain_seq + 1000000000000
    from public.conta_asiento_borrado b where b.lote = p_lote and b.que = 'renumerado' and b.entry_id = e.id;
  -- Los borrados vuelven tal cual, con sus líneas, su IVA y sus documentos.
  for r in select * from public.conta_asiento_borrado where lote = p_lote and que = 'asiento' order by id loop
    insert into public.journal_entry select * from jsonb_populate_record(null::public.journal_entry, r.asiento);
    insert into public.journal_line select x.* from jsonb_array_elements(r.lineas) j, jsonb_populate_record(null::public.journal_line, j) x;
    insert into public.vat_book_entry select x.* from jsonb_array_elements(r.iva) j, jsonb_populate_record(null::public.vat_book_entry, j) x;
    insert into public.journal_entry_document select x.* from jsonb_array_elements(r.documentos) j, jsonb_populate_record(null::public.journal_entry_document, j) x;
    update public.supplier_invoice set journal_entry_id = r.entry_id where id in (select (j #>> '{}')::uuid from jsonb_array_elements(r.enlaces->'factura') j);
    update public.supplier_invoice set payment_entry_id = r.entry_id where id in (select (j #>> '{}')::uuid from jsonb_array_elements(r.enlaces->'factura_pago') j);
    update public.document_activity set journal_entry_id = r.entry_id where id in (select (j #>> '{}')::uuid from jsonb_array_elements(r.enlaces->'actividad') j);
    update public.conta_liquidacion_resolucion set entry_id = r.entry_id where id in (select (j #>> '{}')::uuid from jsonb_array_elements(r.enlaces->'resolucion') j);
    for l in select * from jsonb_array_elements(coalesce(r.enlaces->'diez_autorizo', '[]')) loop
      insert into public.conta_diez_autorizo select * from jsonb_populate_record(null::public.conta_diez_autorizo, l);
    end loop;
    for l in select * from jsonb_array_elements(coalesce(r.enlaces->'iva_reabierto', '[]')) loop
      insert into public.vat_reopening_entry select * from jsonb_populate_record(null::public.vat_reopening_entry, l);
    end loop;
    v_n := v_n + 1;
  end loop;
  -- Los que se movieron, a su número y su cadena de antes.
  update public.journal_entry e set number = b.numero_antes, chain_seq = (b.cadena_antes->>'chain_seq')::bigint,
         prev_hash = b.cadena_antes->>'prev_hash', hash = b.cadena_antes->>'hash'
    from public.conta_asiento_borrado b where b.lote = p_lote and b.que = 'renumerado' and b.entry_id = e.id;
  alter table public.journal_line enable trigger trg_journal_line_inalterable;
  alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;
  if public._conta_cadena_rota(v_company) <> 0 then
    raise exception 'No se deshace nada: al devolverlo, la cadena de huellas no cuadra.' using errcode = '23514';
  end if;
  update public.conta_asiento_borrado set deshecho_at = now() where lote = p_lote;
  return jsonb_build_object('deshechos', v_n, 'texto', format('Devueltos %s asientos, con su número, su cadena, sus líneas, su IVA y sus documentos.', v_n));
end $$;
revoke all on function public._conta_asientos_borrado_deshacer(uuid) from public, anon, authenticated, service_role;
comment on function public._conta_asientos_borrado_deshacer(uuid) is 'S01q · Deshace un lote de _conta_asientos_borrar: los asientos vuelven con lo suyo, y los renumerados a su número y su cadena de antes.';
