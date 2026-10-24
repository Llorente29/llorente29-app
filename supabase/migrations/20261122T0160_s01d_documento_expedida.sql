-- supabase/migrations/20261122T0160_s01d_documento_expedida.sql
--
-- cambia: public.journal_entry_document · prueba: supabase/staging/sql/20261122_s01d_documento_expedida_prueba.sql
--   (el CHECK de kind solo AMPLÍA: un valor más, los de antes siguen valiendo.
--   Ponerlo toma un momento un cierre ACCESS EXCLUSIVE sobre
--   journal_entry_document, que es pequeña y no es del camino del pedido.)
--
-- S01d · EL PDF DE LA FACTURA EXPEDIDA (encargo S01b, 18/10: «adjuntar el PDF a
-- la expedida y verlo al lado»). Hasta que llegue Facturación, una expedida se
-- apunta a mano (Asientos › Expedida, serie 1). Ahora se le puede enlazar su
-- PDF, como a la recibida (D01) y al resumen de ventas (R15):
--
--   1. journal_entry_document.kind admite 'factura_expedida'.
--   2. conta_documento_expedida_guardar: enlaza al asiento VALIDADO de una
--      expedida a mano (source_type 'manual', serie 1) su PDF, ya subido a
--      conta-documentos en <cuenta>/<asiento>/<huella>.pdf. Las mismas
--      comprobaciones que la recibida: su cuenta, que lo haga un administrador
--      o un encargado, su ruta, el fichero subido, su tamaño y que sea PDF; uno
--      por asiento y no se cambia (lo dice si ya lo tenía, con quién y cuándo).
--
-- Leer el PDF no cambia: journal_entry_document ya se lee por su cuenta (RLS) y
-- el bucket conta-documentos da la URL firmada a la cuenta.
-- Vuelta atrás: supabase/vuelta-atras/20261122T0160_s01d_documento_expedida.down.sql
-- ============================================================================

alter table public.journal_entry_document drop constraint if exists journal_entry_document_kind_check;
alter table public.journal_entry_document add constraint journal_entry_document_kind_check
  check (kind = any (array['resumen_ventas', 'factura_recibida', 'factura_expedida']));

create function public.conta_documento_expedida_guardar(p_entry uuid, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_e public.journal_entry;
  v_x public.journal_entry_document;
  v_obj record;
  v_prefijo text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta guarda el documento de un asiento.' using errcode = '42501';
  end if;
  if v_e.status <> 'validado' then
    raise exception 'El documento se guarda con el asiento validado; este está %.', v_e.status using errcode = '23514';
  end if;
  if v_e.source_type <> 'manual' or v_e.series <> 1 then
    raise exception 'Ese asiento no es de una factura expedida apuntada a mano.' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del documento no es un sha256.' using errcode = '22023';
  end if;

  select * into v_x from public.journal_entry_document where entry_id = v_e.id and kind = 'factura_expedida';
  if v_x.id is not null then
    if v_x.sha256 = p_sha256 and v_x.storage_path = p_ruta then
      return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', true);
    end if;
    raise exception 'Ese asiento ya tiene su factura (guardada el % por %): no se cambia.',
      to_char(v_x.created_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), coalesce(v_x.created_by_name, 'alguien') using errcode = '23505';
  end if;

  v_prefijo := v_e.account_id::text || '/' || v_e.id::text || '/';
  if p_ruta is null or left(p_ruta, length(v_prefijo)) <> v_prefijo or substr(p_ruta, length(v_prefijo) + 1) !~ '^[0-9a-f]{16,64}\.pdf$' then
    raise exception 'La ruta del documento no es la de este asiento (%<huella>.pdf).', v_prefijo using errcode = '22023';
  end if;
  select o.name, (o.metadata->>'size')::bigint as bytes, o.metadata->>'mimetype' as tipo into v_obj
    from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then
    raise exception 'La factura no está subida (%): no se enlaza nada.', p_ruta using errcode = 'P0002';
  end if;
  if v_obj.bytes is not null and v_obj.bytes <> p_bytes then
    raise exception 'La factura subida tiene % bytes y se dijeron %: no se enlaza.', v_obj.bytes, p_bytes using errcode = '22023';
  end if;
  if v_obj.tipo is not null and v_obj.tipo <> 'application/pdf' then
    raise exception 'La factura subida no es un PDF (%): una foto se convierte a PDF antes.', v_obj.tipo using errcode = '22023';
  end if;

  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_e.id, 'factura_expedida', p_ruta, p_nombre, p_sha256, p_bytes, auth.uid(), p_quien_nombre)
  returning * into v_x;
  return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', false);
end $$;
comment on function public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text) is
  'S01d · Enlaza al asiento validado de una factura expedida a mano (serie 1) su PDF ya subido a conta-documentos (kind factura_expedida). Comprueba ruta, fichero, tamaño y tipo; uno por asiento, y no se cambia.';
revoke all on function public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.conta_documento_expedida_guardar(uuid, text, text, text, integer, text) to authenticated;
