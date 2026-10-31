-- supabase/migrations/20261031T0930_s01g_soporte_columnas.sql
--
-- S01g · Las recepciones de soporte de la liquidación y las llegadas sin
-- acción (encargo del 31/10, con el visto bueno de Julio a las maquetas).
-- Solo añade (columnas que admiten nulos y funciones nuevas; se puede pasar
-- dos veces), para que staging lo tenga de verdad desde la rama. Lo que lo
-- lee va en la 0931.
--
--   · goods_receipt_path.not_support_at y not_support_by_name: «No es
--     soporte de CTB». Una recepción con la ruta «liquidacion» deja de ser
--     soporte y vuelve a «Por aclarar». No se cambia la ruta: la ruta la
--     decide Compras, y cambiarla podría volver a decidirse sola.
--   · conta_recepcion_no_es_soporte(recepción): lo de arriba, con su frase.
--   · conta_llegada_pdf_subido(llegada, fichero): «Subir el PDF» de una
--     llegada a la que le faltaba (el correo traía un enlace). El fichero va a
--     la misma llegada y queda «recibido», para leerlo.

alter table public.goods_receipt_path add column if not exists not_support_at timestamptz;
alter table public.goods_receipt_path add column if not exists not_support_by_name text;
comment on column public.goods_receipt_path.not_support_at is
  'S01g. Cuándo se dijo «No es soporte de la liquidación» de una recepción con la ruta liquidacion: vuelve a «Por aclarar» en Facturas recibidas.';

create or replace function public.conta_recepcion_no_es_soporte(p_recepcion uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_g public.goods_receipt; v_n int;
begin
  select * into v_g from public.goods_receipt where id = p_recepcion;
  if v_g.id is null or not public.belongs_to_account(v_g.account_id) then raise exception 'Esa recepción no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_g.account_id) then
    raise exception 'Solo un administrador o un encargado dice que una recepción no es soporte.' using errcode = '42501';
  end if;
  update public.goods_receipt_path set not_support_at = now(), not_support_by_name = public.conta_nombre_actor()
   where goods_receipt_id = p_recepcion and account_id = v_g.account_id and path = 'liquidacion' and not_support_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Esa recepción no es soporte de una liquidación.' using errcode = '22023'; end if;
  return jsonb_build_object('mensaje', format('La recepción %s ya no es soporte: vuelve a «Por aclarar».', coalesce(v_g.code, 'sin código')));
end $$;
revoke all on function public.conta_recepcion_no_es_soporte(uuid) from public, anon;
grant execute on function public.conta_recepcion_no_es_soporte(uuid) to authenticated;
comment on function public.conta_recepcion_no_es_soporte(uuid) is
  'S01g. «No es soporte de la liquidación»: la recepción vuelve a «Por aclarar» en Facturas recibidas.';

create or replace function public.conta_llegada_pdf_subido(p_inbox uuid, p_ruta text, p_nombre text, p_tipo text, p_bytes integer, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.document_inbox;
begin
  select * into v_d from public.document_inbox where id = p_inbox;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese documento no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado sube el PDF de un documento.' using errcode = '42501';
  end if;
  if v_d.status <> 'falta_pdf' then raise exception 'A ese documento no le falta el PDF.' using errcode = '22023'; end if;
  if coalesce(p_ruta, '') not like v_d.account_id::text || '/%' then raise exception 'El fichero no es de esta cuenta.' using errcode = '22023'; end if;
  update public.document_inbox set file_bucket = 'receipt-uploads', file_path = p_ruta, file_name = p_nombre, mime_type = p_tipo,
         size_bytes = p_bytes, sha256 = p_sha256, status = 'recibido', reason = null, updated_at = now()
   where id = p_inbox;
  return jsonb_build_object('id', p_inbox, 'ruta', p_ruta, 'mensaje', format('Subido «%s»: lo leo ahora.', p_nombre));
end $$;
revoke all on function public.conta_llegada_pdf_subido(uuid, text, text, text, integer, text) from public, anon;
grant execute on function public.conta_llegada_pdf_subido(uuid, text, text, text, integer, text) to authenticated;
comment on function public.conta_llegada_pdf_subido(uuid, text, text, text, integer, text) is
  'S01g. «Subir el PDF» de una llegada a la que le faltaba: el fichero va a la misma llegada y queda recibido, para leerlo.';
