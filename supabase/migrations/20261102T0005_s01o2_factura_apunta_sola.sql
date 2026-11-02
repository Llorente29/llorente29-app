-- supabase/migrations/20261102T0005_s01o2_factura_apunta_sola.sql
--
-- S01o·2 · Las demás facturas con la ficha completa se apuntan solas, con el mismo
-- principio que las de plataforma (S01o, 1731): si están seguras al 100 %, sin más
-- filtros; si no, se quedan en «Por revisar» con su motivo en una frase.
-- Julio, 01/11, respuesta 6, decisión 5. «Segura», fuera de plataforma, es TODO esto:
--   · tiene proveedor, número y fecha, y no hay otra suya con el mismo número;
--   · su ficha tiene subcuenta y cuenta de gasto (no vale lo aprendido);
--   · el NIF de su ficha es el NIF leído (con la misma clave, 2210);
--   · la lectura es segura; si no, el motivo dice qué comprobación falló;
--   · sus líneas de IVA suman su base y su IVA, y base + IVA = total; cada tipo
--     con su 472 (si su IVA se deduce);
--   · sin retención;
--   · el destinatario es la empresa o, si no viene a su nombre (o es de un
--     proveedor de la UE sin ROI), su IVA va al gasto como no deducible y el
--     motivo lo dice; sin contestar si la empresa está en el ROI, no es segura;
--   · el local: el de la factura, el de su recepción o, para un servicio, el
--     local por defecto de la ficha; si la empresa pide local y no lo hay, no;
--   · si el proveedor entrega mercancía (2211): casada con su albarán, sin
--     diferencia y sin líneas sin leer.
-- El asiento: el gasto de su ficha al debe por la base (y por la cuota si no se
-- deduce), cada 472 por su cuota, y la subcuenta al haber por el total; validado
-- por «Folvy (apunta solo · factura)». No se paga: se paga por el banco.
--
-- Solo añade: funciones nuevas y su pasada (cron «s01o2-apunta-solo», a las 9 y
-- las 39). Usa la tabla y la pantalla del S01o (supplier_invoice_auto, «Apuntadas
-- solas», «Deshacer») y el mismo interruptor. Vuelta atrás: su .down.sql.

create or replace function public._conta_factura_segura(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v public.supplier_invoice; s public.supplier; v_prov text; v_gasto text; v_party uuid; v_local uuid; v_nd boolean; v_nd_r jsonb;
  v_base numeric; v_iva numeric; v_lineas jsonb := '[]'::jsonb; t record; v_tipo uuid; v_472 text; v_falla text; v_casa jsonb;
  v_quien text; v_por text; v_ded text;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null then return jsonb_build_object('seguro', false, 'motivo', 'No está.'); end if;
  if v.status not in ('en_revision', 'aprobada') then return jsonb_build_object('seguro', false, 'motivo', 'Ya no está por revisar.'); end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v.account_id and e.source_type = 'supplier_invoice' and e.source_id = v.id and e.status in ('propuesto', 'borrador', 'validado')) then
    return jsonb_build_object('seguro', false, 'motivo', 'Ya tiene su asiento.');
  end if;
  if public._conta_comision_datos(v.id)->>'canal' is not null then return jsonb_build_object('seguro', false, 'motivo', 'Es de una plataforma.'); end if;
  if v.supplier_id is null then return jsonb_build_object('seguro', false, 'motivo', 'No sé de quién es: falta su proveedor.'); end if;
  select * into s from public.supplier where id = v.supplier_id and account_id = v.account_id;
  v_quien := coalesce(s.name, 'el proveedor');
  if v.invoice_number is null or v.invoice_date is null then return jsonb_build_object('seguro', false, 'motivo', 'Le falta el número o la fecha.'); end if;
  if exists (select 1 from public.supplier_invoice o where o.account_id = v.account_id and o.id <> v.id and o.supplier_id = v.supplier_id
              and o.status not in ('anulada', 'descartada')
              and public.conta_clave_numero(o.invoice_number) = public.conta_clave_numero(v.invoice_number)) then
    return jsonb_build_object('seguro', false, 'motivo', 'Hay otra factura suya con el mismo número.');
  end if;
  -- La ficha.
  select a.code into v_prov from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.account_id = v.account_id and k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = s.id::text and k.role = 'principal' limit 1;
  if v_prov is null then return jsonb_build_object('seguro', false, 'motivo', format('Falta la subcuenta en la ficha de %s.', v_quien)); end if;
  select a.code into v_gasto from public.company_account_link k join public.company_account a on a.id = k.company_account_id
   where k.account_id = v.account_id and k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = s.id::text and k.role = 'gasto' limit 1;
  if v_gasto is null then return jsonb_build_object('seguro', false, 'motivo', format('Falta la cuenta de gasto en la ficha de %s.', v_quien)); end if;
  select pr.party_id into v_party from public.party_role pr where pr.account_id = v.account_id and pr.role = 'supplier' and pr.supplier_id = s.id limit 1;
  if v.reading ? 'factura' and public._conta_nif_clave(v.reading->'factura'->'proveedor'->>'nif') is distinct from public._conta_nif_clave(s.tax_id) then
    return jsonb_build_object('seguro', false, 'motivo', format('El NIF de la factura no es el de la ficha de %s.', v_quien));
  end if;
  -- La lectura: si no es segura, qué dudó.
  if coalesce(v.reading_confidence, '') <> 'seguro' then
    select string_agg(c->>'texto', ' ') into v_falla from jsonb_array_elements(coalesce(v.reading->'comprobaciones', '[]'::jsonb)) c
     where not coalesce((c->>'ok')::boolean, true);
    return jsonb_build_object('seguro', false, 'motivo', 'La lectura dudó: ' || coalesce(v_falla,
      case when v.reading->>'confianza' = 'seguro' then 'no conocía al proveedor cuando la leyó; léela otra vez o revísala.' else 'no lo dice; revísala.' end));
  end if;
  -- Sin retención.
  if coalesce(v.withholding_amount, 0) <> 0 or v.withholding_rate_id is not null then
    return jsonb_build_object('seguro', false, 'motivo', 'Lleva retención: la mira una persona.');
  end if;
  -- El IVA: las líneas suman la factura.
  select coalesce(sum(x.base), 0), coalesce(sum(x.vat_amount), 0) into v_base, v_iva from public.supplier_invoice_tax x where x.supplier_invoice_id = v.id;
  if v.grand_total is null or v.tax_base_total is null or v.tax_total is null
     or abs(v_base - v.tax_base_total) > 0.01 or abs(v_iva - v.tax_total) > 0.01 or abs(v.tax_base_total + v.tax_total - v.grand_total) > 0.01 then
    return jsonb_build_object('seguro', false, 'motivo', 'Sus líneas de IVA no suman la base y el IVA de la factura.');
  end if;
  -- ¿Se deduce su IVA? (2212: no a nombre de la empresa, o de la UE sin ROI).
  v_nd_r := public._conta_iva_no_deducible_auto(v.id);
  if coalesce((v_nd_r->>'falta_roi')::boolean, false) then
    return jsonb_build_object('seguro', false, 'motivo', 'Es de un proveedor de la UE que cobra IVA español: falta saber si estás en el ROI (Ajustes › Tus impuestos).');
  end if;
  v_nd := coalesce(v.vat_non_deductible, false) or coalesce((v_nd_r->>'no_deducible')::boolean, false);
  v_ded := case when v_nd then 'no' else 'yes' end;
  for t in select x.vat_pct, x.base, x.vat_amount from public.supplier_invoice_tax x where x.supplier_invoice_id = v.id order by x.vat_pct loop
    v_tipo := null; v_472 := null;
    if coalesce(t.vat_pct, 0) > 0 then
      select r.id into v_tipo from public.tax_rate r
       where r.tax_system = 'iva' and r.code like 'iva\_%' and r.rate = t.vat_pct and r.valid_to is null and (r.is_system or r.account_id = v.account_id)
       order by (r.account_id = v.account_id) desc nulls last limit 1;
      if v_tipo is null then return jsonb_build_object('seguro', false, 'motivo', format('No tengo el tipo de IVA del %s %%.', t.vat_pct)); end if;
      if not v_nd then
        select a.code into v_472 from public.company_account_link k join public.company_account a on a.id = k.company_account_id
         where k.company_id = v.company_id and k.entity = 'tax_rate' and k.entity_id = v_tipo::text and k.role = 'soportado' limit 1;
        if v_472 is null then return jsonb_build_object('seguro', false, 'motivo', format('La empresa no tiene la cuenta del IVA soportado al %s %%.', t.vat_pct)); end if;
      end if;
    end if;
    v_lineas := v_lineas || jsonb_build_object('pct', t.vat_pct, 'base', t.base, 'cuota', t.vat_amount, 'tipo', v_tipo, 'cuenta_iva', coalesce(v_472, v_gasto));
  end loop;
  -- El local.
  v_local := coalesce(v.location_id,
    (select g.location_id from public.supplier_invoice_receipt r join public.goods_receipt g on g.id = r.goods_receipt_id where r.supplier_invoice_id = v.id and g.location_id is not null limit 1),
    s.default_location_id);
  if v_local is null and exists (select 1 from public.conta_eje_analitico x where x.company_id = v.company_id and x.account_id = v.account_id and x.eje = 'local' and x.activo) then
    return jsonb_build_object('seguro', false, 'motivo', format('Falta su local en la ficha de %s.', v_quien));
  end if;
  -- Si entrega mercancía: casada con su albarán, sin diferencias.
  if public._conta_entrega_mercancia(s.id) is not false then
    if not exists (select 1 from public.supplier_invoice_receipt r where r.supplier_invoice_id = v.id) then
      return jsonb_build_object('seguro', false, 'motivo', 'Espera su albarán.');
    end if;
    select da.detail into v_casa from public.document_activity da where da.supplier_invoice_id = v.id and da.action = 'casada' order by da.created_at desc limit 1;
    if v_casa is null or abs(coalesce((v_casa->>'diferencia')::numeric, 1)) >= 0.005 or coalesce((v_casa->>'lineas_sin_leer')::numeric, 0) <> 0 then
      return jsonb_build_object('seguro', false, 'motivo', 'No cuadra con su albarán.');
    end if;
  end if;
  v_por := format('Factura de %s con todo en su ficha (gasto %s)%s; %s', v_quien, v_gasto,
    case when public._conta_entrega_mercancia(s.id) is not false then ', casada con su albarán al céntimo' else '' end,
    case when v_nd then coalesce((select string_agg(m->>'texto', ' ') from jsonb_array_elements(v_nd_r->'motivos') m), 'su IVA no se deduce y va al gasto.')
         else 'cuadra al céntimo.' end);
  return jsonb_build_object('seguro', true, 'regla', 'factura', 'porque', v_por, 'proveedor', v_prov, 'gasto', v_gasto, 'tercero', v_party,
    'local', v_local, 'no_deducible', v_nd, 'deducible', v_ded, 'lineas', v_lineas, 'base', v.tax_base_total, 'iva', v.tax_total, 'total', v.grand_total);
end $$;
revoke all on function public._conta_factura_segura(uuid) from public, anon, authenticated;

create or replace function public._conta_factura_apuntar(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v public.supplier_invoice; s jsonb; v_quien constant text := 'Folvy (apunta solo · factura)'; v_res jsonb; v_entry uuid;
  v_lineas jsonb := '[]'::jsonb; l jsonb; v_abono boolean; v_g numeric := 0;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null then return jsonb_build_object('apuntada', false, 'motivo', 'No está.'); end if;
  if not coalesce((select ps.post_safe_invoices from public.company_purchase_setting ps where ps.company_id = v.company_id), false) then
    return jsonb_build_object('apuntada', false, 'motivo', 'La empresa tiene apagado «Apuntar solo lo que Sumied tiene seguro».');
  end if;
  if exists (select 1 from public.supplier_invoice_auto a where a.invoice_id = v.id and a.estado = 'deshecha') then
    return jsonb_build_object('apuntada', false, 'motivo', 'Una persona la devolvió a «Por revisar»: no se apunta sola otra vez.');
  end if;
  s := public._conta_factura_segura(v.id);
  if not coalesce((s->>'seguro')::boolean, false) then
    if s->>'motivo' not in ('Es de una plataforma.', 'Ya tiene su asiento.', 'Ya no está por revisar.', 'No está.') then
      insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, porque)
      values (v.id, v.account_id, v.company_id, 'no', s->>'motivo')
      on conflict (invoice_id) do update set porque = excluded.porque, at = now() where supplier_invoice_auto.estado = 'no';
    end if;
    return jsonb_build_object('apuntada', false, 'motivo', s->>'motivo');
  end if;
  v_abono := v.grand_total < 0;
  -- El gasto por la base (y por la cuota si no se deduce); cada 472 por su cuota; la subcuenta por el total.
  for l in select * from jsonb_array_elements(s->'lineas') loop
    v_g := v_g + abs((l->>'base')::numeric);
    if (l->>'cuota')::numeric <> 0 then
      v_lineas := v_lineas || jsonb_build_object('cuenta', l->>'cuenta_iva',
        'debe', case when v_abono then 0 else abs((l->>'cuota')::numeric) end, 'haber', case when v_abono then abs((l->>'cuota')::numeric) else 0 end,
        'concepto', case when (s->>'no_deducible')::boolean then format('IVA no deducible %s %%', l->>'pct') end,
        'local_id', s->>'local', 'comun', s->>'local' is null, 'tercero_id', null, 'documento', null,
        'iva', jsonb_build_object('tipo_id', l->>'tipo', 'base', abs((l->>'base')::numeric), 'libro', 'received', 'deducible', s->>'deducible', 'facturas', 1), 'retencion', null);
    end if;
  end loop;
  v_lineas := jsonb_build_array(jsonb_build_object('cuenta', s->>'gasto', 'debe', case when v_abono then 0 else v_g end, 'haber', case when v_abono then v_g else 0 end,
      'concepto', null, 'local_id', s->>'local', 'comun', s->>'local' is null, 'tercero_id', null, 'documento', null, 'iva', null, 'retencion', null))
    || v_lineas
    || jsonb_build_array(jsonb_build_object('cuenta', s->>'proveedor', 'debe', case when v_abono then abs(v.grand_total) else 0 end, 'haber', case when v_abono then 0 else abs(v.grand_total) end,
      'concepto', null, 'local_id', s->>'local', 'comun', s->>'local' is null, 'tercero_id', s->>'tercero', 'documento', v.invoice_number, 'iva', null, 'retencion', null));
  begin
    if v.status = 'en_revision' then
      update public.supplier_invoice set status = 'aprobada', approved_at = now(), approved_by = null, approved_by_name = v_quien, updated_at = now() where id = v.id;
    end if;
    if (s->>'no_deducible')::boolean and not coalesce(v.vat_non_deductible, false) then
      update public.supplier_invoice set vat_non_deductible = true, updated_at = now() where id = v.id;
    end if;
    v_res := public._journal_entry_proponer(v.company_id,
      jsonb_build_object('series', 2, 'fecha', v.invoice_date, 'concepto', format('%s %s · %s', case when v_abono then 'Abono' else 'Factura' end,
                           coalesce((select su.name from public.supplier su where su.id = v.supplier_id), 'proveedor'), v.invoice_number)
                           || case when (s->>'no_deducible')::boolean then ' (sin descontar el IVA)' else '' end,
                         'source_type', 'supplier_invoice', 'source_id', v.id, 'confianza', 'seguro', 'porque', s->>'porque',
                         'razones', jsonb_build_array(jsonb_build_object('decision', 'Apuntada sola', 'porque', s->>'porque')),
                         'party_id', s->>'tercero', 'documento', v.invoice_number),
      v_lineas, null, v_quien, null);
    v_entry := nullif(v_res->>'id', '')::uuid;
    if v_entry is null then raise exception 'no ha salido su asiento (%).', v_res; end if;
    perform public._journal_entry_validar(v_entry, v_quien);
  exception when others then
    raise exception using message = 'S01O_NO_SALE: ' || sqlerrm;
  end;
  insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, regla, porque, entry_id)
  values (v.id, v.account_id, v.company_id, 'apuntada', 'factura', s->>'porque', v_entry)
  on conflict (invoice_id) do update set estado = 'apuntada', regla = excluded.regla, porque = excluded.porque, entry_id = excluded.entry_id, at = now();
  return jsonb_build_object('apuntada', true, 'porque', s->>'porque', 'asiento', v_entry);
end $$;
revoke all on function public._conta_factura_apuntar(uuid) from public, anon, authenticated;

-- La pasada de una empresa: cada factura que no es de plataforma, por revisar y sin asiento, una a una.
create or replace function public._conta_facturas_apuntar(p_company uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; r jsonb; v_si int := 0; v_no int := 0; v_motivos jsonb := '{}'::jsonb; v_m text;
begin
  for v_id in
    select si.id from public.supplier_invoice si
     where si.company_id = p_company and si.status in ('en_revision', 'aprobada')
       and not exists (select 1 from public.party_role ps join public.party_role pl on pl.account_id = ps.account_id and pl.party_id = ps.party_id and pl.role = 'platform'
                        where ps.account_id = si.account_id and ps.role = 'supplier' and ps.supplier_id = si.supplier_id)
       and not exists (select 1 from public.journal_entry e where e.account_id = si.account_id and e.source_type = 'supplier_invoice' and e.source_id = si.id and e.status in ('propuesto', 'borrador', 'validado'))
     order by si.invoice_date, si.id
  loop
    begin
      r := public._conta_factura_apuntar(v_id);
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
revoke all on function public._conta_facturas_apuntar(uuid) from public, anon, authenticated;

create or replace function public._conta_facturas_apuntar_todas()
returns void language plpgsql security definer set search_path to 'public' as $$
declare v_e uuid; v_mal text[] := '{}';
begin
  for v_e in select company_id from public.company_purchase_setting where post_safe_invoices loop
    begin perform public._conta_facturas_apuntar(v_e);
    exception when others then v_mal := v_mal || format('%s: %s', v_e, sqlerrm); end;
  end loop;
  -- Las demás empresas ya han pasado; esto solo hace que cron la cuente como fallida (regla 8).
  if cardinality(v_mal) > 0 then raise exception 'S01o·2: la pasada ha fallado en %', array_to_string(v_mal, ' · '); end if;
end $$;
revoke all on function public._conta_facturas_apuntar_todas() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 's01o2-apunta-solo') then perform cron.unschedule('s01o2-apunta-solo'); end if;
    perform cron.schedule('s01o2-apunta-solo', '9,39 * * * *', 'select public._conta_facturas_apuntar_todas()');
  end if;
end $$;
