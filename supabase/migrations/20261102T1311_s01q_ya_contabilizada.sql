-- supabase/migrations/20261102T1311_s01q_ya_contabilizada.sql
-- cambia: public._conta_factura_apuntar · prueba: supabase/staging/sql/20261102_s01q_guarda_prueba.sql
-- cambia: public._conta_plataforma_apuntar · prueba: supabase/staging/sql/20261102_s01q_guarda_prueba.sql
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261102_s01q_guarda_prueba.sql
-- cambia: public.supplier_invoice_auto · prueba: supabase/staging/sql/20261102_s01q_guarda_prueba.sql
--
-- S01q · La guarda (Julio, 02/11, respuesta 2): una factura recibida NO se
-- apunta sola si ya está contabilizada, ni si su fecha cae en un periodo cerrado.
-- El 01/11 la pasada del S01o apuntó por segunda vez 123 facturas que Diez ya
-- tenía (mismo número, mismo proveedor, mismo total): gasto e IVA dos veces.
-- Vale para cualquier cliente.
--   1. «Ya contabilizada»: su número está en el concepto o el justificante de un
--      asiento validado de la empresa (migrado o no, que no sea el suyo ni esté
--      anulado), con la subcuenta del proveedor (o su tercero) por el total, en su
--      lado (haber si es factura, debe si es abono). Entonces se enlaza a ese
--      asiento (supplier_invoice.journal_entry_id) y queda «Ya contabilizada en
--      Diez (asiento N, fecha)». No sale en «Por revisar»: sale como «En Diez».
--   2. Su fecha es de antes del corte (lo que lleva Diez): nunca se apunta sola;
--      sale con su motivo y decide una persona.
-- Las dos pasadas (plataformas y demás facturas) la miran antes que nada. No se
-- toca el estado de la factura (sus disparadores de aprobación y pago no corren).
-- Misma firma que las de antes, sobre su definición viva, con su respaldo.

-- 1 · El estado nuevo de la pasada: amplía el CHECK.
alter table public.supplier_invoice_auto drop constraint if exists supplier_invoice_auto_estado_check;
alter table public.supplier_invoice_auto add constraint supplier_invoice_auto_estado_check
  check (estado in ('apuntada', 'no', 'deshecha', 'ya_contabilizada'));

-- 2 · ¿Ya está contabilizada? El asiento con el que casa, o null.
create or replace function public._conta_factura_ya_contabilizada(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.supplier_invoice; v_num text; v_party uuid; r record;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or v.supplier_id is null or v.grand_total is null then return null; end if;
  v_num := upper(regexp_replace(coalesce(v.invoice_number, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_num) < 4 then return null; end if;
  select pr.party_id into v_party from public.party_role pr
   where pr.account_id = v.account_id and pr.role = 'supplier' and pr.supplier_id = v.supplier_id limit 1;
  select e.id, e.series, e.number, e.entry_date, e.source_type into r
    from public.journal_entry e
   where e.account_id = v.account_id and e.company_id = v.company_id and e.status = 'validado'
     and e.voided_at is null and e.reverses_entry_id is null
     and not (e.source_type = 'supplier_invoice' and e.source_id = v.id)
     and (upper(regexp_replace(coalesce(e.concept, ''), '[^A-Za-z0-9]', '', 'g')) like '%' || v_num || '%'
          or upper(regexp_replace(coalesce(e.document_ref, ''), '[^A-Za-z0-9]', '', 'g')) = v_num)
     and exists (
       select 1 from public.journal_line l
        where l.entry_id = e.id
          and (case when v.grand_total >= 0 then l.credit - l.debit else l.debit - l.credit end) = abs(v.grand_total)
          and (l.company_account_id in (select k.company_account_id from public.company_account_link k
                                         where k.account_id = v.account_id and k.company_id = v.company_id and k.entity = 'supplier'
                                           and k.entity_id = v.supplier_id::text and k.role = 'principal')
               or (v_party is not null and l.party_id = v_party)))
   order by abs(e.entry_date - v.invoice_date), e.entry_date
   limit 1;
  if r.id is null then return null; end if;
  return jsonb_build_object('id', r.id, 'serie', r.series, 'numero', r.number, 'fecha', r.entry_date, 'migrado', r.source_type = 'migrated');
end $$;
revoke all on function public._conta_factura_ya_contabilizada(uuid) from public, anon, authenticated;
grant execute on function public._conta_factura_ya_contabilizada(uuid) to service_role;
comment on function public._conta_factura_ya_contabilizada(uuid) is 'S01q · El asiento validado de la empresa que ya lleva esta factura (su número en el concepto o el justificante, su proveedor por el total), o null.';

-- 3 · La guarda: null si se puede seguir; si no, por qué no (y lo deja dicho).
create or replace function public._conta_factura_guarda(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.supplier_invoice; d jsonb; v_corte date; v_motivo text;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null then return null; end if;
  d := public._conta_factura_ya_contabilizada(v.id);
  if d is not null then
    v_motivo := 'Ya contabilizada en ' || case when (d->>'migrado')::boolean then 'Diez' else 'el diario' end
                || ' (asiento ' || (d->>'serie') || '/' || (d->>'numero') || ', ' || to_char((d->>'fecha')::date, 'DD/MM/YYYY') || '): no se vuelve a apuntar.';
    update public.supplier_invoice set journal_entry_id = (d->>'id')::uuid, updated_at = now()
     where id = v.id and journal_entry_id is distinct from (d->>'id')::uuid;
    insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, porque, entry_id)
    values (v.id, v.account_id, v.company_id, 'ya_contabilizada', v_motivo, (d->>'id')::uuid)
    on conflict (invoice_id) do update set estado = 'ya_contabilizada', porque = excluded.porque, entry_id = excluded.entry_id, at = now()
     where supplier_invoice_auto.estado <> 'apuntada';
    return jsonb_build_object('apuntada', false, 'motivo', v_motivo, 'ya_contabilizada', true, 'asiento', d->>'id');
  end if;
  v_corte := public._conta_corte(v.company_id);
  if v_corte is not null and v.invoice_date < v_corte then
    v_motivo := 'Su fecha (' || to_char(v.invoice_date, 'DD/MM/YYYY') || ') es de un periodo ya cerrado (lo lleva Diez hasta el '
                || to_char(v_corte - 1, 'DD/MM/YYYY') || ') y no la encuentro allí: no se apunta sola. Míralo tú.';
    insert into public.supplier_invoice_auto (invoice_id, account_id, company_id, estado, porque)
    values (v.id, v.account_id, v.company_id, 'no', v_motivo)
    on conflict (invoice_id) do update set porque = excluded.porque, at = now() where supplier_invoice_auto.estado = 'no';
    return jsonb_build_object('apuntada', false, 'motivo', v_motivo);
  end if;
  return null;
end $$;
revoke all on function public._conta_factura_guarda(uuid) from public, anon, authenticated;
grant execute on function public._conta_factura_guarda(uuid) to service_role;
comment on function public._conta_factura_guarda(uuid) is 'S01q · Antes de apuntar sola una factura: si ya está contabilizada la enlaza y lo dice; si es de un periodo cerrado, lo dice. null si se puede seguir.';

-- 4 · Las dos pasadas la miran antes que nada.
select public._respaldar_funcion('public._conta_factura_apuntar(uuid)', '20261102T1311_s01q_ya_contabilizada');
select public._respaldar_funcion('public._conta_plataforma_apuntar(uuid)', '20261102T1311_s01q_ya_contabilizada');
do $$
declare f text; v_def text; v_n int;
  v_antes constant text := '  if v.id is null then return jsonb_build_object(''apuntada'', false, ''motivo'', ''No está.''); end if;';
begin
  foreach f in array array['public._conta_factura_apuntar(uuid)', 'public._conta_plataforma_apuntar(uuid)'] loop
    v_def := pg_get_functiondef(f::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, v_antes, ''))) / length(v_antes);
    if v_n <> 1 then raise exception 'S01q: % no tiene una sola vez el trozo que se cambia (lo tiene % veces): no se cambia nada.', f, v_n; end if;
    v_def := replace(v_def, v_antes, v_antes || '
  -- S01q · La guarda: ya contabilizada (se enlaza y se dice) o de un periodo cerrado.
  s := public._conta_factura_guarda(v.id);
  if s is not null then return s; end if;');
    execute v_def;
  end loop;
end $$;

-- 5 · Facturas recibidas: la que está enlazada a su asiento de Diez sale «En Diez», con su porqué.
select public._respaldar_funcion('public.conta_documentos_recibidos(uuid,date,date)', '20261102T1311_s01q_ya_contabilizada');
do $$
declare v_def text := pg_get_functiondef('public.conta_documentos_recibidos(uuid,date,date)'::regprocedure); a text[]; b text[]; i int; v_n int;
begin
  a := array[
    '                     when f.asiento->>''estado'' = ''validado'' then ''apuntada''',
    '             order by (e.status = ''validado'') desc, e.created_at desc limit 1) as asiento,',
    '      ''recepcion'', f.recepcion, ''asiento'', f.asiento,',
    '      ''porque'', case when f.status = ''descartada'''];
  b := array[
    '                     when f.asiento is null and f.diez is not null then ''en_diez''
                     when f.asiento->>''estado'' = ''validado'' then ''apuntada''',
    '             order by (e.status = ''validado'') desc, e.created_at desc limit 1) as asiento,
           -- S01q · Ya contabilizada en Diez: enlazada a su asiento traído.
           (select jsonb_build_object(''id'', e.id, ''serie'', e.series, ''numero'', e.number, ''fecha'', e.entry_date)
              from public.journal_entry e
             where e.id = i.journal_entry_id and e.account_id = v_acc and e.company_id = p_company and e.status = ''validado'') as diez,',
    '      ''recepcion'', f.recepcion, ''asiento'', f.asiento, ''diez'', f.diez,',
    '      ''porque'', case when f.asiento is null and f.diez is not null
                  then ''Ya contabilizada en Diez (asiento '' || (f.diez->>''serie'') || ''/'' || (f.diez->>''numero'') || '', '' || to_char((f.diez->>''fecha'')::date, ''DD/MM/YYYY'') || ''): no se vuelve a apuntar.''
                  when f.status = ''descartada'''];
  for i in 1..array_length(a, 1) loop
    v_n := (length(v_def) - length(replace(v_def, a[i], ''))) / length(a[i]);
    if v_n <> 1 then raise exception 'S01q: conta_documentos_recibidos no tiene una sola vez el trozo % (lo tiene % veces): no se cambia nada.', i, v_n; end if;
    v_def := replace(v_def, a[i], b[i]);
  end loop;
  execute v_def;
end $$;
