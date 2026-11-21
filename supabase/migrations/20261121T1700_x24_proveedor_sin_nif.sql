-- supabase/migrations/20261121T1700_x24_proveedor_sin_nif.sql
--
-- cambia: public._conta_proveedor_solo(uuid,text) · prueba: supabase/staging/sql/20261121_x24_proveedor_nunca_repetido_prueba.sql
-- cambia: public._conta_proveedor_solo_deshacer(uuid,text) · prueba: supabase/staging/sql/20261121_x24_proveedor_nunca_repetido_prueba.sql
--
-- X24 · Un proveedor nunca se da de alta dos veces (Julio, 21/11: «¿siempre comprobará eficazmente que no esté
-- duplicado el proveedor?»). El hueco del R14: el proveedor que ya existe SIN NIF en su ficha. Llega una factura
-- suya con NIF, el alta sola lo busca por NIF, no lo encuentra y crea otro.
--   1. conta_proveedor_solo.nif_completado (columna nueva): lo que tenía antes el que ya estaba, si Sumied le
--      completó el NIF (para «Deshacer»).
--   2. _conta_proveedor_solo: antes de dar de alta uno nuevo, busca entre los proveedores SIN NIF de la cuenta el
--      del mismo nombre (limpio, sin la forma jurídica: _r14_nombre_clave, en su nombre o su nombre fiscal).
--      Uno solo: la factura va a ese y se le completa el NIF («uno que ya estaba · completado el NIF»). Dos o
--      más: ninguno, y no se da de alta: «Hay N proveedores sin NIF con este nombre: elige». Nada en silencio.
--   3. _conta_proveedor_solo_deshacer: «Deshacer» le quita el NIF que le puso (si sigue siendo ese).
-- Cada función, la que vive hoy (su guarda md5 para si no es) con solo eso añadido; la de antes, respaldada
-- (_respaldar_funcion) y devuelta por la vuelta atrás (_restaurar_funcion). Misma firma.
-- Nada en el camino del pedido. El real lo lanza Julio.

alter table public.conta_proveedor_solo add column if not exists nif_completado jsonb;
comment on column public.conta_proveedor_solo.nif_completado is
  'X24: si Sumied le completó el NIF a un proveedor que ya estaba sin NIF, el NIF puesto y lo que tenía antes (tax_id, tipo y estado), para «Deshacer».';

do $guarda$
declare r record;
begin
  for r in select x.firma, x.huella, md5(p.prosrc) viva from (values
      ('public._conta_proveedor_solo(uuid,text)', 'c08220cba6008efd80cf55b1298d4b80'),
      ('public._conta_proveedor_solo_deshacer(uuid,text)', '90e2be7dea6c26cabc854d75c159f696')) x(firma, huella)
    left join pg_proc p on p.oid = to_regprocedure(x.firma) loop
    if r.viva is distinct from r.huella then
      raise exception 'X24 · 1700: % no es la que se midió (huella %, viva %): PARA.', r.firma, r.huella, coalesce(r.viva, 'no existe');
    end if;
  end loop;
end $guarda$;

select public._respaldar_funcion('public._conta_proveedor_solo(uuid,text)', '20261121T1700_x24_proveedor_sin_nif');
select public._respaldar_funcion('public._conta_proveedor_solo_deshacer(uuid,text)', '20261121T1700_x24_proveedor_sin_nif');

CREATE OR REPLACE FUNCTION public._conta_proveedor_solo(p_invoice uuid, p_cuando text DEFAULT 'al_leer'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v public.supplier_invoice; c public.company; p jsonb; v_nif text; v_nombre text; v_tipo text; v_pais text;
  v_party uuid; v_como text; v_s uuid; v_que text; v_creado boolean := false; v_k uuid; v_kcreada boolean := false;
  v_plan text; v_d int; v_hoja text; v_code text; v_gasto jsonb; v_dir jsonb; v_origen jsonb; v_motivo text; v_txt text;
  v_sin uuid[]; v_completado jsonb;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null then return jsonb_build_object('que', 'no', 'motivo', 'No está.'); end if;
  if v.supplier_id is not null then return jsonb_build_object('que', 'ya', 'supplier_id', v.supplier_id); end if;
  if exists (select 1 from public.conta_proveedor_solo x where x.invoice_id = p_invoice and (x.deshecho_at is not null or x.que <> 'no')) then
    return jsonb_build_object('que', 'ya', 'motivo', 'Ya se miró (o se deshizo).');
  end if;
  -- Lo validado no se toca; lo descartado o anulado, tampoco.
  if v.status in ('descartada', 'anulada', 'pagada') or exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = p_invoice and e.status = 'validado') then
    return jsonb_build_object('que', 'ya', 'motivo', 'Validada, pagada, descartada o anulada: no se toca.');
  end if;
  p := v.reading->'factura'->'proveedor';
  if p is null then return jsonb_build_object('que', 'ya', 'motivo', 'Sin lectura del proveedor.'); end if;
  select * into c from public.company where id = v.company_id;
  v_nif := public._conta_nif_clave(p->>'nif');
  v_nombre := nullif(btrim(regexp_replace(coalesce(p->>'nombre', ''), '\s+', ' ', 'g')), '');

  if v_nif is not null and v_nif = public._conta_nif_clave(c.tax_id) then
    v_motivo := format('El NIF del proveedor (%s) es el de %s: parece una factura emitida, no recibida.', v_nif, coalesce(c.legal_name, 'la propia empresa'));
  else
    -- Una plataforma de la cuenta (Julio, 21/11): por su NIF o, si el NIF es de fuera o no viene, por su nombre.
    select x.party_id, x.como into v_party, v_como from public._r14_plataforma_de(v.account_id, v_nif, v_nombre) x;
    if v_party is null and v_nif is null then v_motivo := 'La factura no trae el NIF del proveedor: dalo de alta tú.'; end if;
  end if;

  if v_motivo is null then
    if v_party is not null then
      v_que := 'plataforma';
      select supplier_id into v_s from public.party_role where party_id = v_party and role = 'supplier';
      -- Si la plataforma no tiene ficha de proveedor y hay una suelta con su NIF, se une a ella (no otra suelta).
      if v_s is null and v_nif is not null then
        select s.id into v_s from public.supplier s
         where s.account_id = v.account_id and s.archived_at is null and public._conta_nif_clave(s.tax_id) = v_nif order by s.created_at limit 1;
        if v_s is not null and not public._r14_unir(v_s, v_party, v_como, p_cuando) then v_s := null; end if;
      end if;
    else
      -- Un proveedor de la cuenta, de esta u otra sociedad: el mismo tercero.
      select s.id into v_s from public.supplier s
       where s.account_id = v.account_id and s.archived_at is null and public._conta_nif_clave(s.tax_id) = v_nif
       order by s.created_at limit 1;
      v_que := case when v_s is null then 'alta' else 'existente' end;
      -- X24 (Julio, 21/11) · Antes de darlo de alta: uno de la cuenta SIN NIF en su ficha y con el mismo nombre
      -- (limpio, sin la forma jurídica). Uno solo: es ese, y se le completa el NIF. Dos o más: ninguno, y se dice.
      if v_s is null and public._r14_nombre_clave(v_nombre) is not null then
        select array_agg(s.id order by s.created_at) into v_sin from public.supplier s
         where s.account_id = v.account_id and s.archived_at is null and public._conta_nif_clave(s.tax_id) is null
           and public._r14_nombre_clave(v_nombre) in (public._r14_nombre_clave(s.name), public._r14_nombre_clave(s.legal_name));
        if cardinality(v_sin) > 1 then
          v_motivo := format('Hay %s proveedores sin NIF con este nombre: elige.', cardinality(v_sin));
        elsif cardinality(v_sin) = 1 then
          v_tipo := case when public._verifactu_nif_es_valido(v_nif) then 'nif_es'
                         when v_nif ~ '^[A-Z]{2}' and public._verifactu_nif_iva_ue_valido(left(v_nif, 2), substr(v_nif, 3)) then 'vat_eu' end;
          if v_tipo is null then
            v_motivo := format('El NIF leído (%s) no es válido: compruébalo en el papel antes de ponérselo a quien ya estaba.', v_nif);
          else
            v_s := v_sin[1]; v_que := 'existente';
            select jsonb_build_object('nif', v_nif, 'tax_id_antes', s.tax_id, 'tipo_antes', s.tax_id_type, 'estado_antes', s.tax_id_check_status)
              into v_completado from public.supplier s where s.id = v_s;
          end if;
        end if;
      end if;
    end if;
    if v_s is null and v_motivo is null then
      v_tipo := case when public._verifactu_nif_es_valido(v_nif) then 'nif_es'
                     when v_nif ~ '^[A-Z]{2}' and public._verifactu_nif_iva_ue_valido(left(v_nif, 2), substr(v_nif, 3)) then 'vat_eu' end;
      if v_tipo is null and v_que <> 'plataforma' then
        v_motivo := format('El NIF leído (%s) no es válido: compruébalo en el papel y dalo de alta tú.', v_nif);
      elsif v_nombre is null then
        v_motivo := 'No leí el nombre del proveedor: dalo de alta tú.';
      end if;
    end if;
  end if;

  if v_motivo is not null then
    insert into public.conta_proveedor_solo (invoice_id, account_id, company_id, que, motivo, nif, cuando)
    values (p_invoice, v.account_id, v.company_id, 'no', v_motivo, v_nif, p_cuando)
    on conflict (invoice_id) do update set que = 'no', motivo = excluded.motivo, nif = excluded.nif, company_id = excluded.company_id;
    return jsonb_build_object('que', 'no', 'motivo', v_motivo);
  end if;

  -- X24 · Al que ya estaba sin NIF, el que trae la factura (lo de antes queda en conta_proveedor_solo, para «Deshacer»).
  if v_completado is not null then
    update public.supplier set tax_id = v_nif, tax_id_type = v_tipo,
           tax_id_check_status = case when v_tipo = 'nif_es' then 'valid' else tax_id_check_status end,
           tax_id_checked_at = case when v_tipo = 'nif_es' then now() else tax_id_checked_at end
     where id = v_s;
  end if;

  -- El proveedor nuevo, con lo que trae la factura.
  if v_s is null then
    v_pais := case when v_tipo = 'vat_eu' then left(v_nif, 2) else 'ES' end;
    v_dir := public._r14_partir_direccion(p->>'direccion');
    v_origen := jsonb_build_object('factura', v.invoice_number, 'facturaId', v.id, 'fecha', to_char(now() at time zone 'Europe/Madrid', 'YYYY-MM-DD'), 'quien', 'Sumied');
    insert into public.supplier (account_id, name, legal_name, tax_id, tax_id_type, country_code, entity_kind,
                                 tax_id_check_status, tax_id_checked_at, tax_id_verified_at,
                                 fiscal_street, fiscal_postal_code, fiscal_city, website,
                                 is_active, created_from, created_by_name, data_from_invoice)
    values (v.account_id, coalesce(v_nombre, v_nif), v_nombre, v_nif, coalesce(v_tipo, 'foreign'), v_pais,
            case when v_tipo = 'nif_es' and (v_nif ~ '^\d{8}[A-Z]$' or v_nif ~ '^[XYZKLM]') then 'self_employed'
                 when v_tipo = 'nif_es' and v_nif ~ '^[ABCDEFGHJNPQRSUVW]' then 'company' end,
            case when v_tipo = 'nif_es' then 'valid' end, case when v_tipo = 'nif_es' then now() end, case when v_tipo = 'nif_es' then now() end,
            v_dir->>'calle', v_dir->>'cp', v_dir->>'ciudad', nullif(btrim(p->>'web'), ''),
            true, 'factura', 'Sumied',
            (select jsonb_object_agg(k, v_origen) from unnest(array['nif', 'nombreFiscal']
               || case when v_dir->>'calle' is not null or v_dir->>'cp' is not null then array['direccion'] else '{}' end
               || case when nullif(btrim(p->>'email'), '') is not null then array['correo'] else '{}' end
               || case when nullif(btrim(p->>'telefono'), '') is not null then array['telefono'] else '{}' end
               || case when nullif(btrim(p->>'web'), '') is not null then array['web'] else '{}' end) k))
    returning id into v_s;
    v_creado := true;
    -- El correo y el teléfono, en su contacto principal (en producción supplier no los tiene: van en
    -- supplier_contact, como al «Darlo de alta» de la pantalla).
    if nullif(btrim(p->>'email'), '') is not null or nullif(btrim(p->>'telefono'), '') is not null then
      insert into public.supplier_contact (account_id, supplier_id, name, role, phone, email, is_primary, notes, created_by_name)
      values (v.account_id, v_s, coalesce(v_nombre, v_nif), 'other', nullif(btrim(p->>'telefono'), ''), nullif(btrim(p->>'email'), ''), true,
              format('De la factura %s (lo dio de alta Sumied).', coalesce(v.invoice_number, 'sin número')), 'Sumied');
    end if;
    -- La ficha nueva de una plataforma va en el tercero de la plataforma (el disparador del C03 la une por
    -- el NIF; por el nombre, no): si ha quedado en un tercero suyo, pasa al de la plataforma y ese se borra.
    if v_que = 'plataforma' then
      select party_id into v_txt from public.party_role where supplier_id = v_s and role = 'supplier';
      if v_txt is distinct from v_party::text then
        update public.party_role set party_id = v_party where supplier_id = v_s and role = 'supplier';
        delete from public.party pa where pa.id = v_txt::uuid and pa.source = 'supplier' and not exists (select 1 from public.party_role ro where ro.party_id = pa.id);
      end if;
    end if;
  end if;

  -- Su subcuenta en esta empresa: la siguiente libre de la 4000 o de la 4100 (la plataforma, su 410).
  select k.company_account_id into v_k from public.company_account_link k
   where k.company_id = v.company_id and k.entity = 'supplier' and k.entity_id = v_s::text and k.role = 'principal';
  select a.plan, length(a.code) into v_plan, v_d from public.company_account a where a.company_id = v.company_id limit 1;
  if v_k is null and v_plan is not null then
    if v_que = 'plataforma' then v_hoja := '4100';
    else
      v_gasto := public._conta_gasto_propuesto(v.company_id, v_s, p_invoice);
      v_hoja := case when v_gasto->>'cuenta' like '60%' then '4000' else '4100' end;
    end if;
    v_code := public.company_account_siguiente(v.company_id, v_hoja, v_d);
    if v_code is not null then
      select name into v_txt from public.supplier where id = v_s;
      insert into public.company_account (account_id, company_id, plan, code, template_code, name, kind, source, created_by_name)
      values (v.account_id, v.company_id, v_plan, v_code, v_hoja, (case v_hoja when '4000' then 'Proveedores · ' else 'Acreedores · ' end) || v_txt, 'own', 'manual', 'Sumied')
      returning id into v_k;
      insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
      values (v.account_id, v.company_id, v_k, 'supplier', v_s::text, 'principal', 'manual');
      insert into public.company_account_log (account_id, company_id, que, code, detalle, despues, source, done_by_name)
      values (v.account_id, v.company_id, 'subcuenta_creada', v_code, format('Subcuenta %s · %s, bajo la %s (la dio de alta Sumied con la factura %s).', v_code, v_txt, v_hoja, coalesce(v.invoice_number, 'sin número')),
              jsonb_build_object('code', v_code, 'entity', 'supplier', 'entity_id', v_s, 'r14', true), 'manual', 'Sumied');
      v_kcreada := true;
    end if;
  end if;

  update public.supplier_invoice set supplier_id = v_s where id = p_invoice;
  insert into public.conta_proveedor_solo (invoice_id, account_id, company_id, que, supplier_id, supplier_creado, cuenta_id, cuenta_creada, nif, cuando, nif_completado)
  values (p_invoice, v.account_id, v.company_id, v_que, v_s, v_creado, v_k, v_kcreada, v_nif, p_cuando, v_completado)
  on conflict (invoice_id) do update set que = excluded.que, supplier_id = excluded.supplier_id, supplier_creado = excluded.supplier_creado,
    cuenta_id = excluded.cuenta_id, cuenta_creada = excluded.cuenta_creada, motivo = null, nif = excluded.nif, company_id = excluded.company_id, nif_completado = excluded.nif_completado;
  select name into v_txt from public.supplier where id = v_s;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text)
  values (v.account_id, v.company_id, v.inbox_id, p_invoice, 'folvy', 'Sumied', 'corregida',
          case v_que when 'alta' then format('Proveedor nuevo: Sumied ha dado de alta a %s con lo que trae la factura%s.', v_txt, coalesce(', con su subcuenta ' || v_code, ''))
                     when 'plataforma' then format('Es la plataforma %s: la factura va a su ficha%s.', v_txt, coalesce(' y a su ' || v_code, ''))
                     when 'existente' then case when v_completado is not null
                       then format('Es %s, uno que ya estaba sin NIF: Sumied le ha completado el NIF (%s)%s.', v_txt, v_nif, coalesce('; su subcuenta en esta empresa, ' || v_code, ''))
                       else format('Es %s, que ya estaba dado de alta en la cuenta%s.', v_txt, coalesce(': su subcuenta en esta empresa, ' || v_code, '')) end
                     else format('Es %s, que ya estaba dado de alta en la cuenta%s.', v_txt, coalesce(': su subcuenta en esta empresa, ' || v_code, '')) end);
  return jsonb_build_object('que', v_que, 'supplier_id', v_s, 'creado', v_creado, 'subcuenta', v_code, 'nif_completado', v_completado is not null);
end $function$;

CREATE OR REPLACE FUNCTION public._conta_proveedor_solo_deshacer(p_invoice uuid, p_quien_nombre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r public.conta_proveedor_solo; v public.supplier_invoice; v_nombre text; v_quien text; v_sigue boolean := false; v_texto text; v_quitado boolean := false;
begin
  select * into r from public.conta_proveedor_solo where invoice_id = p_invoice for update;
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if r.invoice_id is null or r.que = 'no' or r.deshecho_at is not null then
    raise exception 'Sumied no le ha puesto proveedor a esta factura: no hay nada que deshacer.' using errcode = '22023';
  end if;
  if exists (select 1 from public.journal_entry e where e.source_type = 'supplier_invoice' and e.source_id = p_invoice and e.status = 'validado') then
    raise exception 'La factura ya está validada: anula antes su asiento.' using errcode = '22023';
  end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  select name into v_nombre from public.supplier where id = r.supplier_id;
  update public.supplier_invoice set supplier_id = null where id = p_invoice and supplier_id = r.supplier_id;
  if r.supplier_creado then
    v_sigue := exists (select 1 from public.supplier_invoice i where i.supplier_id = r.supplier_id and i.id <> p_invoice)
            or exists (select 1 from public.journal_line l join public.company_account_link k on k.company_account_id = l.company_account_id
                        where k.entity = 'supplier' and k.entity_id = r.supplier_id::text);
  end if;
  if r.cuenta_creada and r.cuenta_id is not null and not v_sigue
     and not exists (select 1 from public.journal_line l where l.company_account_id = r.cuenta_id) then
    delete from public.company_account_link where company_account_id = r.cuenta_id;
    delete from public.company_account where id = r.cuenta_id;
  end if;
  if r.supplier_creado and not v_sigue then
    delete from public.party p where p.id = (select party_id from public.party_role where supplier_id = r.supplier_id and role = 'supplier')
       and p.source = 'supplier' and (select count(*) from public.party_role x where x.party_id = p.id) = 1;
    delete from public.supplier where id = r.supplier_id;
    v_texto := format('Deshecho: %s ya no está dado de alta y la factura vuelve a no tener proveedor.', coalesce(v_nombre, 'el proveedor'));
  else
    v_texto := format('Deshecho: la factura ya no es de %s y vuelve a no tener proveedor.', coalesce(v_nombre, 'ese proveedor'));
  end if;
  -- X24 · Si Sumied le completó el NIF a uno que ya estaba, se le quita (solo si sigue siendo ese).
  if r.nif_completado is not null and not r.supplier_creado then
    update public.supplier set tax_id = r.nif_completado->>'tax_id_antes', tax_id_type = r.nif_completado->>'tipo_antes',
           tax_id_check_status = r.nif_completado->>'estado_antes'
     where id = r.supplier_id and public._conta_nif_clave(tax_id) = r.nif_completado->>'nif';
    v_quitado := found;
    if v_quitado then v_texto := v_texto || format(' Y %s vuelve a no tener NIF.', coalesce(v_nombre, 'el proveedor')); end if;
  end if;
  update public.conta_proveedor_solo set deshecho_at = now(), deshecho_por = v_quien where invoice_id = p_invoice;
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, actor_name, action, text)
  values (v.account_id, v.company_id, v.inbox_id, p_invoice, 'persona', v_quien, 'corregida', v_quien || ' ha deshecho lo de Sumied. ' || v_texto);
  return jsonb_build_object('texto', v_texto);
end $function$;
