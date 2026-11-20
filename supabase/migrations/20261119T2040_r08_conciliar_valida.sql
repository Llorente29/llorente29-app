-- supabase/migrations/20261119T2040_r08_conciliar_valida.sql
--
-- R08 · 2 · Conciliar es el último paso, y Deshacer lo quita del diario (Julio, 19/11).
--
--   1. _bank_casar_nucleo, POR TROZOS EXACTOS sobre lo que hay (el de la N10, con su freno y su marca de
--      pagada que leen _bank_recibida_pagado, que no se tocan; R08 · 1 de Julio): el asiento que crea o
--      enlaza queda VALIDADO en la misma transacción, lo concilie una persona, Sumied solo, una remesa o una
--      pasarela (todos pasan por aquí). Si no se puede validar, no se concilia: el error sube y no queda
--      nada propuesto. Antes, solo lo «seguro» de Sumied con el ajuste validate_safe. Y el movimiento
--      apartado lo dice en palabras. Si un trozo no está una sola vez, PARA sin tocar nada.
--   2. bank_deshacer (el texto de la 0110 del B01, md5 2bd49860…, igual en producción): un asiento validado
--      se QUITA del diario (Julio, respuesta R08 · 1, punto 3) cuando se puede sin dejar hueco ni nada fuera
--      (_bank_asiento_razon_contra); si no, se anula con su contraasiento y se dice por qué en palabras:
--      salió a ERP10, lleva IVA de un trimestre presentado, se envió a Diez, está en una declaración, es de
--      antes del corte, tiene documentos o su libro de IVA, o detrás ya hay otros asientos (quitarlo dejaría
--      un hueco en la numeración de su serie y rompería la cadena de huellas: eso no se arregla aquí).
--   3. journal_entry_inalterable, por un trozo exacto: deja BORRAR un validado solo si esta transacción lo
--      ha pedido para ESE asiento (folvy.asiento_quitar), como ya deja poner su huella (folvy.journal_huella).
--      Sus líneas se van en cascada (el disparador de las líneas ya lo deja con el asiento borrado).
--   4. Nuevas: _bank_asiento_razon_contra (por qué no se puede quitar, o null) y _bank_asiento_quitar (lo
--      quita con su respaldo en conta_asiento_borrado, con el cerrojo de numerar de la empresa, y comprueba
--      antes que sigue siendo el último de su serie y de la cadena).
-- Las que cambian: misma firma (create or replace, sin sobrecargas: regla 2), su respaldo antes.
-- No retira asientos al aplicarse. Nada del camino del pedido se toca salvo esa puerta, que solo se abre
-- con el ajuste.
-- sin hueco: el fichero no retira nada al aplicarse. El «delete from journal_entry» es el de bank_deshacer
-- de siempre (quita un asiento sin validar) y el de _bank_asiento_quitar (el último de su serie y de la
-- cadena, con su respaldo: no deja hueco).
-- cambia: public._bank_casar_nucleo · prueba: supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
-- cambia: public.bank_deshacer · prueba: supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
-- cambia: public.journal_entry_inalterable · prueba: supabase/staging/sql/20261119_r08_conciliar_en_un_paso_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261119T2040_r08_conciliar_valida.down.sql

set local lock_timeout = '5s';

-- Si ya está pasada (lleva la marca del R08), ni para ni vuelve a respaldar: la vuelta atrás restaura la de antes.
do $$ begin
  if strpos(pg_get_functiondef('public.bank_deshacer(uuid,text)'::regprocedure), '_bank_asiento_razon_contra') > 0 then return; end if;
  if md5(pg_get_functiondef('public.bank_deshacer(uuid,text)'::regprocedure)) <> '2bd4986001f368ade6dd483b9b23dc54' then
    raise exception 'R08 · 2040: bank_deshacer no es el medido (2bd49860): no se toca nada.';
  end if;
  perform public._respaldar_funcion('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', '20261119T2040_r08_conciliar_valida');
  perform public._respaldar_funcion('public.bank_deshacer(uuid,text)', '20261119T2040_r08_conciliar_valida');
  perform public._respaldar_funcion('public.journal_entry_inalterable()', '20261119T2040_r08_conciliar_valida');
end $$;

-- ── 1 y 3 · Por trozos exactos ──────────────────────────────────────────────
do $do$
declare
  r record; v_def text; k int;
  a_viejo text := $v$  -- Lo seguro se valida solo si la empresa lo ha activado (apagado por defecto).
  if v_creado and p_confianza = 'seguro' and p_por = 'folvy' and v_aj.validate_safe then
    begin
      perform public._journal_entry_validar(v_entry, 'Folvy');
      v_validado := true;
    exception when others then
      v_aviso := 'No se ha podido validar solo: ' || sqlerrm || '. Queda propuesto.';
    end;
  end if;
$v$;
  a_nuevo text := $n$  -- R08 · conciliar es el último paso (Julio, 19/11): el asiento que crea o enlaza queda VALIDADO, en el
  -- diario, en esta misma transacción, lo concilie una persona, Sumied solo, una remesa o una pasarela.
  -- Si no se puede validar (un periodo cerrado, por ejemplo), no se concilia: el error sube, en palabras.
  if exists (select 1 from public.journal_entry e where e.id = v_entry and e.status in ('propuesto', 'borrador')) then
    perform public._journal_entry_validar(v_entry, case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end);
    v_validado := true;
  end if;
$n$;
  b_viejo text := $v$    perform public._bank_log(v_cuenta, v_m.company_id, v_m.id, v_match, null, 'validado', 'folvy', 'Validado solo: es seguro y la empresa lo tiene activado', '{}'::jsonb);$v$;
  b_nuevo text := $n$    perform public._bank_log(v_cuenta, v_m.company_id, v_m.id, v_match, null, 'validado', p_por, 'Conciliado: el asiento está en el diario', '{}'::jsonb);$n$;
  c_viejo text := $v$  if v_m.status = 'ignorado' then raise exception 'Ese movimiento está ignorado.' using errcode = '23514'; end if;$v$;
  c_nuevo text := $n$  if v_m.status = 'ignorado' then
    raise exception '%', case when v_m.ignored_reason ilike 'Anulado por el banco%' then 'Este movimiento está apartado: el banco no lo cobró. Vuelve a abrirlo para conciliarlo.'
                              else 'Este movimiento está apartado (' || coalesce(nullif(trim(v_m.ignored_reason), ''), 'sin motivo') || '). Vuelve a abrirlo para conciliarlo.' end using errcode = '23514';
  end if;$n$;
  i_viejo text := $v$  if tg_op = 'DELETE' then
    if old.number is not null or old.status in ('validado', 'anulado') then$v$;
  i_nuevo text := $n$  if tg_op = 'DELETE' then
    -- R08 · Bancos quita del diario el último asiento validado de su serie y de la cadena (_bank_asiento_quitar),
    -- y solo ese: lo pide esta transacción para ESE asiento.
    if old.status = 'validado' and current_setting('folvy.asiento_quitar', true) = old.id::text then
      return old;
    end if;
    if old.number is not null or old.status in ('validado', 'anulado') then$n$;
begin
  for r in select * from (values
      ('public._bank_casar_nucleo(uuid,jsonb,text,text,jsonb,text,uuid)', 'R08 · conciliar es el último paso', array[a_viejo, b_viejo, c_viejo], array[a_nuevo, b_nuevo, c_nuevo]),
      ('public.journal_entry_inalterable()', 'folvy.asiento_quitar', array[i_viejo], array[i_nuevo])) t(firma, marca, viejos, nuevos) loop
    v_def := pg_get_functiondef(r.firma::regprocedure);
    continue when strpos(v_def, r.marca) > 0;   -- ya pasada
    for k in 1 .. array_length(r.viejos, 1) loop
      if (length(v_def) - length(replace(v_def, r.viejos[k], ''))) / length(r.viejos[k]) <> 1 then
        raise exception 'R08 · 2040: % no es la medida (su trozo % no está una sola vez): no se toca.', r.firma, k;
      end if;
      v_def := replace(v_def, r.viejos[k], r.nuevos[k]);
    end loop;
    execute v_def;
  end loop;
end $do$;
revoke all on function public._bank_casar_nucleo(uuid, jsonb, text, text, jsonb, text, uuid) from public, anon, authenticated, service_role;

-- ── 4 · Por qué no se puede quitar, y quitarlo ──────────────────────────────
create or replace function public._bank_asiento_razon_contra(p_entry uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare e public.journal_entry; v_corte date;
begin
  select * into e from public.journal_entry where id = p_entry;
  if e.id is null or e.status <> 'validado' then return 'no está validado'; end if;
  if exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = e.id)
     or exists (select 1 from public.conta_erp10_envio x where x.entry_id = e.id)
     or exists (select 1 from public.conta_erp10_a_mano x where x.entry_id = e.id) then
    return 'ya salió a ERP10';
  end if;
  if public.conta_iva_presentado(e.company_id, e.entry_date) is not null and public._conta_asiento_lleva_iva(e.id) is not null then
    return format('lleva IVA y el trimestre del %s ya está presentado', to_char(e.entry_date, 'DD/MM/YYYY'));
  end if;
  if exists (select 1 from public.external_send x where x.entry_id = e.id) then return 'se envió a Diez'; end if;
  if exists (select 1 from public.tax_return_line t join public.journal_line l on l.id = t.journal_line_id where l.entry_id = e.id) then return 'está en una declaración'; end if;
  v_corte := public._conta_corte(e.company_id);
  if v_corte is not null and e.entry_date < v_corte then return 'es de antes del corte'; end if;
  if exists (select 1 from public.vat_book_entry v where v.entry_id = e.id) or exists (select 1 from public.journal_entry_document d where d.entry_id = e.id)
     or exists (select 1 from public.conta_pdf_llave k where k.entry_id = e.id) or exists (select 1 from public.external_document d where d.entry_id = e.id) then
    return 'tiene su libro de IVA o sus documentos';
  end if;
  if exists (select 1 from public.journal_entry o where o.reverses_entry_id = e.id or o.voided_by_entry_id = e.id) or e.reverses_entry_id is not null then
    return 'anula a otro o lo anulan';
  end if;
  if exists (select 1 from public.journal_entry o where o.company_id = e.company_id and o.chain_seq > e.chain_seq)
     or exists (select 1 from public.journal_entry o where o.company_id = e.company_id and o.fiscal_year_id = e.fiscal_year_id and o.series = e.series and o.number > e.number) then
    return 'detrás ya hay otros asientos en el diario, y quitarlo dejaría un hueco en la numeración';
  end if;
  return null;
end $$;
revoke all on function public._bank_asiento_razon_contra(uuid) from public, anon, authenticated, service_role;
comment on function public._bank_asiento_razon_contra(uuid) is
  'R08 · Por qué un asiento validado de Bancos no se puede quitar del diario al deshacer (y se anula con su contraasiento), en palabras; null si se puede: es el último de su serie y de la cadena y no ha salido a ningún sitio.';

create or replace function public._bank_asiento_quitar(p_entry uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.journal_entry; v_porque text;
begin
  select * into e from public.journal_entry where id = p_entry;
  if e.id is null then return; end if;
  -- El cerrojo de numerar de la empresa (el de validar): nadie valida detrás mientras tanto.
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || e.company_id, 0));
  v_porque := public._bank_asiento_razon_contra(p_entry);
  if v_porque is not null then
    raise exception 'No se quita del diario el asiento %/%: %.', e.series, e.number, v_porque using errcode = '23514';
  end if;
  insert into public.conta_asiento_borrado (lote, account_id, company_id, que, entry_id, asiento, lineas, iva, documentos, enlaces, numero_antes, cadena_antes, motivo, quien)
  select gen_random_uuid(), e.account_id, e.company_id, 'asiento', e.id, to_jsonb(e),
         (select coalesce(jsonb_agg(to_jsonb(l) order by l.position), '[]') from public.journal_line l where l.entry_id = e.id),
         '[]'::jsonb, '[]'::jsonb,
         jsonb_build_object('factura_pago', (select coalesce(jsonb_agg(s.id), '[]') from public.supplier_invoice s where s.payment_entry_id = e.id),
                            'actividad', (select coalesce(jsonb_agg(a.id), '[]') from public.document_activity a where a.journal_entry_id = e.id)),
         e.number, jsonb_build_object('chain_seq', e.chain_seq, 'prev_hash', e.prev_hash, 'hash', e.hash),
         p_motivo, public.conta_nombre_actor();
  update public.supplier_invoice set payment_entry_id = null, updated_at = now() where payment_entry_id = e.id;
  update public.document_activity set journal_entry_id = null where journal_entry_id = e.id;
  perform set_config('folvy.asiento_quitar', e.id::text, true);
  delete from public.journal_entry where id = e.id;   -- sus líneas, en cascada
  perform set_config('folvy.asiento_quitar', '', true);
end $$;
revoke all on function public._bank_asiento_quitar(uuid, text) from public, anon, authenticated, service_role;
comment on function public._bank_asiento_quitar(uuid, text) is
  'R08 · Quita del diario un asiento validado de Bancos al deshacerlo, solo si es el último de su serie y de la cadena y no ha salido a ningún sitio (_bank_asiento_razon_contra): no deja hueco. Con su respaldo en conta_asiento_borrado.';

-- ── 2 · Deshacer ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.bank_deshacer(p_match uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_b public.bank_match; v_e public.journal_entry; v_que text; v_otros uuid[]; i record; v_porque text; v_quitar boolean := false;
begin
  select * into v_b from public.bank_match where id = p_match for update;
  if v_b.id is null then raise exception 'Ese movimiento ya no está conciliado: vuelve a cargar.' using errcode = 'P0002'; end if;
  perform public._bank_cuenta_de_empresa(v_b.company_id);
  if v_b.status <> 'vivo' then raise exception 'Este movimiento ya está deshecho: vuelve a cargar.' using errcode = '23514'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Para deshacer hay que decir por qué.' using errcode = '23514'; end if;
  -- Un traspaso se deshace por los dos lados.
  select array_agg(id) into v_otros from public.bank_match where status = 'vivo' and kind = 'traspaso' and journal_entry_id = v_b.journal_entry_id and v_b.kind = 'traspaso';
  v_otros := coalesce(v_otros, array[v_b.id]);
  select * into v_e from public.journal_entry where id = v_b.journal_entry_id;
  if v_e.id is not null and (v_b.entry_created or v_b.kind = 'traspaso') and exists (select 1 from public.bank_match where id = any(v_otros) and entry_created) then
    if v_e.status in ('propuesto', 'borrador') then
      delete from public.journal_entry where id = v_e.id;  -- una propuesta no deja rastro en el libro; su rastro es este casado deshecho
      v_que := 'su asiento propuesto se quita';
    elsif v_e.status = 'validado' then
      -- R08 (Julio, 19/11): se QUITA del diario si se puede sin hueco ni nada fuera; si no, contraasiento, y se dice por qué.
      v_porque := public._bank_asiento_razon_contra(v_e.id);
      if v_porque is null then
        v_quitar := true;
      else
        perform public.journal_entry_anular(v_e.id, 'Deshecho en Bancos: ' || trim(p_motivo), current_date, public.conta_nombre_actor());
        v_que := format('su asiento %s/%s se anula con un contraasiento: %s', v_e.series, v_e.number, v_porque);
      end if;
    end if;
  else
    v_que := 'el asiento enlazado se queda como estaba';
  end if;
  update public.bank_match set status = 'deshecho', undone_at = now(), undone_by = auth.uid(), undone_by_name = public.conta_nombre_actor(),
         undo_reason = trim(p_motivo) where id = any(v_otros);
  update public.bank_movement set status = 'pendiente', confidence = null, reason = null, proposal = null, updated_at = now()
   where id in (select movement_id from public.bank_match where id = any(v_otros));
  -- Lo que se puso fuera del banco por este casado, se quita.
  for i in select it.* from public.bank_match_item it where it.match_id = any(v_otros) loop
    if i.supplier_invoice_id is not null then
      if i.marked_by_bank and exists (select 1 from public.supplier_invoice where id = i.supplier_invoice_id and status = 'pagada') then
        perform public.unmark_supplier_invoice_paid(i.supplier_invoice_id);
      end if;
      update public.supplier_invoice set payment_entry_id = null where id = i.supplier_invoice_id and payment_entry_id = v_b.journal_entry_id;
    elsif i.channel_settlement_id is not null and i.marked_by_bank then
      perform public.channel_settlement_uncollect(i.channel_settlement_id);
    end if;
  end loop;
  -- R08 · Con el casado ya deshecho y lo de fuera quitado, el asiento validado sale del diario.
  if v_quitar then
    perform public._bank_asiento_quitar(v_e.id, 'Deshecho en Bancos: ' || trim(p_motivo));
    v_que := format('su asiento %s/%s se quita del diario', v_e.series, v_e.number);
  end if;
  perform public._bank_log(v_b.account_id, v_b.company_id, v_b.movement_id, v_b.id, null, 'deshecho', 'persona',
    'Deshecho: ' || trim(p_motivo) || ' (' || v_que || ')', jsonb_build_object('asiento', v_b.journal_entry_id));
  return jsonb_build_object('deshechos', to_jsonb(v_otros), 'asiento', v_que);
end $function$;
grant execute on function public.bank_deshacer(uuid, text) to authenticated;
