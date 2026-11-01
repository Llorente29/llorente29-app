-- supabase/migrations/20261101T1731_s01o_plataforma_apunta_sola.sql
--
-- S01o · Lo que Sumied sabe al 100 % se apunta solo (Julio, 01/11): las
-- facturas de comisión de las plataformas, en el SERVIDOR. Hoy la propuesta de
-- una factura recibida la hace la pantalla al abrirla: ninguna de las 172 de
-- plataformas de Foodint tenía asiento, ni propuesto.
--
-- «Seguro al 100 %» para una factura de plataforma, cada condición comprobable:
--   · el proveedor es una plataforma con subcuenta y cuenta de gasto en su ficha
--     (solo de la ficha: lo aprendido es «probable», no «seguro»); si la ficha
--     tiene también cuenta de publicidad, la factura va a una u otra por sus
--     líneas, y si mezcla las dos se queda: «No sé si es comisión o publicidad»;
--   · tiene número y fecha, y no hay otra con el mismo número del mismo proveedor;
--   · base + IVA = total, y el IVA es el 21 % de la base (el tipo de la ficha);
--   · un CARGO va ligado a la liquidación que lleva su número (o, si la
--     liquidación no trae número —Uber—, ligado y cuadrando al céntimo), y el
--     local sale de esa liquidación. El total puede diferir de lo que el Excel
--     llama comisión en 1–2 céntimos o en la tarifa recurrente de la factura
--     (manda el PDF: decisión 1 de Julio); cualquier otra diferencia, no;
--   · un ABONO (total negativo) se apunta aunque no esté ligado: es un gasto
--     negativo de la plataforma y su asiento no depende de la liquidación.
-- El asiento: la cuenta de gasto de su ficha al debe por la base, el 472 del
-- 21 % por el IVA y la subcuenta del proveedor al haber por el total (un abono,
-- al revés), con el local de la liquidación; validado por «Folvy (apunta solo ·
-- plataforma)». Después, pagada por compensación con su liquidación (S01h).
-- Lo que no cumple se queda en «Por revisar» con su motivo en una frase.
--
-- Solo añade: una tabla (el porqué de cada factura), funciones nuevas y la
-- pasada cada media hora. Nada se apunta si la empresa tiene apagado «Apuntar
-- solo lo que Sumied tiene seguro» (company_purchase_setting.post_safe_invoices).
-- Vuelta atrás: supabase/vuelta-atras/20261101T1731_s01o_plataforma_apunta_sola.down.sql

create table if not exists public.supplier_invoice_auto (
  invoice_id uuid primary key references public.supplier_invoice(id) on delete cascade,
  account_id uuid not null,
  company_id uuid,
  estado text not null check (estado in ('apuntada', 'no', 'deshecha')),
  regla text,
  porque text,
  entry_id uuid,
  at timestamptz not null default now()
);
create index if not exists supplier_invoice_auto_cuenta on public.supplier_invoice_auto (account_id, estado);
alter table public.supplier_invoice_auto enable row level security;
drop policy if exists supplier_invoice_auto_leer on public.supplier_invoice_auto;
create policy supplier_invoice_auto_leer on public.supplier_invoice_auto for select to authenticated using (public.belongs_to_account(account_id));
revoke insert, update, delete on public.supplier_invoice_auto from anon, authenticated;
grant select on public.supplier_invoice_auto to authenticated;

-- La regla: si la factura de plataforma está segura al 100 %, y con qué; si no, por qué (una frase).
create or replace function public._conta_plataforma_seguro(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v public.supplier_invoice; d jsonb; v_canal uuid; v_plat text; v_party uuid; v_prov text; v_gasto text; v_iva_tipo uuid; v_iva_cta text;
  cs public.channel_settlement; v_local uuid; v_num text; v_num_liq text; v_ref numeric; v_dif numeric; v_tarifa numeric := 0;
  v_ligadas numeric; v_dt text; v_por text; v_publi text; v_n_lin int := 0; v_n_pub int := 0; v_tipo text := 'comision';
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null then return jsonb_build_object('seguro', false, 'motivo', 'No está.'); end if;
  if v.status not in ('en_revision', 'aprobada') then return jsonb_build_object('seguro', false, 'motivo', 'Ya no está por revisar.'); end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v.account_id and e.source_type = 'supplier_invoice' and e.source_id = v.id and e.status in ('propuesto', 'borrador', 'validado')) then
    return jsonb_build_object('seguro', false, 'motivo', 'Ya tiene su asiento.');
  end if;
  d := public._conta_comision_datos(v.id);
  v_canal := nullif(d->>'canal', '')::uuid;
  if v_canal is null then return jsonb_build_object('seguro', false, 'motivo', 'No es de una plataforma.'); end if;
  select sc.name into v_plat from public.sales_channel sc where sc.id = v_canal and sc.account_id = v.account_id;
  v_plat := case v_plat when 'JustEat' then 'Just Eat' when 'UberEats' then 'Uber' else v_plat end;  -- su nombre para leer
  if v.invoice_number is null or v.invoice_date is null then return jsonb_build_object('seguro', false, 'motivo', 'Le falta el número o la fecha.'); end if;
  v_num := upper(regexp_replace(v.invoice_number, '[^A-Za-z0-9]', '', 'g'));
  if exists (select 1 from public.supplier_invoice o where o.account_id = v.account_id and o.id <> v.id and o.supplier_id = v.supplier_id
              and o.status not in ('anulada', 'descartada') and upper(regexp_replace(coalesce(o.invoice_number, ''), '[^A-Za-z0-9]', '', 'g')) = v_num) then
    return jsonb_build_object('seguro', false, 'motivo', 'Hay otra factura suya con el mismo número.');
  end if;
  -- La ficha: subcuenta, cuenta de gasto y tercero.
  select a.code into v_prov from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.account_id = v.account_id and k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = v.supplier_id::text and k.role = 'principal' limit 1;
  select a.code into v_gasto from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.account_id = v.account_id and k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = v.supplier_id::text and k.role = 'gasto' limit 1;
  select pr.party_id into v_party from public.party_role pr where pr.account_id = v.account_id and pr.role = 'supplier' and pr.supplier_id = v.supplier_id limit 1;
  if v_prov is null then return jsonb_build_object('seguro', false, 'motivo', format('Falta la subcuenta en la ficha de %s.', coalesce(v_plat, 'la plataforma')), 'falta_ficha', true); end if;
  -- La cuenta de gasto: SOLO la de su ficha (Julio, 01/11: «probable» no es «seguro»). Si la ficha tiene
  -- también cuenta de publicidad, la factura va a una u otra por sus líneas; si mezcla las dos, no se adivina.
  select a.code into v_publi from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.account_id = v.account_id and k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = v.supplier_id::text and k.role = 'publicidad' limit 1;
  if v_gasto is null then
    return jsonb_build_object('seguro', false, 'motivo', format('Falta la cuenta de gasto en la ficha de %s.', coalesce(v_plat, 'la plataforma')), 'falta_ficha', true);
  end if;
  if v_publi is not null then
    select count(*), count(*) filter (where l.raw_text ~* 'publicitari|publicidad|\mads\M|marketing') into v_n_lin, v_n_pub
      from public.supplier_invoice_line l where l.supplier_invoice_id = v.id;
    if v_n_lin > 0 and v_n_pub = v_n_lin then v_gasto := v_publi; v_tipo := 'publicidad';
    elsif v_n_pub > 0 or v_n_lin = 0 then
      return jsonb_build_object('seguro', false, 'motivo', 'No sé si es comisión o publicidad.');
    end if;
  end if;
  -- Los importes: base + IVA = total y el IVA es el 21 %.
  if v.grand_total is null or v.tax_base_total is null or v.tax_total is null
     or abs(v.tax_base_total + v.tax_total - v.grand_total) > 0.01 then
    return jsonb_build_object('seguro', false, 'motivo', 'La base más el IVA no da el total.');
  end if;
  if abs(round(v.tax_base_total * 0.21, 2) - v.tax_total) > 0.01 then
    return jsonb_build_object('seguro', false, 'motivo', 'Su IVA no es el 21 % de la base.');
  end if;
  select t.id into v_iva_tipo from public.tax_rate t
   where t.tax_system = 'iva' and t.code like 'iva\_%' and t.rate = 21 and t.valid_to is null and (t.is_system or t.account_id = v.account_id)
   order by (t.account_id = v.account_id) desc nulls last limit 1;
  select a.code into v_iva_cta from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.company_id = v.company_id and k.entity = 'tax_rate' and k.entity_id = v_iva_tipo::text and k.role = 'soportado' limit 1;
  if v_iva_cta is null then return jsonb_build_object('seguro', false, 'motivo', 'La empresa no tiene la cuenta del IVA soportado al 21 %.'); end if;

  select c.* into cs from public.channel_settlement_invoice k join public.channel_settlement c on c.id = k.settlement_id
   where k.supplier_invoice_id = v.id and k.account_id = v.account_id;
  if v.grand_total < 0 then
    -- Un abono: se apunta ligado o no. Con su liquidación, su local.
    if cs.id is not null then
      select coalesce(cs.location_id, ps.location_id) into v_local from public.platform_store ps where ps.id = cs.store_id;
      v_local := coalesce(v_local, cs.location_id);
    end if;
    v_por := format('Abono de %s: un gasto negativo de la plataforma.%s', v_plat,
                    case when cs.id is null then ' Sin liquidación ligada.' else format(' Ligado a su liquidación del %s.', public._conta_s01o_periodo(cs.period_from, cs.period_to)) end);
    return jsonb_build_object('seguro', true, 'regla', 'abono', 'porque', v_por, 'liquidacion', cs.id, 'local', v_local,
      'proveedor', v_prov, 'gasto', v_gasto, 'tipo', v_tipo, 'iva_tipo', v_iva_tipo, 'iva_cuenta', v_iva_cta, 'tercero', v_party, 'plataforma', v_plat);
  end if;
  if cs.id is null then return jsonb_build_object('seguro', false, 'motivo', 'No está ligada a su liquidación.'); end if;
  select coalesce(cs.location_id, ps.location_id) into v_local from public.platform_store ps where ps.id = cs.store_id;
  v_local := coalesce(v_local, cs.location_id);
  if v_local is null then return jsonb_build_object('seguro', false, 'motivo', 'Su liquidación no dice de qué local es.'); end if;
  v_num_liq := upper(regexp_replace(coalesce(cs.raw->'factura'->>'numero', cs.settlement_ref, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_num_liq <> '' and v_num_liq <> v_num then
    return jsonb_build_object('seguro', false, 'motivo', 'Está ligada a la liquidación de otra factura.');
  end if;
  if v_num_liq = '' then
    -- Sin número en la liquidación (Uber): ligada y cuadrando al céntimo con lo que factura.
    select coalesce(sum(si.grand_total), 0) into v_ligadas from public.channel_settlement_invoice k join public.supplier_invoice si on si.id = k.supplier_invoice_id
     where k.settlement_id = cs.id and k.account_id = v.account_id and si.status not in ('anulada', 'descartada');
    if cs.commission is null or abs(v_ligadas - abs(cs.commission)) >= 0.005 then
      return jsonb_build_object('seguro', false, 'motivo', 'Su liquidación no trae su número y no cuadra al céntimo con lo que factura.');
    end if;
    v_dt := 'cuadra al céntimo';
  else
    v_ref := nullif(cs.raw->'factura'->>'total', '')::numeric;
    if v_ref is null then v_ref := abs(cs.commission); end if;
    v_dif := round(v.grand_total - v_ref, 2);
    select coalesce(round(sum(l.line_amount * (1 + coalesce(l.vat_pct, 21) / 100.0)), 2), 0) into v_tarifa
      from public.supplier_invoice_line l where l.supplier_invoice_id = v.id and l.raw_text ~* 'tarifa recurrente';
    if abs(v_dif) <= 0.02 then
      v_dt := case when v_dif = 0 then 'cuadra al céntimo' else format('difiere en %s céntimo%s de redondeo', abs(v_dif * 100)::int, case when abs(v_dif * 100) = 1 then '' else 's' end) end;
    elsif v_tarifa > 0 and abs(v_dif - v_tarifa) <= 0.02 then
      v_dt := format('la factura incluye la tarifa recurrente (%s), que el Excel no cuenta como comisión', public.conta_euros_exactos(v_tarifa));
    else
      return jsonb_build_object('seguro', false, 'motivo', format('La factura y su liquidación difieren en %s y no es la tarifa recurrente.', public.conta_euros_exactos(v_dif)));
    end if;
  end if;
  v_por := format('Factura %s de su liquidación del %s de %s (mismo número); %s.', case when v_tipo = 'publicidad' then 'de publicidad de ' else 'de ' end || v_plat, public._conta_s01o_periodo(cs.period_from, cs.period_to),
                  coalesce((select l.name from public.locations l where l.id = v_local and l.account_id = v.account_id), 'su local'), v_dt);
  if v_num_liq = '' then
    v_por := format('Factura %s ligada a su liquidación del %s de %s; %s.', case when v_tipo = 'publicidad' then 'de publicidad de ' else 'de ' end || v_plat, public._conta_s01o_periodo(cs.period_from, cs.period_to),
                    coalesce((select l.name from public.locations l where l.id = v_local and l.account_id = v.account_id), 'su local'), v_dt);
  end if;
  return jsonb_build_object('seguro', true, 'regla', 'plataforma', 'porque', v_por, 'liquidacion', cs.id, 'local', v_local,
    'proveedor', v_prov, 'gasto', v_gasto, 'tipo', v_tipo, 'iva_tipo', v_iva_tipo, 'iva_cuenta', v_iva_cta, 'tercero', v_party, 'plataforma', v_plat);
end $$;
revoke all on function public._conta_plataforma_seguro(uuid) from public, anon, authenticated;

-- «1–15/10» (o «16/09–15/10»).
create or replace function public._conta_s01o_periodo(p_desde date, p_hasta date)
returns text language sql immutable as $$
  select case when p_desde is null or p_hasta is null then 'sin periodo'
              when to_char(p_desde, 'MM') = to_char(p_hasta, 'MM') then extract(day from p_desde)::int || '–' || extract(day from p_hasta)::int || '/' || to_char(p_hasta, 'MM')
              else to_char(p_desde, 'DD/MM') || '–' || to_char(p_hasta, 'DD/MM') end
$$;

-- Apunta sola una factura de plataforma segura al 100 %; si no lo está, deja su motivo.
create or replace function public._conta_plataforma_apuntar(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v public.supplier_invoice; s jsonb; v_quien constant text := 'Folvy (apunta solo · plataforma)'; v_res jsonb; v_entry uuid;
  v_abono boolean; v_base numeric; v_iva numeric; v_total numeric; v_concepto text; v_lineas jsonb;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null then return jsonb_build_object('apuntada', false, 'motivo', 'No está.'); end if;
  if not coalesce((select ps.post_safe_invoices from public.company_purchase_setting ps where ps.company_id = v.company_id), false) then
    return jsonb_build_object('apuntada', false, 'motivo', 'La empresa tiene apagado «Apuntar solo lo que Sumied tiene seguro».');
  end if;
  s := public._conta_plataforma_seguro(v.id);
  if not coalesce((s->>'seguro')::boolean, false) then
    if s->>'motivo' not in ('No es de una plataforma.', 'Ya tiene su asiento.', 'Ya no está por revisar.') then
      insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, porque)
      values (v.id, v.account_id, v.company_id, 'no', s->>'motivo')
      on conflict (invoice_id) do update set estado = case when supplier_invoice_auto.estado = 'deshecha' then 'deshecha' else 'no' end,
        porque = case when supplier_invoice_auto.estado = 'deshecha' then supplier_invoice_auto.porque else excluded.porque end, at = now();
    end if;
    return jsonb_build_object('apuntada', false, 'motivo', s->>'motivo');
  end if;
  -- Deshecha por una persona: no se vuelve a apuntar sola.
  if exists (select 1 from public.supplier_invoice_auto a where a.invoice_id = v.id and a.estado = 'deshecha') then
    return jsonb_build_object('apuntada', false, 'motivo', 'Una persona la devolvió a «Por revisar»: no se apunta sola otra vez.');
  end if;
  v_abono := v.grand_total < 0;
  v_base := abs(v.tax_base_total); v_iva := abs(v.tax_total); v_total := abs(v.grand_total);
  v_concepto := format('%s %s · %s', case when v_abono then 'Abono' else 'Factura' end,
                       coalesce((select su.name from public.supplier su where su.id = v.supplier_id), s->>'plataforma'), v.invoice_number);
  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta', s->>'gasto', 'debe', case when v_abono then 0 else v_base end, 'haber', case when v_abono then v_base else 0 end,
                       'concepto', null, 'local_id', s->>'local', 'comun', false, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null),
    jsonb_build_object('cuenta', s->>'iva_cuenta', 'debe', case when v_abono then 0 else v_iva end, 'haber', case when v_abono then v_iva else 0 end,
                       'concepto', null, 'local_id', s->>'local', 'comun', false, 'tercero_id', null, 'documento', null,
                       'iva', jsonb_build_object('tipo_id', s->>'iva_tipo', 'base', v_base, 'libro', 'received', 'deducible', 'yes', 'facturas', 1), 'retencion', null),
    jsonb_build_object('cuenta', s->>'proveedor', 'debe', case when v_abono then v_total else 0 end, 'haber', case when v_abono then 0 else v_total end,
                       'concepto', null, 'local_id', s->>'local', 'comun', false, 'tercero_id', s->>'tercero', 'documento', v.invoice_number, 'iva', null, 'retencion', null));
  begin
    if v.status = 'en_revision' then
      update public.supplier_invoice set status = 'aprobada', approved_at = now(), approved_by = null, approved_by_name = v_quien, updated_at = now() where id = v.id;
    end if;
    v_res := public._journal_entry_proponer(v.company_id,
      jsonb_build_object('series', 2, 'fecha', v.invoice_date, 'concepto', v_concepto, 'source_type', 'supplier_invoice', 'source_id', v.id,
                         'confianza', 'seguro', 'porque', s->>'porque', 'razones', jsonb_build_array(jsonb_build_object('decision', 'Apuntada sola', 'porque', s->>'porque')),
                         'party_id', s->>'tercero', 'documento', v.invoice_number),
      v_lineas, null, v_quien, null);
    v_entry := nullif(v_res->>'id', '')::uuid;
    if v_entry is null then raise exception 'no ha salido su asiento (%).', v_res; end if;
    perform public._journal_entry_validar(v_entry, v_quien);
    update public.supplier_invoice set payment_method = 'compensation', updated_at = now() where id = v.id and payment_method is distinct from 'compensation';
    perform public._conta_comision_pagar(v.id);
  exception when others then
    -- Lo que no sale, no se calla: vuelve como estaba (este bloque se deshace entero) y quien la pasa apunta su motivo (regla 8).
    raise exception using message = 'S01O_NO_SALE: ' || sqlerrm;
  end;
  insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, regla, porque, entry_id)
  values (v.id, v.account_id, v.company_id, 'apuntada', s->>'regla', s->>'porque', v_entry)
  on conflict (invoice_id) do update set estado = 'apuntada', regla = excluded.regla, porque = excluded.porque, entry_id = excluded.entry_id, at = now();
  return jsonb_build_object('apuntada', true, 'porque', s->>'porque', 'asiento', v_entry);
end $$;
revoke all on function public._conta_plataforma_apuntar(uuid) from public, anon, authenticated;

-- La pasada de una empresa: cada factura de plataforma por revisar, una a una (lo que falla en una no para las demás).
create or replace function public._conta_plataformas_apuntar(p_company uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; r jsonb; v_si int := 0; v_no int := 0; v_motivos jsonb := '{}'::jsonb; v_m text;
begin
  for v_id in
    select si.id from public.supplier_invoice si
      join public.party_role ps on ps.account_id = si.account_id and ps.role = 'supplier' and ps.supplier_id = si.supplier_id
      join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
     where si.company_id = p_company and si.status in ('en_revision', 'aprobada')
       and not exists (select 1 from public.journal_entry e where e.account_id = si.account_id and e.source_type = 'supplier_invoice' and e.source_id = si.id and e.status in ('propuesto', 'borrador', 'validado'))
     order by si.invoice_date, si.id
  loop
    begin
      perform public._conta_comision_buscar(v_id);
      r := public._conta_plataforma_apuntar(v_id);
    exception when others then
      r := jsonb_build_object('apuntada', false, 'motivo', 'No ha salido su asiento: ' || regexp_replace(sqlerrm, '^S01O_NO_SALE: ', ''));
      insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, porque)
      select v_id, si.account_id, si.company_id, 'no', r->>'motivo' from public.supplier_invoice si where si.id = v_id
      on conflict (invoice_id) do update set porque = excluded.porque, at = now() where supplier_invoice_auto.estado <> 'deshecha';
    end;
    if (r->>'apuntada')::boolean then v_si := v_si + 1;
    else
      v_no := v_no + 1; v_m := coalesce(r->>'motivo', 'sin motivo');
      v_motivos := jsonb_set(v_motivos, array[v_m], to_jsonb(coalesce((v_motivos->>v_m)::int, 0) + 1));
    end if;
  end loop;
  return jsonb_build_object('apuntadas', v_si, 'quedan', v_no, 'motivos', v_motivos);
end $$;
revoke all on function public._conta_plataformas_apuntar(uuid) from public, anon, authenticated;

-- Para la pantalla: las apuntadas solas de la empresa (con su porqué) y cuántas esta semana.
create or replace function public.conta_apuntadas_solas(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no es tuya.' using errcode = '42501'; end if;
  return jsonb_build_object(
    'semana', (select count(*) from public.supplier_invoice_auto a where a.account_id = v_acc and a.company_id = p_company and a.estado = 'apuntada' and a.at >= now() - interval '7 days'),
    'filas', coalesce((select jsonb_agg(jsonb_build_object('id', a.invoice_id, 'porque', a.porque, 'regla', a.regla, 'asiento', a.entry_id, 'at', a.at) order by a.at desc)
                         from public.supplier_invoice_auto a where a.account_id = v_acc and a.company_id = p_company and a.estado = 'apuntada'), '[]'::jsonb),
    'motivos', coalesce((select jsonb_object_agg(a.invoice_id, a.porque) from public.supplier_invoice_auto a where a.account_id = v_acc and a.company_id = p_company and a.estado in ('no', 'deshecha')), '{}'::jsonb));
end $$;
revoke all on function public.conta_apuntadas_solas(uuid) from public, anon;
grant execute on function public.conta_apuntadas_solas(uuid) to authenticated;

-- «Deshacer»: la vuelve a «Por revisar». El asiento validado no se toca (es inalterable): se anula con su contraasiento.
create or replace function public.conta_apuntada_sola_deshacer(p_invoice uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v public.supplier_invoice; a public.supplier_invoice_auto; v_quien text;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null or not public.belongs_to_account(v.account_id) then raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501'; end if;
  -- Anular un asiento validado es de administrador (journal_entry_anular): deshacer, también.
  if not public.current_user_is_admin_of(v.account_id) then raise exception 'Solo un administrador deshace lo apuntado solo.' using errcode = '42501'; end if;
  select * into a from public.supplier_invoice_auto where invoice_id = v.id and estado = 'apuntada';
  if a.invoice_id is null then raise exception 'Esta factura no la apuntó Sumied sola.' using errcode = '22023'; end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  perform public.journal_entry_anular(a.entry_id, 'Deshecho lo apuntado solo por Sumied', current_date, v_quien);
  delete from public.supplier_invoice_payment where invoice_id = v.id and account_id = v.account_id and method = 'compensation' and created_by_name = 'Sumied · compensada con la liquidación';
  if v.paid_at is not null then
    insert into public.supplier_invoice_payment_log (account_id, invoice_id, action, paid_at, paid_method, actor_name)
    values (v.account_id, v.id, 'unpaid', v.paid_at, v.paid_method, v_quien);
  end if;
  update public.supplier_invoice set status = 'en_revision', paid_at = null, paid_method = null, paid_by_name = null, approved_at = null, approved_by_name = null, updated_at = now() where id = v.id;
  update public.supplier_invoice_auto set estado = 'deshecha', porque = format('Devuelta a «Por revisar» por %s.', v_quien), at = now() where invoice_id = v.id;
  return jsonb_build_object('texto', format('Devuelta a «Por revisar»: %s. Su asiento queda anulado con su contraasiento.', coalesce(v.invoice_number, 'la factura')));
end $$;
revoke all on function public.conta_apuntada_sola_deshacer(uuid, text) from public, anon;
grant execute on function public.conta_apuntada_sola_deshacer(uuid, text) to authenticated;

-- La pasada de todas las empresas con el interruptor encendido, cada media hora.
create or replace function public._conta_plataformas_apuntar_todas()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_e uuid; v_mal text[] := '{}';
begin
  for v_e in select company_id from public.company_purchase_setting where post_safe_invoices loop
    begin perform public._conta_plataformas_apuntar(v_e);
    exception when others then v_mal := v_mal || format('%s: %s', v_e, sqlerrm); end;
  end loop;
  -- Las demás empresas ya han pasado; esto solo hace que cron la cuente como fallida (un warning lo cuenta como éxito: regla 8).
  if cardinality(v_mal) > 0 then raise exception 'S01o: la pasada ha fallado en %', array_to_string(v_mal, ' · '); end if;
end $$;
revoke all on function public._conta_plataformas_apuntar_todas() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 's01o-apunta-solo') then perform cron.unschedule('s01o-apunta-solo'); end if;
    perform cron.schedule('s01o-apunta-solo', '7,37 * * * *', 'select public._conta_plataformas_apuntar_todas()');
  end if;
end $$;
