-- supabase/vuelta-atras/20261203T0470_d02_recibida_pdf.down.sql
--
-- Vuelta atrás de 20261203T0470_d02_recibida_pdf, en orden inverso:
--   6. fuera el cron conta-recibida-pdf-despertar y su función;
--   5. conta_documento_factura_guardar, la de antes, byte a byte (md5 dbc3443e…);
--   4–2. fuera las funciones de enlazar, apuntar y coger;
--   1. fuera conta_recibida_pdf.
-- PARA, sin tocar nada, si el servidor ya ha hecho algún PDF: su fila diría
-- dónde está y se perdería. Lo ya enlazado a un asiento se queda (es un
-- documento como cualquier otro, en journal_entry_document).
-- ANTES de esto, la función conta-recibida-pdf tiene que dejar de llamarse:
-- quitar el cron (lo hace esto) basta, y nadie más la llama.

do $$
declare n bigint;
begin
  if to_regclass('public.conta_recibida_pdf') is not null then
    execute 'select count(*) from public.conta_recibida_pdf where storage_path is not null' into n;
    if n > 0 then
      raise exception 'D02 0470 vuelta atrás: el servidor ya ha hecho % PDF de recibidas (conta_recibida_pdf) y se perdería dónde están. No se toca nada.', n;
    end if;
  end if;
end $$;

-- 6
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') and exists (select 1 from cron.job where jobname = 'conta-recibida-pdf-despertar') then
    perform cron.unschedule('conta-recibida-pdf-despertar');
  end if;
end $$;
drop function if exists public.conta_recibida_pdf_despertar();

-- 5 · la de producción del 22/10, tal cual.
create or replace function public.conta_documento_factura_guardar(p_entry uuid, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'storage'
as $function$
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
  if v_e.source_type <> 'supplier_invoice' or not exists (select 1 from public.supplier_invoice i where i.id = v_e.source_id and i.account_id = v_e.account_id) then
    raise exception 'Ese asiento no es de una factura recibida.' using errcode = '22023';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'La huella del documento no es un sha256.' using errcode = '22023';
  end if;

  select * into v_x from public.journal_entry_document where entry_id = v_e.id and kind = 'factura_recibida';
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
  values (v_e.account_id, v_e.company_id, v_e.id, 'factura_recibida', p_ruta, p_nombre, p_sha256, p_bytes, auth.uid(), p_quien_nombre)
  returning * into v_x;
  return jsonb_build_object('id', v_x.id, 'ruta', v_x.storage_path, 'nombre', v_x.file_name, 'ya_estaba', false);
end $function$;

-- 4–2
drop function if exists public.conta_recibida_pdf_enlazar(uuid, text, text, text, integer);
drop function if exists public.conta_recibida_pdf_por_enlazar(integer);
drop function if exists public.conta_recibida_pdf_fallo(uuid, text, boolean);
drop function if exists public.conta_recibida_pdf_hecho(uuid, text, text, integer, integer);
drop function if exists public.conta_recibida_pdf_reclamar(integer);
drop function if exists public.conta_recibida_pdf_por_hacer(integer);

-- 1
drop table if exists public.conta_recibida_pdf;
