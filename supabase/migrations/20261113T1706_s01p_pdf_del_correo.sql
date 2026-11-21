-- supabase/migrations/20261113T1706_s01p_pdf_del_correo.sql
--
-- S01p·20 · 1b · El PDF de las facturas de Just Eat (Julio, 13/11). La factura de comisión de
-- Just Eat viene ESCRITA en el cuerpo del correo, sin PDF adjunto, y el lector no guardaba nada:
-- las 43 de Foodint están sin papel, y el PDF es obligatorio en Sumied y para Diez.
--
-- Desde ahora, al entrar, la función de entrada hace el PDF del propio correo, tal como llega, lo
-- guarda en receipt-uploads y queda como el papel de su factura. Para las que ya entraron, «Poner el
-- PDF a las facturas de Just Eat que no lo tienen», en Correo de facturas.
--
-- SOLO AÑADE dos funciones:
--   1. conta_factura_papel_del_correo(factura, ruta): el PDF hecho del correo es el papel de la
--      factura, si aún no tiene ninguno (si ya tiene, no lo toca y lo dice). Solo la clave de servicio.
--   2. conta_correo_papeles_que_faltan(empresa): las facturas que entraron por correo como liquidación
--      de Just Eat y siguen sin papel, con su correo y su número (como mucho 60). Administración o
--      encargado. Los correos que no entraron como liquidación (los 3 de octubre de Foodint, que crea
--      D por tanda) no salen: su registro de entrada no es una liquidación ni nombra factura.

create or replace function public.conta_factura_papel_del_correo(p_invoice uuid, p_ruta text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_f public.supplier_invoice;
begin
  select * into v_f from public.supplier_invoice where id = p_invoice;
  if v_f.id is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  if coalesce(p_ruta, '') not like v_f.account_id::text || '/%' then raise exception 'El fichero no es de esta cuenta.' using errcode = '22023'; end if;
  if v_f.raw_document_url is not null then
    return jsonb_build_object('puesto', false, 'texto', format('La factura %s ya tenía su PDF: no lo cambio.', coalesce(v_f.invoice_number, 'sin número')));
  end if;
  update public.supplier_invoice
     set raw_document_url = p_ruta, no_document_at = null, no_document_reason = null, no_document_by_name = null, updated_at = now()
   where id = p_invoice;
  return jsonb_build_object('puesto', true, 'texto', format('La factura %s tiene ya su PDF, hecho de su correo.', coalesce(v_f.invoice_number, 'sin número')));
end $$;
revoke all on function public.conta_factura_papel_del_correo(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_factura_papel_del_correo(uuid, text) to service_role;
comment on function public.conta_factura_papel_del_correo(uuid, text) is
  'S01p·20 · 1b. El PDF hecho del correo es el papel de la factura, si aún no tiene ninguno.';

create or replace function public.conta_correo_papeles_que_faltan(p_company uuid)
returns table (email_id text, factura_id uuid, numero text, account_id uuid)
language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid;
begin
  select c.account_id into v_acc from public.company c where c.id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado pone el PDF a las facturas.' using errcode = '42501';
  end if;
  return query
  select l.email_id, si.id, si.invoice_number, si.account_id
    from public.inbound_email_log l
    join public.supplier_invoice si on si.id = (l.detail->>'factura_id')::uuid and si.account_id = v_acc
   where l.company_id = p_company and l.outcome = 'liquidacion' and l.detail->>'plataforma' = 'justeat'
     and si.raw_document_url is null and si.status <> 'anulada'
   order by l.received_at, l.email_id
   limit 60;
end $$;
revoke all on function public.conta_correo_papeles_que_faltan(uuid) from public, anon;
grant execute on function public.conta_correo_papeles_que_faltan(uuid) to authenticated;
comment on function public.conta_correo_papeles_que_faltan(uuid) is
  'S01p·20 · 1b. Las facturas de Just Eat que entraron por correo como liquidación y siguen sin papel (como mucho 60).';
