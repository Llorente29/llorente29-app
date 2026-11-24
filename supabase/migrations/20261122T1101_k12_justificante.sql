-- supabase/migrations/20261122T1101_k12_justificante.sql
--
-- K12 · «Adjuntar el documento» en el asiento general (maqueta nucleo_19; Julio, 22/11: «justificante en el CHECK, con
-- su prueba de staging»). Hasta hoy solo un asiento de la serie 1 (una expedida apuntada a mano) guardaba su PDF
-- (conta_documento_expedida_guardar); el asiento general lo dejaba sin guardar y lo decía.
--
-- cambia: public.journal_entry_document · prueba: supabase/staging/sql/20261122_k12_asiento_general_prueba.sql
--   El CHECK de su clase solo AMPLÍA: a las tres de siempre se suma «justificante». Ninguna fila que existe deja de
--   cumplirlo.
--
-- Y añade conta_documento_justificante_guardar: el justificante (un PDF ya subido a conta-documentos, en la carpeta
-- del asiento, como la expedida) de un asiento a mano validado, de cualquier serie. Uno por asiento; el mismo fichero
-- dos veces (un reintento) no falla. Las mismas comprobaciones que la expedida: quién, la ruta, que esté subido, su
-- tamaño y que sea un PDF.
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita la función y devuelve el CHECK si no hay
-- ningún justificante guardado.

alter table public.journal_entry_document drop constraint if exists journal_entry_document_kind_check;
alter table public.journal_entry_document add constraint journal_entry_document_kind_check
  check (kind = any (array['resumen_ventas'::text, 'factura_recibida'::text, 'factura_expedida'::text, 'justificante'::text]));

create or replace function public.conta_documento_justificante_guardar(p_entry uuid, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $function$
declare
  v_e public.journal_entry; v_x public.journal_entry_document; v_obj record; v_prefijo text;
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
  if v_e.source_type <> 'manual' then
    raise exception 'Ese asiento no es a mano: su documento es el de su ficha.' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del documento no es un sha256.' using errcode = '22023';
  end if;

  select * into v_x from public.journal_entry_document where entry_id = v_e.id and kind = 'justificante';
  if v_x.id is not null then
    if v_x.sha256 = p_sha256 and v_x.storage_path = p_ruta then
      return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', true);
    end if;
    raise exception 'Ese asiento ya tiene su justificante (guardado el % por %): no se cambia.',
      to_char(v_x.created_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI'), coalesce(v_x.created_by_name, 'alguien') using errcode = '23505';
  end if;

  v_prefijo := v_e.account_id::text || '/' || v_e.id::text || '/';
  if p_ruta is null or left(p_ruta, length(v_prefijo)) <> v_prefijo or substr(p_ruta, length(v_prefijo) + 1) !~ '^[0-9a-f]{16,64}\.pdf$' then
    raise exception 'La ruta del documento no es la de este asiento (%<huella>.pdf).', v_prefijo using errcode = '22023';
  end if;
  select o.name, (o.metadata->>'size')::bigint as bytes, o.metadata->>'mimetype' as tipo into v_obj
    from storage.objects o where o.bucket_id = 'conta-documentos' and o.name = p_ruta;
  if v_obj.name is null then
    raise exception 'El justificante no está subido (%): no se enlaza nada.', p_ruta using errcode = 'P0002';
  end if;
  if v_obj.bytes is not null and v_obj.bytes <> p_bytes then
    raise exception 'El justificante subido tiene % bytes y se dijeron %: no se enlaza.', v_obj.bytes, p_bytes using errcode = '22023';
  end if;
  if v_obj.tipo is not null and v_obj.tipo <> 'application/pdf' then
    raise exception 'El justificante subido no es un PDF (%): una foto se convierte a PDF antes.', v_obj.tipo using errcode = '22023';
  end if;

  insert into public.journal_entry_document (account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_by, created_by_name)
  values (v_e.account_id, v_e.company_id, v_e.id, 'justificante', p_ruta, p_nombre, p_sha256, p_bytes, auth.uid(), p_quien_nombre)
  returning * into v_x;
  return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', false);
end $function$;
comment on function public.conta_documento_justificante_guardar(uuid, text, text, text, integer, text) is
  'K12 · El justificante (PDF ya subido a conta-documentos/<cuenta>/<asiento>/<huella>.pdf) de un asiento a mano validado, de cualquier serie. Uno por asiento; el mismo fichero otra vez no falla.';
revoke all on function public.conta_documento_justificante_guardar(uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.conta_documento_justificante_guardar(uuid, text, text, text, integer, text) to authenticated, service_role;
