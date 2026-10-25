-- supabase/vuelta-atras/20261025T1212_v02_puerta.down.sql
--
-- Vuelta atrás de 20261025T1212_v02_puerta: todo como estaba el 25/10.
--   · Sin las funciones de la puerta ni sus ajustes.
--   · conta_direccion_entrada y conta_entrada_remitente, las de producción del
--     25/10 (medidas con pg_get_functiondef).
--   · Las restricciones de antes en las direcciones, las esperadas y los
--     remitentes. PARA si hay algo que solo cabe en lo nuevo (una dirección de
--     documentos, una fuente sin proveedor o con otra cadencia, un remitente
--     «tipo», una petición sin proveedor): eso ya es trabajo de alguien y no
--     se deshace a ciegas.
--   · Sin las columnas nuevas.

do $$ begin
  if exists (select 1 from public.company_inbound_address where kind = 'documentos')
     or exists (select 1 from public.supplier_expected_invoice where supplier_id is null or cadence <> 'mensual')
     or exists (select 1 from public.company_inbound_sender where decision <> 'no_facturas')
     or exists (select 1 from public.supplier_invoice_request where supplier_id is null)
     or exists (select 1 from public.document_inbox where file_bucket = 'conta-entrada')
     or exists (select 1 from storage.objects where bucket_id = 'conta-entrada') then
    raise exception 'VUELTA ATRÁS DE LA PUERTA: hay direcciones de documentos, fuentes nuevas, remitentes aprendidos, peticiones sin proveedor o ficheros en conta-entrada. No se deshace a ciegas.';
  end if;
end $$;

drop function if exists public.conta_puerta_pedir(uuid, date, text, text, text, text);
drop function if exists public.conta_entrada_tipo(uuid, text, text);
drop function if exists public.conta_puerta_dime_que_es(uuid, text, boolean, text);
drop function if exists public.conta_puerta(uuid, int);
drop function if exists public.conta_puerta_ajustes_poner(uuid, boolean, smallint, text);
drop function if exists public.conta_puerta_fuente_guardar(uuid, jsonb, text);
drop function if exists public.conta_puerta_fuentes_proponer(uuid);
drop function if exists public.conta_puerta_fuentes(uuid);
drop function if exists public._conta_puerta_llegadas(public.supplier_expected_invoice);
drop function if exists public._conta_puerta_cuenta(uuid);
drop table if exists public.conta_puerta_ajustes;

create or replace function public.conta_entrada_remitente(p_company uuid, p_from text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object('decision', s.decision, 'motivo', s.reason)
    from public.company_inbound_sender s
   where s.company_id = p_company
     and s.sender_sha256 = encode(sha256(convert_to(lower(btrim(coalesce(substring(p_from from '<([^>]+)>'), p_from, ''))), 'UTF8')), 'hex')
$function$;
alter table public.company_inbound_sender drop constraint if exists company_inbound_sender_decision_check;
alter table public.company_inbound_sender add constraint company_inbound_sender_decision_check check (decision = 'no_facturas'::text);
alter table public.company_inbound_sender drop column if exists doc_kind;

drop index if exists public.supplier_invoice_request_fuente_mes_uq;
alter table public.supplier_invoice_request alter column supplier_id set not null;

drop index if exists public.supplier_expected_invoice_clave_uq;
alter table public.supplier_expected_invoice drop column if exists updated_by_name;
alter table public.supplier_expected_invoice drop column if exists updated_at;
alter table public.supplier_expected_invoice drop column if exists covered_by_recurring_id;
alter table public.supplier_expected_invoice drop column if exists match;
alter table public.supplier_expected_invoice drop column if exists source_key;
alter table public.supplier_expected_invoice drop column if exists group_label;
alter table public.supplier_expected_invoice drop column if exists gap_days;
alter table public.supplier_expected_invoice drop column if exists weekday;
alter table public.supplier_expected_invoice drop column if exists margin_days;
alter table public.supplier_expected_invoice drop column if exists kind;
alter table public.supplier_expected_invoice drop constraint if exists supplier_expected_invoice_cadence_check;
alter table public.supplier_expected_invoice add constraint supplier_expected_invoice_cadence_check check (cadence = 'mensual'::text);
alter table public.supplier_expected_invoice alter column supplier_id set not null;

alter table public.document_inbox drop constraint if exists document_inbox_file_bucket_check;
alter table public.document_inbox add constraint document_inbox_file_bucket_check check (file_bucket = 'receipt-uploads'::text);
drop policy if exists conta_entrada_select on storage.objects;
drop policy if exists conta_entrada_insert on storage.objects;
drop policy if exists conta_entrada_delete on storage.objects;
do $$ begin
  delete from storage.buckets where id = 'conta-entrada';
exception when others then
  raise notice 'El almacén conta-entrada se queda (vacío): Supabase no deja borrarlo por SQL (%).', sqlerrm;
end $$;
alter table public.document_inbox drop column if exists expected_id;
alter table public.document_inbox drop column if exists doc_kind_by;
alter table public.document_inbox drop column if exists doc_kind;

create or replace function public.conta_direccion_entrada(p_company uuid, p_tipo text, p_quien_nombre text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_c public.company;
  v_base text; v_lp text; v_i int := 1;
  v_x public.company_inbound_address;
begin
  if p_tipo not in ('facturas', 'liquidaciones') then raise exception 'Una dirección es de facturas o de liquidaciones.' using errcode = '22023'; end if;
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select * into v_x from public.company_inbound_address where company_id = p_company and kind = p_tipo;
  if v_x.id is not null then return to_jsonb(v_x) || jsonb_build_object('direccion', v_x.local_part || '@' || v_x.domain, 'ya_estaba', true); end if;
  if not public.current_user_is_admin_or_manager_of(v_c.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta crea las direcciones de entrada.' using errcode = '42501';
  end if;
  v_base := regexp_replace(lower(translate(coalesce(nullif(v_c.trade_name, ''), v_c.legal_name, 'empresa'),
                                           'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç', 'AAAAEEEEIIIIOOOOUUUUNCaaaaeeeeiiiioooouuuunc')), '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  v_base := left(regexp_replace(v_base, '-(s-?l-?u?|s-?a|s-?c-?p|s-?l-?l)$', ''), 30);
  if length(v_base) < 2 then v_base := 'empresa'; end if;
  v_lp := p_tipo || '-' || v_base;
  while exists (select 1 from public.company_inbound_address where lower(local_part) = v_lp and domain = 'entrada.folvy.app') loop
    v_i := v_i + 1; v_lp := p_tipo || '-' || v_base || '-' || v_i;
  end loop;
  insert into public.company_inbound_address (account_id, company_id, kind, local_part, created_by, created_by_name)
  values (v_c.account_id, v_c.id, p_tipo, v_lp, auth.uid(), p_quien_nombre) returning * into v_x;
  return to_jsonb(v_x) || jsonb_build_object('direccion', v_x.local_part || '@' || v_x.domain, 'ya_estaba', false);
end $function$;
alter table public.company_inbound_address drop constraint if exists company_inbound_address_local_part_check;
alter table public.company_inbound_address add constraint company_inbound_address_local_part_check
  check (local_part ~ (('^'::text || kind) || '-[a-z0-9][a-z0-9-]{1,40}$'::text));
alter table public.company_inbound_address drop constraint if exists company_inbound_address_kind_check;
alter table public.company_inbound_address add constraint company_inbound_address_kind_check
  check (kind = any (array['facturas'::text, 'liquidaciones'::text]));
