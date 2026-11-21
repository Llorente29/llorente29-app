-- supabase/migrations/20261120T2004_k07_cambiar_documento.sql
--
-- K07 · «Cambiar el documento» de una factura recibida YA contabilizada (Julio,
-- 20/11: el documento es el justificante, no cambia el asiento; «el de antes
-- queda en su historial»). Esta solo AÑADE: una tabla nueva y una función
-- nueva. No cambia ninguna tabla ni función que exista, y se puede pasar dos
-- veces seguidas.
--
-- Hoy el documento de una recibida está en dos sitios:
--   · el de la factura (supplier_invoice.raw_document_url), el que enseña la
--     ficha; conta_recibida_papel_poner lo cambia mientras no tiene asiento
--     validado (con su traza en supplier_invoice_change);
--   · el enlazado a su asiento validado (journal_entry_document, «factura_
--     recibida»), el que lee el envío a Diez; lo pone la pasada del minuto
--     (conta_recibida_pdf_por_enlazar / _enlazar) y no se cambia nunca.
--
-- conta_recibida_documento_cambiar(factura, ruta, nombre, quien) cambia los dos
-- en una contabilizada, sin borrar nada:
--   1. lo mismo que pide conta_recibida_papel_poner (de tu cuenta, ni anulada
--      ni descartada, el fichero subido en la carpeta de su cuenta) y además:
--      su asiento validado (si no lo tiene, el documento se cambia en la ficha
--      con conta_recibida_papel_poner) y un administrador o un encargado (como
--      conta_documento_factura_guardar);
--   2. el del asiento, si lo tiene, se GUARDA en journal_entry_document_anterior
--      (nueva) con quién lo cambió y cuándo, y se quita su enlace: el fichero
--      se queda donde estaba, y la pasada del minuto enlaza el nuevo (el PDF
--      hecho de la foto, o el original si ya es un PDF);
--   3. el de la factura, como conta_recibida_papel_poner: el nuevo, su fila del
--      D02 (conta_recibida_pdf) reiniciada y su traza en supplier_invoice_change
--      («papel», con el de antes y el nuevo);
--   4. si el asiento ya salió a Diez (external_send enviado o enlazado), lo
--      dice: allí sigue el de antes. No se toca el envío.
--   Devuelve la frase de lo que ha hecho (regla 8). El asiento no cambia.
--
-- Nada en el camino del pedido: no lee ni escribe ventas, pedidos ni stock.
-- Vuelta atrás: supabase/vuelta-atras/20261120T2004_k07_cambiar_documento.down.sql

create table if not exists public.journal_entry_document_anterior (
  id uuid primary key,
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  entry_id uuid not null references public.journal_entry(id) on delete restrict,
  kind text not null,
  storage_path text not null,
  file_name text not null,
  sha256 text not null,
  size_bytes integer not null,
  created_at timestamptz not null,
  created_by uuid,
  created_by_name text,
  replaced_at timestamptz not null default now(),
  replaced_by uuid,
  replaced_by_name text,
  replaced_with text
);
create index if not exists journal_entry_document_anterior_entry on public.journal_entry_document_anterior (entry_id, replaced_at);
comment on table public.journal_entry_document_anterior is
  'K07 · Los documentos de un asiento que se cambiaron («Cambiar el documento» de una recibida contabilizada): la fila de journal_entry_document tal cual, con quién la cambió, cuándo y por qué fichero. El fichero no se borra.';
alter table public.journal_entry_document_anterior enable row level security;
revoke all on table public.journal_entry_document_anterior from public, anon, authenticated;
grant select on table public.journal_entry_document_anterior to authenticated;
drop policy if exists journal_entry_document_anterior_leer on public.journal_entry_document_anterior;
create policy journal_entry_document_anterior_leer on public.journal_entry_document_anterior for select
  using (account_id = any (public.current_user_account_ids()));

create or replace function public.conta_recibida_documento_cambiar(p_invoice uuid, p_ruta text, p_nombre text default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_f public.supplier_invoice;
  v_e public.journal_entry;
  v_x public.journal_entry_document;
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_ruta text := nullif(trim(p_ruta), '');
  v_nombre text := coalesce(nullif(trim(p_nombre), ''), regexp_replace(coalesce(nullif(trim(p_ruta), ''), ''), '^.*/', ''));
  v_d02 int := 0;
  v_diez text;
  v_texto text;
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if v_f.status in ('anulada', 'descartada') then
    raise exception 'Está %: no se cambia.', v_f.status using errcode = '22023';
  end if;
  select * into v_e from public.journal_entry e
   where e.account_id = v_f.account_id and e.source_type = 'supplier_invoice' and e.source_id = v_f.id and e.status = 'validado'
   order by e.validated_at desc nulls last limit 1
   for update;
  if v_e.id is null then
    raise exception 'No está contabilizada: su documento se cambia en la ficha y se pone al guardar.' using errcode = '22023';
  end if;
  if not public.current_user_is_admin_or_manager_of(v_f.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta cambia el documento de una factura contabilizada.' using errcode = '42501';
  end if;
  if v_ruta is null or left(v_ruta, 37) <> v_f.account_id::text || '/' or v_ruta like '%..%' then
    raise exception 'El documento tiene que estar subido en la carpeta de esta cuenta.' using errcode = '22023';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'receipt-uploads' and o.name = v_ruta) then
    raise exception 'El documento no está subido (%): no se cambia nada.', v_nombre using errcode = 'P0002';
  end if;
  if v_ruta = v_f.raw_document_url then
    return jsonb_build_object('documento', v_ruta, 'ya_estaba', true, 'texto', 'Ese documento ya era el suyo: no cambia nada.');
  end if;

  -- El del asiento: se guarda tal cual, y se quita su enlace (la pasada del minuto enlaza el nuevo).
  select * into v_x from public.journal_entry_document where entry_id = v_e.id and kind = 'factura_recibida';
  if v_x.id is not null then
    insert into public.journal_entry_document_anterior
      (id, account_id, company_id, entry_id, kind, storage_path, file_name, sha256, size_bytes, created_at, created_by, created_by_name,
       replaced_by, replaced_by_name, replaced_with)
    values (v_x.id, v_x.account_id, v_x.company_id, v_x.entry_id, v_x.kind, v_x.storage_path, v_x.file_name, v_x.sha256, v_x.size_bytes,
            v_x.created_at, v_x.created_by, v_x.created_by_name, auth.uid(), v_quien, v_ruta);
    delete from public.journal_entry_document where id = v_x.id;
  end if;

  -- El de la factura, como conta_recibida_papel_poner.
  update public.supplier_invoice
     set raw_document_url = v_ruta, no_document_at = null, no_document_reason = null, no_document_by_name = null, updated_at = now()
   where id = v_f.id;
  delete from public.conta_recibida_pdf r where r.invoice_id = v_f.id;
  get diagnostics v_d02 = row_count;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'papel',
          jsonb_build_array(jsonb_build_object('campo', 'documento', 'antes', v_f.raw_document_url, 'ahora', v_ruta, 'nombre', v_nombre,
                                               'contabilizada', true, 'asiento', v_e.id, 'del_asiento_antes', v_x.storage_path)));

  select s.status into v_diez from public.external_send s
   where s.entry_id = v_e.id and s.account_id = v_f.account_id and s.status in ('enviado', 'enlazado') limit 1;

  v_texto := format('Documento cambiado: «%s». El de antes queda en su historial; el asiento no cambia.', v_nombre)
             || case when v_ruta ~* '\.(jpe?g|png)$' then ' Es una foto: Folvy hace su PDF en un minuto y lo enlaza a su asiento.'
                     else ' En un par de minutos queda enlazado a su asiento.' end
             || case when v_diez is not null then ' En Diez sigue el de antes: hay que mandarlo otra vez.' else '' end;
  return jsonb_build_object('documento', v_ruta, 'ya_estaba', false, 'pdf_reiniciado', v_d02 > 0,
    'del_asiento_guardado', v_x.id is not null, 'en_diez', v_diez is not null, 'texto', v_texto);
end $$;
comment on function public.conta_recibida_documento_cambiar(uuid, text, text, text) is
  'K07 · Cambia el documento de una recibida contabilizada: el de la factura y el enlazado a su asiento (el de antes, a journal_entry_document_anterior; el nuevo lo enlaza la pasada del minuto). Con historial. El asiento no cambia.';
revoke all on function public.conta_recibida_documento_cambiar(uuid, text, text, text) from public, anon;
grant execute on function public.conta_recibida_documento_cambiar(uuid, text, text, text) to authenticated;
