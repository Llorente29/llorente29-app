-- supabase/migrations/20261112T0100_e05_lotes.sql
--
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261112_e05_lotes_prueba.sql
--
-- E05 · Tarea 2 · La quincena de Catcher entra de una vez: el ZIP de PDF y los
-- dos Excel (FACTURAS y PEDIDOS) se leen en el navegador
-- (src/modules/conta/lib/catcherQuincena.ts) y aquí se registran como un LOTE
-- con una factura recibida por PDF.
--
-- Lo que añade (todo nuevo, salvo lo de la cabecera):
--   1. supplier_invoice: el EMISOR de cada factura (nombre, NIF/NIE y
--      domicilio) y el lote del que sale. Julio, 15/10, opción b: los riders y
--      las flotas van al proveedor genérico «Riders» (la 41000100), como en
--      Diez, con el emisor en cada factura; el NIF que va a Diez es el del
--      emisor (conta_recibida_envio, 0110).
--      Y el origen «lote» en el CHECK de source (solo amplía: lo de la cabecera).
--   2. supplier_batch: el lote de una quincena (una por empresa, proveedor y
--      periodo), con las huellas de los tres ficheros.
--   3. supplier_batch_order: los pedidos del Excel PEDIDOS (el código se
--      repite: la clave es código + fecha y hora), para los cruces (tarea 3).
--   4. supplier_batch_store: la tienda de Catcher → el local (hecho de Julio:
--      «FoodInt Camichi» = Carabanchel, «FoodInt Florencio Llorente» = Alcalá).
--   5. conta_lote_registrar: el lote, sus pedidos, una entrada en la bandeja y
--      una factura en revisión por PDF. La misma quincena dos veces no crea
--      nada y lo dice; una factura que ya estaba (mismo emisor, número y
--      total) no entra dos veces.
--
-- RGPD: el nombre, el NIF/NIE y el domicilio de cada rider solo viven aquí, en
-- la base de producción (y su lectura, con los permisos de la cuenta).

-- 1 · El emisor en la factura ------------------------------------------------------
alter table public.supplier_invoice add column if not exists issuer_name text;
alter table public.supplier_invoice add column if not exists issuer_tax_id text;
alter table public.supplier_invoice add column if not exists issuer_address text;
comment on column public.supplier_invoice.issuer_name is
  'E05 · Quien expide la factura cuando no es el proveedor de la ficha (los riders y flotas de Catcher van al proveedor genérico «Riders»). Si está, es el que va a Diez.';
comment on column public.supplier_invoice.issuer_tax_id is
  'E05 · El NIF/NIE de quien expide la factura (normalizado: mayúsculas, sin separadores ni «ES»). Si está, es el CifCliente que va a Diez.';
comment on column public.supplier_invoice.issuer_address is
  'E05 · El domicilio de quien expide la factura (RD 1619/2012, art. 6.1.e).';

alter table public.supplier_invoice drop constraint if exists supplier_invoice_source_check;
alter table public.supplier_invoice add constraint supplier_invoice_source_check check (source in ('manual', 'ocr', 'lote'));

-- 2 · El lote ---------------------------------------------------------------------
create table if not exists public.supplier_batch (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  provider text not null check (provider in ('catcher')),
  period_from date not null,
  period_to date not null check (period_to >= period_from),
  label text not null,
  -- Los ficheros que se subieron: [{clase, nombre, sha256, bytes}].
  files jsonb not null default '[]'::jsonb,
  invoice_count integer not null default 0,
  tax_base_total numeric(14,2),
  tax_total numeric(14,2),
  grand_total numeric(14,2),
  -- Lo que no cuadraba al leer (factura sin PDF, tienda sin local…).
  warnings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text
);
create unique index if not exists supplier_batch_periodo_uq on public.supplier_batch (account_id, company_id, provider, period_from, period_to);
comment on table public.supplier_batch is
  'E05 · Un lote de facturas recibidas que el proveedor da de una vez (la quincena de Catcher: ZIP de PDF + Excel FACTURAS + Excel PEDIDOS). Uno por empresa, proveedor y periodo.';
alter table public.supplier_batch enable row level security;
drop policy if exists supplier_batch_read on public.supplier_batch;
create policy supplier_batch_read on public.supplier_batch for select using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_batch from anon, authenticated;
grant select on public.supplier_batch to authenticated;

alter table public.supplier_invoice add column if not exists batch_id uuid references public.supplier_batch(id) on delete set null;
create index if not exists supplier_invoice_lote_idx on public.supplier_invoice (batch_id) where batch_id is not null;
comment on column public.supplier_invoice.batch_id is 'E05 · El lote (supplier_batch) del que salió la factura.';

-- 3 · Los pedidos del lote ----------------------------------------------------------
create table if not exists public.supplier_batch_order (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  batch_id uuid not null references public.supplier_batch(id) on delete cascade,
  invoice_number text not null,
  supplier_invoice_id uuid references public.supplier_invoice(id) on delete set null,
  kind text not null,
  order_code text not null,
  order_status text not null,
  -- La fecha y hora del pedido, en UTC (el Excel la da en hora de Madrid).
  ordered_at timestamptz,
  tax_base numeric(14,2) not null,
  tax_amount numeric(14,2) not null,
  total numeric(14,2) not null
);
create index if not exists supplier_batch_order_lote_idx on public.supplier_batch_order (batch_id, order_code, ordered_at);
comment on table public.supplier_batch_order is
  'E05 · Los pedidos de un lote (Excel PEDIDOS de Catcher): uno por pedido y factura. El código del pedido se repite entre días: la clave es código + fecha y hora.';
alter table public.supplier_batch_order enable row level security;
drop policy if exists supplier_batch_order_read on public.supplier_batch_order;
create policy supplier_batch_order_read on public.supplier_batch_order for select using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_batch_order from anon, authenticated;
grant select on public.supplier_batch_order to authenticated;

-- 4 · La tienda del proveedor → el local --------------------------------------------
create table if not exists public.supplier_batch_store (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  provider text not null check (provider in ('catcher')),
  store_name text not null check (btrim(store_name) <> ''),
  location_id uuid not null references public.locations(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by_name text
);
create unique index if not exists supplier_batch_store_uq on public.supplier_batch_store (account_id, company_id, provider, lower(btrim(store_name)));
comment on table public.supplier_batch_store is
  'E05 · Cómo se llama cada local en el portal del proveedor (la tienda de Catcher) → el local de la cuenta.';
alter table public.supplier_batch_store enable row level security;
drop policy if exists supplier_batch_store_read on public.supplier_batch_store;
create policy supplier_batch_store_read on public.supplier_batch_store for select using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.supplier_batch_store from anon, authenticated;
grant select on public.supplier_batch_store to authenticated;

-- 5 · Registrar el lote --------------------------------------------------------------
create or replace function public.conta_lote_registrar(p_company uuid, p_lote jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare
  v_acc uuid; v_ya public.supplier_batch; v_lote uuid;
  v_desde date := nullif(p_lote->>'desde', '')::date;
  v_hasta date := nullif(p_lote->>'hasta', '')::date;
  v_prov text := coalesce(p_lote->>'proveedor', '');
  v_riders uuid; v_catcher uuid; v_catcher_nuevo boolean := false;
  f jsonb; v_pdf jsonb; v_in uuid; v_fac uuid; v_sup uuid; v_nif text; v_rep uuid; v_conf text; v_loc uuid;
  v_n int := 0; v_rep_n int := 0; v_sin_pdf int := 0; v_ya_pdf int := 0;
  v_base numeric := 0; v_cuota numeric := 0; v_total numeric := 0;
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Alguien de la cuenta');
  v_eur text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta sube facturas.' using errcode = '42501';
  end if;
  if v_prov <> 'catcher' then raise exception 'Solo se suben lotes de Catcher.' using errcode = '22023'; end if;
  if v_desde is null or v_hasta is null or v_hasta < v_desde then raise exception 'El lote no dice de qué periodo es.' using errcode = '22023'; end if;
  -- Sin la clave, jsonb_typeof da NULL y «NULL <> …» no frena: con coalesce.
  if coalesce(jsonb_typeof(p_lote->'facturas'), '') <> 'array' or jsonb_array_length(p_lote->'facturas') = 0 then
    raise exception 'El lote no trae ninguna factura.' using errcode = '22023';
  end if;

  -- La misma quincena dos veces: no se crea nada, y se dice.
  select * into v_ya from public.supplier_batch
   where account_id = v_acc and company_id = p_company and provider = v_prov and period_from = v_desde and period_to = v_hasta;
  if v_ya.id is not null then
    return jsonb_build_object('lote_id', v_ya.id, 'ya_estaba', true, 'facturas', v_ya.invoice_count, 'total', v_ya.grand_total,
      'texto', 'La ' || v_ya.label || ' ya estaba subida (' || v_ya.invoice_count || ' facturas, ' ||
               coalesce(v_ya.created_by_name, 'alguien') || ', ' || to_char(v_ya.created_at at time zone 'Europe/Madrid', 'DD/MM/YYYY HH24:MI') || '). No se ha creado nada.');
  end if;

  -- El proveedor genérico «Riders»: el que lleva la 41000100 como su cuenta.
  select l.entity_id::uuid into v_riders
    from public.company_account_link l
    join public.company_account ca on ca.id = l.company_account_id and ca.account_id = l.account_id and ca.company_id = l.company_id
   where l.account_id = v_acc and l.company_id = p_company and l.entity = 'supplier' and l.role = 'principal' and ca.code = '41000100'
   order by l.created_at limit 1;
  if v_riders is null and exists (select 1 from jsonb_array_elements(p_lote->'facturas') x where x->>'tipo' in ('rider', 'flota')) then
    raise exception 'No hay ningún proveedor con la 41000100 «Riders» como cuenta: dale esa cuenta al proveedor de los riders antes de subir la quincena.' using errcode = 'P0002';
  end if;

  insert into public.supplier_batch (account_id, company_id, provider, period_from, period_to, label, files, warnings, created_by, created_by_name)
  values (v_acc, p_company, v_prov, v_desde, v_hasta, coalesce(nullif(p_lote->>'etiqueta', ''), 'quincena del ' || to_char(v_desde, 'DD/MM/YYYY')),
          coalesce(p_lote->'ficheros', '[]'::jsonb), coalesce(p_lote->'avisos', '[]'::jsonb), auth.uid(), v_quien)
  returning id into v_lote;

  for f in select * from jsonb_array_elements(p_lote->'facturas') loop
    if f->>'tipo' not in ('rider', 'flota', 'catcher') then raise exception 'La factura % no dice de qué tipo es.', f->>'numero' using errcode = '22023'; end if;
    if coalesce(f->>'numero', '') = '' then raise exception 'Una factura del lote no tiene número.' using errcode = '22023'; end if;
    if round((f->>'base')::numeric * 100) + round((f->>'cuota')::numeric * 100) <> round((f->>'total')::numeric * 100) then
      raise exception 'La factura %: base + IVA no es el total.', f->>'numero' using errcode = '22023';
    end if;
    v_nif := nullif(regexp_replace(upper(regexp_replace(coalesce(f->'emisor'->>'nif', ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', ''), '');
    v_loc := nullif(f->>'localId', '')::uuid;
    if v_loc is not null and not exists (select 1 from public.locations where id = v_loc and account_id = v_acc) then
      raise exception 'La factura %: ese local no es de esta cuenta.', f->>'numero' using errcode = '22023';
    end if;

    -- Su proveedor: «Riders» para riders y flotas; Catcher, por su NIF (si no está, se propone darlo de alta).
    if f->>'tipo' = 'catcher' then
      if v_catcher is null then
        select s.id into v_catcher from public.supplier s
         where s.account_id = v_acc and s.archived_at is null and v_nif is not null
           and regexp_replace(upper(regexp_replace(coalesce(s.tax_id, ''), '[^A-Za-z0-9]', '', 'g')), '^ES(?=[A-Z0-9]{9}$)', '') = v_nif
         order by s.created_at limit 1;
        v_catcher_nuevo := v_catcher is null;
      end if;
      v_sup := v_catcher;
    else
      v_sup := v_riders;
    end if;

    -- ¿Ya estaba? El mismo emisor, el mismo número (su clave) y el mismo total.
    select i.id into v_rep from public.supplier_invoice i
     where i.account_id = v_acc and i.status <> 'anulada' and i.not_duplicate_confirmed_at is null
       and public.conta_clave_numero(i.invoice_number) = public.conta_clave_numero(f->>'numero')
       and round(i.grand_total * 100) = round((f->>'total')::numeric * 100)
       and (i.issuer_tax_id = v_nif or (i.issuer_tax_id is null and v_sup is not null and i.supplier_id = v_sup))
     order by i.created_at limit 1;
    if v_rep is not null then v_rep_n := v_rep_n + 1; continue; end if;

    -- Su PDF, subido ya a receipt-uploads por el navegador.
    v_pdf := f->'pdf';
    v_in := null;
    if v_pdf is null or jsonb_typeof(v_pdf) <> 'object' then
      v_sin_pdf := v_sin_pdf + 1;
    else
      if left(v_pdf->>'ruta', 37) <> v_acc::text || '/' then raise exception 'La factura %: la ruta de su PDF no es de esta cuenta.', f->>'numero' using errcode = '22023'; end if;
      if coalesce(v_pdf->>'sha256', '') !~ '^[0-9a-f]{64}$' then raise exception 'La factura %: la huella de su PDF no es un sha256.', f->>'numero' using errcode = '22023'; end if;
      if not exists (select 1 from storage.objects o where o.bucket_id = 'receipt-uploads' and o.name = v_pdf->>'ruta') then
        raise exception 'El PDF de la factura % no está subido.', f->>'numero' using errcode = 'P0002';
      end if;
      select id into v_in from public.document_inbox where account_id = v_acc and sha256 = v_pdf->>'sha256' and status <> 'descartado' limit 1;
      if v_in is not null then v_ya_pdf := v_ya_pdf + 1; v_rep_n := v_rep_n + 1; continue; end if;
      insert into public.document_inbox (account_id, company_id, channel, status, file_path, file_name, mime_type, size_bytes, sha256, reason, created_by, created_by_name)
      values (v_acc, p_company, 'portal', 'leido', v_pdf->>'ruta', v_pdf->>'nombre', 'application/pdf', nullif(v_pdf->>'bytes', '')::int, v_pdf->>'sha256',
              'De la ' || coalesce(p_lote->>'etiqueta', 'quincena') || ' de Catcher.', auth.uid(), v_quien)
      returning id into v_in;
    end if;

    -- Segura solo si cumple la norma, su PDF dice lo mismo, tiene proveedor y cada
    -- tienda su local (un local, o varios en su reparto: un rider reparte para las
    -- dos tiendas y eso no es un problema).
    v_conf := case when f->>'confianza' = 'seguro' and v_pdf is not null and v_sup is not null
                    and (v_loc is not null or (jsonb_array_length(coalesce(f->'reparto', '[]'::jsonb)) > 0
                         and not exists (select 1 from jsonb_array_elements(f->'reparto') x where coalesce(x->>'localId', '') = '')))
               then 'seguro' else 'duda' end;
    insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, doc_kind, invoice_number, invoice_date, status, source,
                                         raw_document_url, tax_base_total, tax_total, grand_total, needs_review, notes, created_by_name,
                                         arrival_channel, reading, reading_confidence, inbox_id, batch_id, issuer_name, issuer_tax_id, issuer_address)
    values (v_acc, p_company, v_sup, v_loc, 'invoice', f->>'numero', nullif(f->>'fecha', '')::date, 'en_revision', 'lote',
            v_pdf->>'ruta', (f->>'base')::numeric, (f->>'cuota')::numeric, (f->>'total')::numeric, v_conf <> 'seguro',
            case when v_sup is null then 'Catcher no tiene ficha: dalo de alta con los datos de la factura.'
                 when v_loc is null and (jsonb_array_length(coalesce(f->'reparto', '[]'::jsonb)) = 0
                                         or exists (select 1 from jsonb_array_elements(f->'reparto') x where coalesce(x->>'localId', '') = ''))
                   then 'Una de sus tiendas de Catcher no tiene local: dile cuál es.' end,
            v_quien, 'portal',
            jsonb_build_object(
              'factura', jsonb_build_object('proveedor', jsonb_build_object('nombre', f->'emisor'->>'nombre', 'nif', v_nif),
                                            'numero', f->>'numero', 'fecha', f->>'fecha', 'clase', 'completa',
                                            'tipos', jsonb_build_array(jsonb_build_object('tipo', (f->>'tipoIva')::numeric, 'base', (f->>'base')::numeric, 'cuota', (f->>'cuota')::numeric)),
                                            'base', (f->>'base')::numeric, 'cuota', (f->>'cuota')::numeric, 'total', (f->>'total')::numeric, 'desgloseDe', 'lote'),
              'comprobaciones', coalesce(f->'requisitos', '[]'::jsonb) || coalesce(f->'contraPdf', '[]'::jsonb),
              'confianza', v_conf,
              'lote', jsonb_build_object('proveedor', v_prov, 'tipo', f->>'tipo', 'pedidos', f->'pedidos', 'periodo', f->'periodo', 'reparto', coalesce(f->'reparto', '[]'::jsonb))),
            v_conf, v_in, v_lote, nullif(btrim(f->'emisor'->>'nombre'), ''), v_nif, nullif(btrim(f->'emisor'->>'domicilio'), ''))
    returning id into v_fac;
    insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, vat_pct, base, vat_amount, surcharge_pct, surcharge_amount)
    values (v_acc, v_fac, (f->>'tipoIva')::numeric, (f->>'base')::numeric, (f->>'cuota')::numeric, null, 0);
    if v_in is not null then
      update public.document_inbox set status = 'factura', supplier_invoice_id = v_fac, updated_at = now() where id = v_in;
      insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, actor, action, text, detail)
      values (v_acc, p_company, v_in, v_fac, 'folvy', 'leida',
              'La ' || (f->>'numero') || ' de la quincena de Catcher, del Excel' || case v_conf when 'seguro' then ': cuadra con su PDF.' else ': hay algo que aclarar.' end,
              jsonb_build_object('confianza', v_conf, 'lote', v_lote));
    end if;
    v_n := v_n + 1;
    v_base := v_base + (f->>'base')::numeric; v_cuota := v_cuota + (f->>'cuota')::numeric; v_total := v_total + (f->>'total')::numeric;
  end loop;

  insert into public.supplier_batch_order (account_id, batch_id, invoice_number, supplier_invoice_id, kind, order_code, order_status, ordered_at, tax_base, tax_amount, total)
  select v_acc, v_lote, p->>'factura',
         (select i.id from public.supplier_invoice i where i.batch_id = v_lote and i.invoice_number = p->>'factura' limit 1),
         coalesce(p->>'tipo', ''), coalesce(p->>'codigo', ''), coalesce(p->>'estado', ''), nullif(p->>'momento', '')::timestamptz,
         coalesce((p->>'base')::numeric, 0), coalesce((p->>'cuota')::numeric, 0), coalesce((p->>'total')::numeric, 0)
    from jsonb_array_elements(coalesce(p_lote->'pedidos', '[]'::jsonb)) p;

  update public.supplier_batch set invoice_count = v_n, tax_base_total = v_base, tax_total = v_cuota, grand_total = v_total where id = v_lote;
  if v_catcher_nuevo then
    insert into public.document_activity (account_id, company_id, actor, action, text, detail)
    values (v_acc, p_company, 'folvy', 'proveedor_propuesto', 'Catcher Marketplace no tiene ficha: la doy de alta con los datos de su factura si me dices que sí.', jsonb_build_object('lote', v_lote));
  end if;

  v_eur := replace(replace(replace(to_char(v_total, 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.') || ' €';
  return jsonb_build_object('lote_id', v_lote, 'ya_estaba', false, 'facturas', v_n, 'ya_estaban', v_rep_n, 'sin_pdf', v_sin_pdf,
    'total', v_total, 'catcher_sin_ficha', v_catcher_nuevo,
    'texto', 'Subida la ' || coalesce(p_lote->>'etiqueta', 'quincena') || ': ' || v_n || case v_n when 1 then ' factura' else ' facturas' end || ' (' || v_eur || ')'
             || case when v_rep_n = 1 then '. 1 ya estaba y no se ha vuelto a apuntar' when v_rep_n > 1 then '. ' || v_rep_n || ' ya estaban y no se han vuelto a apuntar' else '' end
             || case when v_sin_pdf > 0 then '. ' || v_sin_pdf || ' sin su PDF' else '' end || '.');
end $$;
comment on function public.conta_lote_registrar(uuid, jsonb, text) is
  'E05 · Registra un lote del proveedor (la quincena de Catcher, leída en el navegador): el lote, sus pedidos, y una entrada en la bandeja y una factura en revisión por PDF. La misma quincena dos veces no crea nada.';
revoke all on function public.conta_lote_registrar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_lote_registrar(uuid, jsonb, text) to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.supplier_batch, public.supplier_batch_order, public.supplier_batch_store to conta_lectura;
  end if;
end $$;
