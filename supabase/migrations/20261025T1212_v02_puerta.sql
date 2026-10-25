-- supabase/migrations/20261025T1212_v02_puerta.sql
--
-- V02 · Entrega 1 · LA PUERTA: Inicio › Documentos (tablero 19, Julio 25/10).
-- Todo lo que entra en la empresa por un solo sitio, sobre lo que ya hay (el
-- buzón de facturas y liquidaciones de la D01, la bandeja document_inbox, las
-- facturas esperadas y «Pedírselas»). Nada duplicado:
--
--   1. UNA DIRECCIÓN POR EMPRESA para cualquier documento (kind «documentos»,
--      `<empresa>@<dominio>`, sin prefijo). Las de «facturas-» y
--      «liquidaciones-» siguen igual. Se prueba con entrada.folvy.app; cuando
--      Julio dé de alta entrada.sumied.com, se crea allí con la misma función.
--   2. QUÉ ES CADA DOCUMENTO: document_inbox.doc_kind (factura, ticket,
--      liquidación, extracto, nómina, riders, otro), quién lo dijo (regla,
--      lectura o persona) y a qué esperado sustituye (expected_id).
--   3. LO QUE SE ESPERA, PARA CUALQUIER FUENTE: supplier_expected_invoice (vacía
--      en todas las cuentas el 25/10) deja de ser solo de proveedores al mes:
--      alquiler, riders (una sola fuente para todos), nóminas, banco e
--      intermediarios; mensual, quincenal, semanal o «varias al mes»; con su
--      margen, su grupo en pantalla («Alquiler · Cañaveral 75») y, preparado
--      para Recurrentes, la recurrente que la cubre (entonces no avisa).
--   4. LO APRENDIDO: «Dime qué es» puede recordar el remitente
--      (company_inbound_sender, decisión «tipo» con su doc_kind).
--   5. LOS AJUSTES: «Lo que falta» encendido o apagado por empresa, y su margen.
--   5b. LO QUE NO ES UN PDF NI UNA FOTO (un extracto, un Excel, un zip): a su
--      propio almacén privado, conta-entrada, con las mismas reglas que
--      receipt-uploads (la carpeta de la cuenta), y la bandeja lo admite.
--   5c. «FACTURAS RECIBIDAS» (conta_documentos_recibidos, CAMBIA en caliente,
--      misma firma, copia byte a byte de la de producción del 25/10 con dos
--      cambios): lo que la puerta sabe que no es factura (un extracto, una
--      nómina…) no sale ahí como «por aclarar», sale en su sitio; y la dirección
--      que enseña es la única de la empresa si la tiene.
--   6. LAS FUNCIONES de la pantalla (conta_puerta_*): la puerta, las fuentes
--      con sus llegadas, aprender las fuentes de lo que ya pasa, guardar una,
--      «Dime qué es», «Pedírsela» para una fuente sin proveedor y guardar lo
--      que se sube sin saber qué es (conta_puerta_subida).
--
-- El cálculo de qué falta, con qué retraso y qué está aún a tiempo vive en el
-- front (lib/puerta.ts, probado con las fuentes reales de Foodint): la base da
-- las fuentes y las fechas en que ha llegado algo de cada una.
--
-- No toca datos: ninguna fila existente cambia. No está en el camino del pedido.
--
-- cambia: public.company_inbound_address · prueba: supabase/staging/sql/20261025_v02_puerta_prueba.sql
-- cambia: public.supplier_expected_invoice · prueba: supabase/staging/sql/20261025_v02_puerta_prueba.sql
-- cambia: public.supplier_invoice_request · prueba: supabase/staging/sql/20261025_v02_puerta_prueba.sql
-- cambia: public.conta_documentos_recibidos · prueba: supabase/staging/sql/20261025_v02_puerta_prueba.sql
-- cambia: public.company_inbound_sender · prueba: supabase/staging/sql/20261025_v02_puerta_prueba.sql
-- cambia: public.conta_direccion_entrada · prueba: supabase/staging/sql/20261025_v02_puerta_prueba.sql
-- cambia: public.conta_entrada_remitente · prueba: supabase/staging/sql/20261025_v02_puerta_prueba.sql
-- cambia: public.document_inbox · prueba: supabase/staging/sql/20261025_v02_puerta_prueba.sql
--
-- Vuelta atrás: supabase/vuelta-atras/20261025T1212_v02_puerta.down.sql

-- 1 · Una dirección por empresa ------------------------------------------------
alter table public.company_inbound_address drop constraint if exists company_inbound_address_kind_check;
alter table public.company_inbound_address add constraint company_inbound_address_kind_check
  check (kind = any (array['facturas'::text, 'liquidaciones'::text, 'documentos'::text]));
alter table public.company_inbound_address drop constraint if exists company_inbound_address_local_part_check;
alter table public.company_inbound_address add constraint company_inbound_address_local_part_check
  check (case when kind = 'documentos' then local_part ~ '^[a-z0-9][a-z0-9-]{1,40}$'
              else local_part ~ (('^'::text || kind) || '-[a-z0-9][a-z0-9-]{1,40}$'::text) end);

create or replace function public.conta_direccion_entrada(p_company uuid, p_tipo text, p_quien_nombre text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_c public.company;
  v_base text; v_lp text; v_i int := 1;
  v_x public.company_inbound_address;
begin
  if p_tipo not in ('facturas', 'liquidaciones', 'documentos') then raise exception 'Una dirección es de documentos, de facturas o de liquidaciones.' using errcode = '22023'; end if;
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
  -- V02: la de documentos va sin prefijo («foodint@»); las de antes, con el suyo.
  v_lp := case when p_tipo = 'documentos' then v_base else p_tipo || '-' || v_base end;
  while exists (select 1 from public.company_inbound_address where lower(local_part) = v_lp and domain = 'entrada.folvy.app') loop
    v_i := v_i + 1; v_lp := case when p_tipo = 'documentos' then v_base else p_tipo || '-' || v_base end || '-' || v_i;
  end loop;
  insert into public.company_inbound_address (account_id, company_id, kind, local_part, created_by, created_by_name)
  values (v_c.account_id, v_c.id, p_tipo, v_lp, auth.uid(), p_quien_nombre) returning * into v_x;
  return to_jsonb(v_x) || jsonb_build_object('direccion', v_x.local_part || '@' || v_x.domain, 'ya_estaba', false);
end $function$;

-- 2 · Qué es cada documento ----------------------------------------------------
alter table public.document_inbox add column if not exists doc_kind text
  constraint document_inbox_doc_kind_check check (doc_kind is null or doc_kind in ('factura', 'ticket', 'liquidacion', 'extracto', 'nomina', 'riders', 'otro'));
alter table public.document_inbox add column if not exists doc_kind_by text
  constraint document_inbox_doc_kind_by_check check (doc_kind_by is null or doc_kind_by in ('regla', 'lectura', 'persona'));
alter table public.document_inbox add column if not exists expected_id uuid
  references public.supplier_expected_invoice(id) on delete set null;
comment on column public.document_inbox.doc_kind is
  'V02 · Qué es el documento (factura, ticket, liquidación, extracto, nómina, facturas de riders u otro). Nulo: aún sin saber; sale en «Necesita que lo mires».';

-- 2b · Lo que no es un PDF ni una foto, a su almacén --------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('conta-entrada', 'conta-entrada', false, 10485760,
        array['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel',
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/x-zip-compressed',
              'application/xml', 'text/xml', 'application/octet-stream'])
on conflict (id) do nothing;
-- Las reglas, como las de receipt-uploads (se puede pasar dos veces).
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'conta_entrada_select') then
    create policy conta_entrada_select on storage.objects for select
      using (bucket_id = 'conta-entrada' and public.belongs_to_account(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'conta_entrada_insert') then
    create policy conta_entrada_insert on storage.objects for insert
      with check (bucket_id = 'conta-entrada' and public.belongs_to_account(((storage.foldername(name))[1])::uuid));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'conta_entrada_delete') then
    create policy conta_entrada_delete on storage.objects for delete
      using (bucket_id = 'conta-entrada' and public.current_user_is_admin_or_manager_of(((storage.foldername(name))[1])::uuid));
  end if;
end $$;
alter table public.document_inbox drop constraint if exists document_inbox_file_bucket_check;
alter table public.document_inbox add constraint document_inbox_file_bucket_check
  check (file_bucket = any (array['receipt-uploads'::text, 'conta-entrada'::text]));

-- 3 · Lo que se espera, de cualquier fuente ---------------------------------------
alter table public.supplier_expected_invoice alter column supplier_id drop not null;
alter table public.supplier_expected_invoice drop constraint if exists supplier_expected_invoice_cadence_check;
alter table public.supplier_expected_invoice add constraint supplier_expected_invoice_cadence_check
  check (cadence = any (array['mensual'::text, 'quincenal'::text, 'semanal'::text, 'varias'::text]));
alter table public.supplier_expected_invoice add column if not exists kind text not null default 'proveedor'
  constraint supplier_expected_invoice_kind_check check (kind in ('proveedor', 'alquiler', 'riders', 'nominas', 'banco', 'intermediario', 'otro'));
alter table public.supplier_expected_invoice add column if not exists margin_days smallint
  constraint supplier_expected_invoice_margin_check check (margin_days is null or margin_days between 0 and 60);
alter table public.supplier_expected_invoice add column if not exists weekday smallint
  constraint supplier_expected_invoice_weekday_check check (weekday is null or weekday between 1 and 7);
alter table public.supplier_expected_invoice add column if not exists gap_days smallint
  constraint supplier_expected_invoice_gap_check check (gap_days is null or gap_days between 1 and 90);
alter table public.supplier_expected_invoice add column if not exists group_label text;
alter table public.supplier_expected_invoice add column if not exists source_key text;
alter table public.supplier_expected_invoice add column if not exists match jsonb not null default '{}'::jsonb;
alter table public.supplier_expected_invoice add column if not exists covered_by_recurring_id uuid
  references public.recurring_contract(id) on delete set null;
alter table public.supplier_expected_invoice add column if not exists updated_at timestamptz;
alter table public.supplier_expected_invoice add column if not exists updated_by_name text;
create unique index if not exists supplier_expected_invoice_clave_uq on public.supplier_expected_invoice (company_id, source_key) where source_key is not null;
comment on column public.supplier_expected_invoice.covered_by_recurring_id is
  'V02 · Preparado para Recurrentes: si una recurrente cubre la fuente, «Lo que falta» no avisa; lo que llega de verdad se engancha a lo esperado para sustituirla (document_inbox.expected_id).';
comment on column public.supplier_expected_invoice.match is
  'V02 · Cómo se reconoce lo que llega de una fuente sin proveedor: {"nifs":[…]}, {"numero_prefijo":"ES I"}, {"canal":"<sales_channel.id>"}, {"tesoreria":"<treasury_account.id>"}, {"nominas":true}.';

alter table public.supplier_invoice_request alter column supplier_id drop not null;
create unique index if not exists supplier_invoice_request_fuente_mes_uq on public.supplier_invoice_request (expected_id, period)
  where supplier_id is null and status = any (array['confirmado'::text, 'enviado'::text]);

-- 4 · Lo aprendido de un remitente -----------------------------------------------
alter table public.company_inbound_sender add column if not exists doc_kind text
  constraint company_inbound_sender_doc_kind_check check (doc_kind is null or doc_kind in ('factura', 'ticket', 'liquidacion', 'extracto', 'nomina', 'riders', 'otro'));
alter table public.company_inbound_sender drop constraint if exists company_inbound_sender_decision_check;
alter table public.company_inbound_sender add constraint company_inbound_sender_decision_check
  check (decision = any (array['no_facturas'::text, 'tipo'::text]));

create or replace function public.conta_entrada_remitente(p_company uuid, p_from text)
returns jsonb language sql stable security definer set search_path to 'public' as $function$
  select jsonb_build_object('decision', s.decision, 'motivo', s.reason, 'tipo', s.doc_kind)
    from public.company_inbound_sender s
   where s.company_id = p_company
     and s.sender_sha256 = encode(sha256(convert_to(lower(btrim(coalesce(substring(p_from from '<([^>]+)>'), p_from, ''))), 'UTF8')), 'hex')
$function$;

-- 5 · Los ajustes de la puerta -------------------------------------------------
-- Sin claves ajenas a company ni a accounts, a propósito: crearlas o quitarlas
-- (la vuelta atrás) bloquea en exclusiva las dos tablas que más se leen, y en
-- staging se cruzó con una e2e (interbloqueo con accounts, 25/10). La empresa
-- y su cuenta las comprueba conta_puerta_ajustes_poner, que es la única que
-- escribe aquí.
create table if not exists public.conta_puerta_ajustes (
  company_id uuid primary key,
  account_id uuid not null,
  lo_que_falta boolean not null default true,
  margen_dias smallint not null default 5 check (margen_dias between 0 and 60),
  updated_at timestamptz not null default now(),
  updated_by_name text
);
comment on table public.conta_puerta_ajustes is
  'V02 · La puerta de cada empresa: si «Lo que falta» avisa y el margen por defecto (días después del día en que suele llegar).';
alter table public.conta_puerta_ajustes enable row level security;
drop policy if exists conta_puerta_ajustes_leer on public.conta_puerta_ajustes;
create policy conta_puerta_ajustes_leer on public.conta_puerta_ajustes for select using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.conta_puerta_ajustes from anon, authenticated;
grant select on public.conta_puerta_ajustes to authenticated;

-- 6 · Las funciones de la pantalla -------------------------------------------------

-- La empresa, con permiso de lectura (o el servidor).
create or replace function public._conta_puerta_cuenta(p_company uuid)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (public.belongs_to_account(v_acc) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  return v_acc;
end $$;
revoke all on function public._conta_puerta_cuenta(uuid) from public, anon, authenticated;

-- Las fechas en que ha llegado algo de una fuente (los últimos 150 días).
create or replace function public._conta_puerta_llegadas(p_x public.supplier_expected_invoice)
returns date[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct d order by d), '{}'::date[]) from (
    -- De un proveedor: sus facturas (las de Sumied y las del libro de recibidas, también las traídas de Diez).
    select i.invoice_date d from public.supplier_invoice i
     where i.account_id = p_x.account_id and i.status <> 'anulada' and i.invoice_date >= current_date - 150
       and (i.supplier_id = p_x.supplier_id
            or i.supplier_id in (select s.id from public.supplier s where s.account_id = p_x.account_id
                                    and s.tax_id = any (array(select jsonb_array_elements_text(coalesce(p_x.match->'nifs', '[]'::jsonb)))))
            or (p_x.match ? 'numero_prefijo' and i.invoice_number like (p_x.match->>'numero_prefijo') || '%'))
    union
    select v.issue_date from public.vat_book_entry v
     where v.account_id = p_x.account_id and v.company_id = p_x.company_id and v.book = 'received' and v.voided_at is null and v.issue_date >= current_date - 150
       and (v.counterpart_tax_id in (select s.tax_id from public.supplier s where s.id = p_x.supplier_id)
            or v.counterpart_tax_id = any (array(select jsonb_array_elements_text(coalesce(p_x.match->'nifs', '[]'::jsonb))))
            or (p_x.match ? 'numero_prefijo' and v.number like (p_x.match->>'numero_prefijo') || '%'))
    -- Riders: la quincena de Catcher subida.
    union
    select b.period_to from public.supplier_batch b
     where p_x.kind = 'riders' and b.account_id = p_x.account_id and b.company_id = p_x.company_id and b.provider = 'catcher' and b.period_to >= current_date - 150
    -- Intermediario: sus liquidaciones (el fin de su periodo).
    union
    select coalesce(c.period_to, c.settlement_date) from public.channel_settlement c
     where p_x.kind = 'intermediario' and c.account_id = p_x.account_id and c.channel_id::text = p_x.match->>'canal'
       and coalesce(c.period_to, c.settlement_date) >= current_date - 150
    -- Banco: el día en que se subió el extracto, o la última sincronización.
    union
    select s.imported_at::date from public.bank_statement s
     where p_x.kind = 'banco' and s.account_id = p_x.account_id and s.company_id = p_x.company_id
       and (p_x.match->>'tesoreria' is null or s.treasury_account_id::text = p_x.match->>'tesoreria') and s.imported_at >= current_date - 150
    union
    select l.last_sync_at::date from public.bank_aggregator_link l
     where p_x.kind = 'banco' and l.account_id = p_x.account_id and l.company_id = p_x.company_id and l.last_sync_at is not null
       and (p_x.match->>'tesoreria' is null or l.treasury_account_id::text = p_x.match->>'tesoreria')
    -- Nóminas: el día en que llegaron.
    union
    select n.created_at::date from public.payroll_inbox n
     where p_x.kind = 'nominas' and n.account_id = p_x.account_id and n.created_at >= current_date - 150
    -- Lo que llegó por la puerta y se enganchó a esta fuente.
    union
    select coalesce(d.email_received_at, d.created_at)::date from public.document_inbox d
     where d.expected_id = p_x.id and d.status <> 'descartado'
  ) x where d is not null
$$;
revoke all on function public._conta_puerta_llegadas(public.supplier_expected_invoice) from public, anon, authenticated;

-- Las fuentes de la empresa, con sus llegadas y su pedida más reciente.
create or replace function public.conta_puerta_fuentes(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company);
begin
  return jsonb_build_object(
    'ajustes', coalesce((select jsonb_build_object('lo_que_falta', a.lo_que_falta, 'margen', a.margen_dias) from public.conta_puerta_ajustes a where a.company_id = p_company),
                        jsonb_build_object('lo_que_falta', true, 'margen', 5)),
    'fuentes', coalesce((select jsonb_agg(jsonb_build_object(
        'id', x.id, 'clave', x.source_key, 'tipo', x.kind, 'nombre', coalesce(x.label, s.name, 'Sin nombre'), 'grupo', x.group_label,
        'proveedor_id', x.supplier_id, 'cadencia', x.cadence, 'dia', x.typical_day, 'dia_semana', x.weekday, 'cada', x.gap_days,
        'margen', x.margin_days, 'activa', x.active, 'origen', x.source, 'cubierta', x.covered_by_recurring_id is not null,
        'llegadas', to_jsonb(public._conta_puerta_llegadas(x)),
        'pedida', (select jsonb_build_object('periodo', r.period, 'estado', r.status, 'a', r.to_email) from public.supplier_invoice_request r
                    where r.expected_id = x.id or (x.supplier_id is not null and r.supplier_id = x.supplier_id)
                    order by r.created_at desc limit 1))
      order by x.group_label nulls last, coalesce(x.label, s.name))
      from public.supplier_expected_invoice x left join public.supplier s on s.id = x.supplier_id
     where x.company_id = p_company and x.account_id = v_acc), '[]'::jsonb));
end $$;
revoke all on function public.conta_puerta_fuentes(uuid) from public, anon;
grant execute on function public.conta_puerta_fuentes(uuid) to authenticated;

-- Lo que ya pasa en la empresa, como fuentes (sin guardar nada): los
-- proveedores que mandan algo en al menos 6 de los últimos 9 meses y siguen
-- activos; los riders (números «ES I…», una sola fuente); los intermediarios
-- con liquidaciones; los extractos del banco; y las nóminas.
create or replace function public.conta_puerta_fuentes_proponer(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company); v_desde date := (date_trunc('month', current_date) - interval '9 months')::date;
begin
  return coalesce((select jsonb_agg(x order by x->>'tipo', x->>'nombre') from (
    -- Proveedores con un ritmo (sin los riders, que van juntos).
    select jsonb_build_object(
      'clave', 'nif:' || r.nif, 'tipo', case when r.alquiler then 'alquiler' else 'proveedor' end,
      'nombre', r.nombre, 'proveedor_id', r.supplier_id, 'nifs', jsonb_build_array(r.nif),
      -- Los alquileres, juntos y sin nombres en pantalla (suelen ser personas): el
      -- local de cada uno lo dice la persona («Alquiler · Cañaveral 75»).
      'grupo', case when r.alquiler then 'Alquileres' end,
      'cadencia', case when r.por_mes > 1.5 then 'varias' else 'mensual' end,
      'dia', case when r.por_mes > 1.5 then null else r.dia end, 'cada', case when r.por_mes > 1.5 then 10 end,
      'meses', r.meses, 'por_mes', r.por_mes) as x
      from (
        select v.counterpart_tax_id nif, max(v.counterpart_name) nombre,
               count(distinct date_trunc('month', v.issue_date)) meses,
               round(count(distinct v.entry_id)::numeric / nullif(count(distinct date_trunc('month', v.issue_date)), 0), 1) por_mes,
               percentile_disc(0.5) within group (order by extract(day from v.issue_date)::int) dia,
               max(v.issue_date) ultima,
               (select s.id from public.supplier s where s.account_id = v_acc and s.tax_id = v.counterpart_tax_id order by s.created_at limit 1) supplier_id,
               -- Un alquiler: su gasto va a la 621 (arrendamientos), según su asiento.
               bool_or(exists (select 1 from public.journal_line l join public.company_account a on a.id = l.company_account_id
                                where l.entry_id = v.entry_id and a.code like '621%')) alquiler
          from public.vat_book_entry v
         where v.account_id = v_acc and v.company_id = p_company and v.book = 'received' and v.voided_at is null
           and v.issue_date >= v_desde and coalesce(v.counterpart_tax_id, '') <> '' and coalesce(v.number, '') not like 'ES I%'
         group by v.counterpart_tax_id
      ) r
     where r.meses >= 6 and r.ultima >= (date_trunc('month', current_date) - interval '2 months')::date
    union all
    -- Los riders: una sola fuente, quincenal.
    select jsonb_build_object('clave', 'riders', 'tipo', 'riders', 'nombre', 'Riders de Catcher', 'cadencia', 'quincenal',
                              'numero_prefijo', 'ES I', 'facturas', count(*), 'personas', count(distinct v.counterpart_tax_id))
      from public.vat_book_entry v
     where v.account_id = v_acc and v.company_id = p_company and v.book = 'received' and v.voided_at is null
       and v.issue_date >= v_desde and v.number like 'ES I%'
    having count(*) > 0
    union all
    -- Intermediarios con liquidaciones en los últimos 4 meses.
    select jsonb_build_object('clave', 'canal:' || c.channel_id, 'tipo', 'intermediario', 'nombre', coalesce(ch.name, 'Intermediario') || ' · liquidaciones',
                              'canal', c.channel_id,
                              -- El ritmo de su ÚLTIMO periodo, no el más repetido: el histórico importado
                              -- (mensual, una fila por tienda) pesaba más que los resúmenes semanales de
                              -- Uber que entran desde el 11/10 (medido el 25/10). Empate el mismo día: el más fino.
                              'cadencia', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then 'semanal' when c.period_grain = 'quincena' then 'quincenal' else 'mensual' end
                                                     order by coalesce(c.period_to, c.settlement_date) desc,
                                                              case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              -- El día de la semana en que acaba su último periodo (Uber: el domingo) y, si es semanal, 1 día de margen (Julio, 25/10).
                              'dia_semana', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then extract(isodow from coalesce(c.period_to, c.settlement_date))::int end
                                                       order by coalesce(c.period_to, c.settlement_date) desc,
                                                                case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              'margen', (array_agg(case when c.period_grain in ('week', 'weeks', 'semana') then 1 end
                                                   order by coalesce(c.period_to, c.settlement_date) desc,
                                                            case when c.period_grain in ('week', 'weeks', 'semana') then 0 when c.period_grain = 'quincena' then 1 else 2 end))[1],
                              'liquidaciones', count(*))
      from public.channel_settlement c left join public.sales_channel ch on ch.id = c.channel_id and ch.account_id = c.account_id
     where c.account_id = v_acc and coalesce(c.is_reference, false) = false and coalesce(c.period_to, c.settlement_date) >= current_date - 120
     group by c.channel_id, ch.name
    union all
    -- El banco: cada cuenta con extractos o conexión.
    select jsonb_build_object('clave', 'banco:' || t.id, 'tipo', 'banco', 'nombre', 'Extracto · ' || coalesce(t.short_name, t.name, 'banco'),
                              'tesoreria', t.id, 'cadencia', 'semanal')
      from public.treasury_account t
     where t.company_id = p_company and t.account_id = v_acc and t.is_active
       and (exists (select 1 from public.bank_statement s where s.treasury_account_id = t.id)
            or exists (select 1 from public.bank_aggregator_link l where l.treasury_account_id = t.id))
    union all
    -- Las nóminas, si la cuenta las recibe (Laboral).
    select jsonb_build_object('clave', 'nominas', 'tipo', 'nominas', 'nombre', 'Nóminas' || coalesce(' · ' || p.gestoria_name, ''),
                              'cadencia', 'mensual', 'dia', 5)
      from public.payroll_settings p where p.account_id = v_acc
  ) z), '[]'::jsonb);
end $$;
revoke all on function public.conta_puerta_fuentes_proponer(uuid) from public, anon;
grant execute on function public.conta_puerta_fuentes_proponer(uuid) to authenticated;

-- Guardar una fuente (nueva o cambiada). p: { id?, clave?, tipo, nombre, grupo,
-- proveedor_id, cadencia, dia, dia_semana, cada, margen, activa, nifs,
-- numero_prefijo, canal, tesoreria }.
create or replace function public.conta_puerta_fuente_guardar(p_company uuid, p jsonb, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid := public._conta_puerta_cuenta(p_company);
  v_x public.supplier_expected_invoice;
  v_match jsonb;
  v_nuevo boolean := false;
begin
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado cambia lo que se espera.' using errcode = '42501';
  end if;
  if coalesce(p->>'cadencia', 'mensual') not in ('mensual', 'quincenal', 'semanal', 'varias') then
    raise exception 'Cada cuánto llega: mensual, quincenal, semanal o varias al mes.' using errcode = '22023';
  end if;
  if p->>'proveedor_id' is not null and not exists (select 1 from public.supplier where id = (p->>'proveedor_id')::uuid and account_id = v_acc) then
    raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '42501';
  end if;
  v_match := jsonb_strip_nulls(jsonb_build_object('nifs', p->'nifs', 'numero_prefijo', p->>'numero_prefijo', 'canal', p->>'canal',
                                                  'tesoreria', p->>'tesoreria', 'nominas', case when p->>'tipo' = 'nominas' then true end));
  if p->>'id' is not null then
    select * into v_x from public.supplier_expected_invoice where id = (p->>'id')::uuid and company_id = p_company;
    if v_x.id is null then raise exception 'Esa fuente no está.' using errcode = 'P0002'; end if;
  elsif p->>'clave' is not null then
    select * into v_x from public.supplier_expected_invoice where company_id = p_company and source_key = p->>'clave';
  end if;
  if v_x.id is null then
    insert into public.supplier_expected_invoice (account_id, company_id, supplier_id, cadence, typical_day, label, source, reason, active, since,
                                                  kind, margin_days, weekday, gap_days, group_label, source_key, match, created_by, created_by_name)
    values (v_acc, p_company, (p->>'proveedor_id')::uuid, coalesce(p->>'cadencia', 'mensual'), nullif(p->>'dia', '')::smallint, p->>'nombre',
            case when p->>'clave' is not null then 'aprendido' else 'a_mano' end, p->>'motivo', coalesce((p->>'activa')::boolean, true), current_date,
            coalesce(p->>'tipo', 'proveedor'), nullif(p->>'margen', '')::smallint, nullif(p->>'dia_semana', '')::smallint, nullif(p->>'cada', '')::smallint,
            nullif(btrim(p->>'grupo'), ''), p->>'clave', v_match, auth.uid(), p_quien_nombre)
    returning * into v_x;
    v_nuevo := true;
  else
    update public.supplier_expected_invoice set
      label = coalesce(p->>'nombre', label),
      group_label = case when p ? 'grupo' then nullif(btrim(p->>'grupo'), '') else group_label end,
      cadence = coalesce(p->>'cadencia', cadence),
      typical_day = case when p ? 'dia' then nullif(p->>'dia', '')::smallint else typical_day end,
      weekday = case when p ? 'dia_semana' then nullif(p->>'dia_semana', '')::smallint else weekday end,
      gap_days = case when p ? 'cada' then nullif(p->>'cada', '')::smallint else gap_days end,
      margin_days = case when p ? 'margen' then nullif(p->>'margen', '')::smallint else margin_days end,
      active = coalesce((p->>'activa')::boolean, active),
      match = case when v_match = '{}'::jsonb then match else v_match end,
      updated_at = now(), updated_by_name = p_quien_nombre
     where id = v_x.id returning * into v_x;
  end if;
  return jsonb_build_object('id', v_x.id, 'nueva', v_nuevo, 'activa', v_x.active,
    'texto', case when v_nuevo then 'Apuntado: ' || coalesce(v_x.label, 'la fuente') || ' se espera ' || v_x.cadence || '.'
                  when not v_x.active then 'Apagado: ' || coalesce(v_x.label, 'la fuente') || ' ya no avisa si falta.'
                  else 'Guardado: ' || coalesce(v_x.label, 'la fuente') || '.' end);
end $$;
revoke all on function public.conta_puerta_fuente_guardar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_puerta_fuente_guardar(uuid, jsonb, text) to authenticated;

-- Encender o apagar «Lo que falta» en la empresa, y su margen.
create or replace function public.conta_puerta_ajustes_poner(p_company uuid, p_lo_que_falta boolean, p_margen smallint, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company);
begin
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado cambia los ajustes de la puerta.' using errcode = '42501';
  end if;
  insert into public.conta_puerta_ajustes (company_id, account_id, lo_que_falta, margen_dias, updated_by_name)
  values (p_company, v_acc, coalesce(p_lo_que_falta, true), coalesce(p_margen, 5), p_quien_nombre)
  on conflict (company_id) do update set lo_que_falta = excluded.lo_que_falta, margen_dias = excluded.margen_dias, updated_at = now(), updated_by_name = excluded.updated_by_name;
  return jsonb_build_object('lo_que_falta', coalesce(p_lo_que_falta, true), 'margen', coalesce(p_margen, 5),
    'texto', case when coalesce(p_lo_que_falta, true) then 'Encendido: «Lo que falta» avisa con ' || coalesce(p_margen, 5) || ' días de margen.'
                  else 'Apagado: «Lo que falta» ya no avisa en esta empresa.' end);
end $$;
revoke all on function public.conta_puerta_ajustes_poner(uuid, boolean, smallint, text) from public, anon;
grant execute on function public.conta_puerta_ajustes_poner(uuid, boolean, smallint, text) to authenticated;

-- La puerta: la dirección, las cifras y lo último que ha llegado, por cualquier
-- camino (correo, subido, la quincena de Catcher, los extractos, las
-- liquidaciones y las nóminas), con dónde está cada cosa.
create or replace function public.conta_puerta(p_company uuid, p_dias int default 30)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company); v_desde timestamptz := now() - make_interval(days => greatest(1, least(p_dias, 120)));
begin
  return jsonb_build_object(
    'direcciones', coalesce((select jsonb_agg(jsonb_build_object('tipo', a.kind, 'direccion', a.local_part || '@' || a.domain, 'activa', a.active) order by a.kind)
                              from public.company_inbound_address a where a.company_id = p_company), '[]'::jsonb),
    'conectados', jsonb_build_object(
       'bancos', coalesce((select jsonb_agg(jsonb_build_object('proveedor', l.provider, 'estado', l.status, 'ultima', l.last_sync_at))
                            from public.bank_aggregator_link l where l.company_id = p_company), '[]'::jsonb),
       'uber_por_correo', exists (select 1 from public.company_inbound_address a where a.company_id = p_company and a.kind = 'liquidaciones' and a.active)),
    'ultimos', coalesce((select jsonb_agg(u order by u->>'cuando' desc) from (
      -- La bandeja: lo que llegó por correo o se subió (salvo lo que ya cuenta su lote de Catcher).
      select jsonb_build_object('id', d.id, 'fuente', 'bandeja', 'cuando', coalesce(d.email_received_at, d.created_at),
               'por', case d.channel when 'correo' then 'correo' when 'subida' then 'subido' when 'cocina' then 'cocina' else 'subido' end,
               'que', coalesce(d.doc_kind, case when d.status in ('factura', 'repetida') then 'factura' end),
               'que_por', d.doc_kind_by,
               'de', coalesce(s.name, case when d.channel = 'correo' then d.email_from end, d.file_name),
               'importe', i.grand_total, 'estado', d.status, 'motivo', d.reason,
               'donde', case when d.supplier_invoice_id is not null then 'factura'
                             when d.doc_kind = 'extracto' then 'bancos' when d.doc_kind = 'liquidacion' then 'liquidaciones'
                             when d.doc_kind = 'nomina' then 'laboral' when d.doc_kind = 'riders' then 'riders' end,
               'factura_id', d.supplier_invoice_id, 'nombre', d.file_name) u
        from public.document_inbox d
        left join public.supplier_invoice i on i.id = d.supplier_invoice_id
        left join public.supplier s on s.id = i.supplier_id
       where d.company_id = p_company and d.account_id = v_acc and d.created_at >= v_desde and d.status <> 'descartado'
         and not (d.channel = 'portal' and d.supplier_invoice_id is not null
                  and exists (select 1 from public.supplier_invoice x where x.id = d.supplier_invoice_id and x.batch_id is not null))
      union all
      -- La quincena de Catcher, como un solo documento.
      select jsonb_build_object('id', b.id, 'fuente', 'catcher', 'cuando', b.created_at, 'por', 'subido', 'que', 'riders',
               'de', 'Catcher · ' || to_char(b.period_from, 'DD/MM') || '–' || to_char(b.period_to, 'DD/MM'),
               'importe', b.grand_total,
               'estado', 'colocado', 'donde', 'riders', 'facturas', b.invoice_count)
        from public.supplier_batch b where b.company_id = p_company and b.account_id = v_acc and b.provider = 'catcher' and b.created_at >= v_desde
      union all
      -- Los extractos del banco.
      select jsonb_build_object('id', s.id, 'fuente', 'extracto', 'cuando', s.imported_at, 'por', case when s.source = 'fichero' then 'subido' else 'conexion' end,
               'que', 'extracto', 'de', coalesce((select coalesce(t.short_name, t.name) from public.treasury_account t where t.id = s.treasury_account_id), 'Banco')
                                   || ' · ' || coalesce(s.movements_count, 0) || ' mov.', 'importe', null, 'estado', 'colocado', 'donde', 'bancos')
        from public.bank_statement s where s.company_id = p_company and s.account_id = v_acc and s.imported_at >= v_desde
      union all
      -- Las liquidaciones.
      select jsonb_build_object('id', c.id, 'fuente', 'liquidacion', 'cuando', c.created_at,
               'por', case when c.source like 'correo%' then 'correo' else 'subido' end, 'que', 'liquidacion',
               'de', coalesce(ch.name, 'Plataforma') || coalesce(' · ' || nullif(c.external_brand_text, ''), ''), 'importe', c.net_payout,
               'estado', 'colocado', 'donde', 'liquidaciones')
        from public.channel_settlement c left join public.sales_channel ch on ch.id = c.channel_id and ch.account_id = c.account_id
       where c.account_id = v_acc and c.created_at >= v_desde and coalesce(c.is_reference, false) = false
      union all
      -- Las nóminas.
      select jsonb_build_object('id', n.id, 'fuente', 'nomina', 'cuando', n.created_at, 'por', 'correo', 'que', 'nomina',
               'de', 'Nómina ' || lpad(n.period_month::text, 2, '0') || '/' || n.period_year, 'importe', n.total_cost,
               'estado', case when n.status = 'matched' then 'colocado' else n.status end, 'donde', 'laboral')
        from public.payroll_inbox n where n.account_id = v_acc and n.created_at >= v_desde
    ) z), '[]'::jsonb));
end $$;
revoke all on function public.conta_puerta(uuid, int) from public, anon;
grant execute on function public.conta_puerta(uuid, int) to authenticated;

-- «Dime qué es»: lo dice la persona y, si quiere, se recuerda por su remitente.
create or replace function public.conta_puerta_dime_que_es(p_inbox uuid, p_tipo text, p_recordar boolean, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.document_inbox; v_from text; v_recordado boolean := false; v_que text;
begin
  select * into v_d from public.document_inbox where id = p_inbox;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Ese documento no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then
    raise exception 'Solo un administrador o un encargado dice qué es un documento.' using errcode = '42501';
  end if;
  if p_tipo not in ('factura', 'ticket', 'liquidacion', 'extracto', 'nomina', 'riders', 'otro') then
    raise exception 'Un documento es una factura, un ticket, una liquidación, un extracto, una nómina, facturas de riders u otra cosa.' using errcode = '22023';
  end if;
  v_que := case p_tipo when 'factura' then 'una factura' when 'ticket' then 'un ticket' when 'liquidacion' then 'una liquidación'
                       when 'extracto' then 'un extracto del banco' when 'nomina' then 'una nómina' when 'riders' then 'una quincena de riders'
                       else 'otra cosa' end;
  update public.document_inbox set doc_kind = p_tipo, doc_kind_by = 'persona', updated_at = now() where id = p_inbox;
  v_from := lower(btrim(coalesce(substring(v_d.email_from from '<([^>]+)>'), v_d.email_from, '')));
  if p_recordar and v_d.company_id is not null and v_from <> '' then
    insert into public.company_inbound_sender (account_id, company_id, sender_sha256, decision, reason, doc_kind)
    values (v_d.account_id, v_d.company_id, encode(sha256(convert_to(v_from, 'UTF8')), 'hex'), 'tipo',
            'Lo dijo ' || coalesce(p_quien_nombre, 'una persona') || ' en la puerta: lo que manda es ' || v_que || '.', p_tipo)
    on conflict (company_id, sender_sha256) do update set decision = 'tipo', doc_kind = excluded.doc_kind, reason = excluded.reason;
    v_recordado := true;
  end if;
  insert into public.document_activity (account_id, company_id, inbox_id, actor, actor_name, action, text, detail)
  values (v_d.account_id, v_d.company_id, p_inbox, 'persona', p_quien_nombre, 'corregida',
          'Es ' || v_que || case when v_recordado then '; lo que llegue de ese remitente irá igual' else '' end || '.',
          jsonb_build_object('campo', 'tipo', 'tipo', p_tipo, 'recordado', v_recordado));
  return jsonb_build_object('id', p_inbox, 'tipo', p_tipo, 'recordado', v_recordado,
    'texto', 'Apuntado: es ' || v_que
             || case when v_recordado then '. Lo que llegue de ese remitente irá igual.' else '.' end);
end $$;
revoke all on function public.conta_puerta_dime_que_es(uuid, text, boolean, text) from public, anon;
grant execute on function public.conta_puerta_dime_que_es(uuid, text, boolean, text) to authenticated;

-- El servidor apunta qué es lo que acaba de llegar (por su regla o su lectura).
create or replace function public.conta_entrada_tipo(p_inbox uuid, p_tipo text, p_por text)
returns void language sql security definer set search_path = public as $$
  update public.document_inbox set doc_kind = p_tipo, doc_kind_by = p_por, updated_at = now()
   where id = p_inbox and (doc_kind_by is distinct from 'persona')
$$;
revoke all on function public.conta_entrada_tipo(uuid, text, text) from public, anon, authenticated;

-- «Pedírsela» a una fuente sin proveedor (la gestoría, los riders…): la
-- petición queda CONFIRMADA por la persona; el correo lo manda ella desde el
-- suyo (como conta_factura_pedir: nada sale solo).
create or replace function public.conta_puerta_pedir(p_expected uuid, p_periodo date, p_email text, p_asunto text, p_cuerpo text, p_quien_nombre text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_x public.supplier_expected_invoice; v_id uuid; v_mes date := date_trunc('month', p_periodo)::date; v_email text := lower(trim(coalesce(p_email, '')));
begin
  select * into v_x from public.supplier_expected_invoice where id = p_expected;
  if v_x.id is null or not public.current_user_is_admin_or_manager_of(v_x.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta pide documentos.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Esa dirección de correo no es válida.' using errcode = '22023'; end if;
  if coalesce(trim(p_quien_nombre), '') = '' then raise exception 'Falta quién lo pide: sin persona no se confirma.' using errcode = '22023'; end if;
  select id into v_id from public.supplier_invoice_request
   where (expected_id = p_expected or (v_x.supplier_id is not null and supplier_id = v_x.supplier_id)) and period = v_mes and status in ('confirmado', 'enviado');
  if v_id is not null then return jsonb_build_object('id', v_id, 'ya_estaba', true, 'texto', 'Ya estaba pedida este mes.'); end if;
  insert into public.supplier_invoice_request (account_id, company_id, supplier_id, expected_id, period, to_email, subject, body, status, confirmed_at, confirmed_by, confirmed_by_name)
  values (v_x.account_id, v_x.company_id, v_x.supplier_id, v_x.id, v_mes, v_email, coalesce(nullif(trim(p_asunto), ''), 'Documento pendiente'), coalesce(p_cuerpo, ''),
          'confirmado', now(), auth.uid(), p_quien_nombre)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'ya_estaba', false, 'texto', 'Pedida a ' || v_email || ': se abre tu correo con el texto para que lo mandes tú.');
end $$;
revoke all on function public.conta_puerta_pedir(uuid, date, text, text, text, text) from public, anon;
grant execute on function public.conta_puerta_pedir(uuid, date, text, text, text, text) to authenticated;

-- Lo que se sube por la puerta y no es un PDF ni una foto (ni un extracto ni la
-- quincena de Catcher, que van por sus caminos): al almacén conta-entrada, sin
-- saber qué es («Necesita que lo mires»). Gemela de conta_subida_registrar, que
-- no se toca: misma cuenta, mismo permiso, misma huella para no repetir.
create or replace function public.conta_puerta_subida(p_company uuid, p_ruta text, p_nombre text, p_tipo text, p_bytes integer, p_sha256 text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public, storage as $$
declare v_acc uuid := public._conta_puerta_cuenta(p_company); v_id uuid; v_ya uuid;
begin
  if not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta sube documentos.' using errcode = '42501';
  end if;
  if p_ruta is null or left(p_ruta, 37) <> v_acc::text || '/' then raise exception 'La ruta no es de la carpeta de esta cuenta.' using errcode = '22023'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'La huella del fichero no es un sha256.' using errcode = '22023'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'conta-entrada' and o.name = p_ruta) then
    raise exception 'El fichero no está subido (%).', p_ruta using errcode = 'P0002';
  end if;
  select id into v_ya from public.document_inbox where account_id = v_acc and sha256 = p_sha256 and status <> 'descartado' limit 1;
  if v_ya is not null then return jsonb_build_object('id', v_ya, 'ya_estaba', true, 'texto', coalesce(p_nombre, 'Ese documento') || ' ya estaba: no lo apunto dos veces.'); end if;
  insert into public.document_inbox (account_id, company_id, channel, file_bucket, file_path, file_name, mime_type, size_bytes, sha256, created_by, created_by_name)
  values (v_acc, p_company, 'subida', 'conta-entrada', p_ruta, p_nombre, p_tipo, p_bytes, p_sha256, auth.uid(), p_quien_nombre)
  returning id into v_id;
  insert into public.document_activity (account_id, company_id, inbox_id, actor, actor_name, action, text)
  values (v_acc, p_company, v_id, 'persona', coalesce(p_quien_nombre, 'Alguien de la cuenta'), 'recibida', coalesce(p_quien_nombre, 'Alguien') || ' ha subido ' || coalesce(p_nombre, 'un documento') || ' a la puerta.');
  return jsonb_build_object('id', v_id, 'ya_estaba', false, 'texto', coalesce(p_nombre, 'El documento') || ': guardado. Dime qué es y lo llevo a su sitio.');
end $$;
revoke all on function public.conta_puerta_subida(uuid, text, text, text, integer, text, text) from public, anon;
grant execute on function public.conta_puerta_subida(uuid, text, text, text, integer, text, text) to authenticated;

-- 5c. Facturas recibidas: sin lo que la puerta sabe que no es factura.
create or replace function public.conta_documentos_recibidos(p_company uuid, p_desde date, p_hasta date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_acc uuid;
  v_hoy date := (now() at time zone 'Europe/Madrid')::date;
  v_filas jsonb;
  v_esperadas jsonb;
  v_correo record;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not public.belongs_to_account(v_acc) then
    raise exception 'Esa empresa no es tuya.' using errcode = '42501';
  end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde then
    raise exception 'El periodo no es válido.' using errcode = '22023';
  end if;

  with facturas as (
    select i.*, s.name as proveedor_nombre,
           (select jsonb_build_object('id', e.id, 'estado', e.status, 'solo', coalesce(e.validated_by_name, '') like 'Folvy (apunta solo%')
              from public.journal_entry e
             where e.account_id = v_acc and e.company_id = p_company and e.source_type = 'supplier_invoice' and e.source_id = i.id
               and e.status in ('propuesto', 'borrador', 'validado')
             order by (e.status = 'validado') desc, e.created_at desc limit 1) as asiento,
           (select jsonb_build_object('fecha', gr.receipt_date, 'local', l.name)
              from public.supplier_invoice_receipt r join public.goods_receipt gr on gr.id = r.goods_receipt_id
              left join public.locations l on l.id = gr.location_id
             where r.supplier_invoice_id = i.id order by gr.receipt_date desc limit 1) as recepcion,
           -- R5 · 6: cuántas facturas suyas había antes de esta (para decir «es la primera»).
           (select count(*) from public.supplier_invoice p
             where p.account_id = v_acc and p.supplier_id = i.supplier_id and p.id <> i.id and p.status not in ('anulada', 'descartada')
               and (coalesce(p.invoice_date, (p.created_at at time zone 'Europe/Madrid')::date), p.created_at) < (coalesce(i.invoice_date, (i.created_at at time zone 'Europe/Madrid')::date), i.created_at)) as previas,
           -- R5 · 7: el fichero de la llegada (una foto o un PDF), para decir cómo llegó de verdad.
           (select d.mime_type from public.document_inbox d where d.id = i.inbox_id and d.account_id = v_acc) as llegada_tipo
      from public.supplier_invoice i
      left join public.supplier s on s.id = i.supplier_id and s.account_id = i.account_id
     where i.account_id = v_acc and (i.company_id = p_company or i.company_id is null)
       and i.status <> 'anulada'
       and coalesce(i.invoice_date, (i.created_at at time zone 'Europe/Madrid')::date) between p_desde and p_hasta
  ), gasto0 as (
    -- Lo que Folvy ha entendido: la cuenta del asiento si lo hay; si no, la de la ficha.
    select f.id, f.supplier_id,
           coalesce(
             (select jsonb_build_object('cuenta', a.code, 'nombre', a.name, 'origen', 'del asiento')
                from public.journal_line l join public.company_account a on a.id = l.company_account_id
               where l.entry_id = (f.asiento->>'id')::uuid and a.code like '6%' and l.debit > 0 order by l.position limit 1),
             (select jsonb_build_object('cuenta', a.code, 'nombre', a.name, 'origen', 'de su ficha')
                from public.company_account_link k join public.company_account a on a.id = k.company_account_id
               where k.company_id = p_company and k.entity = 'supplier' and k.entity_id = f.supplier_id::text and k.role = 'gasto' limit 1)) as entendido
      from facturas f
  ), gasto as (
    -- R5 · 6: sin cuenta en el asiento ni en la ficha, lo aprendido de sus
    -- facturas anteriores (0250), como en N23, con su porqué. Si no hay nada
    -- que aprender, también se dice (la pantalla explica qué hacer).
    select g.id, g.entendido,
           case when g.entendido is null and g.supplier_id is not null then public.conta_gasto_aprendido(p_company, g.supplier_id) end as aprendido
      from gasto0 g
  ), filas_f as (
    select jsonb_build_object(
      'id', f.id, 'tipo', 'factura',
      -- S01 (0160): la descartada sale, con su estado y su porqué (regla 7: no se esconde).
      'estado', case when f.status = 'descartada' then 'descartada'
                     when f.asiento->>'estado' = 'validado' then 'apuntada'
                     when f.supplier_id is null or f.reading_confidence = 'duda' or f.status = 'con_discrepancias' then 'por_aclarar'
                     else 'para_mirar' end,
      'proveedor', jsonb_build_object('id', f.supplier_id, 'nombre', coalesce(f.proveedor_nombre, f.reading->'factura'->'proveedor'->>'nombre')),
      'numero', f.invoice_number, 'fecha', f.invoice_date, 'total', f.grand_total,
      -- R5 · 7: por dónde llegó DE VERDAD. Sin canal apuntado: leída del papel
      -- de su recepción (Cocina), leída en Compras, o escrita a mano.
      'canal', coalesce(f.arrival_channel, case when f.source = 'ocr' and f.recepcion is not null then 'cocina' when f.source = 'ocr' then 'compras' else 'a_mano' end),
      'llegada_tipo', f.llegada_tipo,
      'previas', f.previas,
      'confianza', f.reading_confidence,
      'porque', case when f.status = 'descartada'
                  then 'No es una factura: ' || coalesce(f.discard_reason, 'sin motivo') || ' (' || coalesce(f.discarded_by_name, 'una persona') || ', ' || to_char(f.discarded_at at time zone 'Europe/Madrid', 'DD/MM/YYYY') || ').'
                  else coalesce(f.reading->'porque'->>0, case when f.supplier_id is null then 'No reconozco el emisor: dime quién es.' end) end,
      'entendido', coalesce(g.entendido, case when g.aprendido->>'cuenta' is not null then jsonb_build_object(
                     'cuenta', g.aprendido->>'cuenta', 'nombre', g.aprendido->>'nombre', 'origen', g.aprendido->>'origen', 'sin_confirmar', true) end),
      'aprendido', case when g.aprendido is not null then jsonb_build_object('cuenta', g.aprendido->>'cuenta', 'facturas', coalesce((g.aprendido->>'facturas')::int, 0),
                     'confianza', g.aprendido->>'confianza', 'porque', g.aprendido->>'porque') end,
      'recepcion', f.recepcion, 'asiento', f.asiento,
      'llego', f.created_at) as fila
      from facturas f join gasto g on g.id = f.id
  ), recepciones as (
    -- R6 · Una recepción cuyo papel es «factura» o «albarán-factura» ES una
    -- factura recibida. Desde el corte, Compras ya la hace factura con el mismo
    -- papel (0140) y sale arriba, en filas_f. Aquí, las que NO son factura:
    --   · de antes del corte: las llevó el programa anterior. Se enlazan con su
    --     asiento traído de Diez (mismo proveedor, su número en el concepto y
    --     el mismo total), nunca se apuntan otra vez (la base no deja asentar
    --     antes del corte: 0120 de C04);
    --   · desde el corte, sin factura: la recepción no pudo hacerla (su
    --     pregunta lo dice): por aclarar, no se esconde (regla 7).
    -- Lo leído es el de la recepción: no se vuelve a leer con el modelo.
    select g.id, g.receipt_date, g.supplier_id, g.raw_document_url, g.created_at, s.name as proveedor_nombre,
           a.parsed_result->'document' as doc, p.question, p.reason as camino_porque,
           upper(regexp_replace(coalesce(nullif(a.parsed_result->'document'->>'doc_number', ''), g.supplier_doc_number, ''), '[^A-Za-z0-9]', '', 'g')) as clave,
           nullif(a.parsed_result->'document'->>'grand_total', '')::numeric as total,
           exists (select 1 from public.fiscal_year y
                    where y.company_id = p_company and y.account_id = v_acc and g.receipt_date between y.starts_on and y.ends_on
                      and y.imported_until is not null and g.receipt_date <= y.imported_until) as antes_del_corte,
           (select k.company_account_id from public.company_account_link k
             where k.company_id = p_company and k.account_id = v_acc and k.entity = 'supplier' and k.entity_id = g.supplier_id::text and k.role = 'principal' limit 1) as subcuenta
      from public.goods_receipt g
      join public.goods_receipt_ai_session a on a.id = g.ai_session_id and a.account_id = g.account_id
      left join public.goods_receipt_path p on p.goods_receipt_id = g.id and p.account_id = g.account_id
      left join public.supplier s on s.id = g.supplier_id and s.account_id = g.account_id
     where g.account_id = v_acc and g.status = 'confirmado'
       and a.parsed_result->'document'->>'doc_type' in ('factura', 'albaran_factura')
       and g.receipt_date between p_desde and p_hasta
       -- De esta empresa: la del camino; sin camino (las de antes de Compras), la
       -- del NIF a cuyo nombre va el papel, o la única de la cuenta si solo hay una.
       and coalesce(p.company_id,
             (select c.id from public.company c
               where c.account_id = v_acc and nullif(regexp_replace(upper(coalesce(c.tax_id, '')), '[^A-Z0-9]', '', 'g'), '')
                     = regexp_replace(regexp_replace(upper(coalesce(a.parsed_result->'document'->>'bill_to_tax_id', '')), '[^A-Z0-9]', '', 'g'), '^ES(?=[A-Z0-9]{9}$)', '')
               limit 1),
             (select c.id from public.company c where c.account_id = v_acc and (select count(*) from public.company c2 where c2.account_id = v_acc) = 1)) = p_company
       and p.supplier_invoice_id is null
       and not exists (select 1 from public.supplier_invoice_receipt x join public.supplier_invoice si on si.id = x.supplier_invoice_id
                        where x.goods_receipt_id = g.id and si.status <> 'anulada')
  ), recepciones_diez as (
    select r.*,
           (select jsonb_build_object('id', e.id, 'serie', e.series, 'numero', e.number, 'fecha', e.entry_date)
              from public.journal_entry e join public.journal_line l on l.entry_id = e.id
             where r.antes_del_corte and e.account_id = v_acc and e.company_id = p_company and e.series = 2 and e.external_program = 'diez' and e.status = 'validado'
               and l.company_account_id = r.subcuenta and l.credit > 0 and round(l.credit * 100) = round(r.total * 100)
               -- El número de Diez va en el concepto (medido: ninguna línea traída trae su justificante), o en el justificante si lo trae.
               and length(r.clave) >= 3
               and (position(r.clave in upper(regexp_replace(coalesce(e.concept, ''), '[^A-Za-z0-9]', '', 'g'))) > 0
                    or upper(regexp_replace(coalesce(l.external_voucher, l.document_ref, ''), '[^A-Za-z0-9]', '', 'g')) = r.clave)
             order by abs(e.entry_date - r.receipt_date) limit 1) as diez
      from recepciones r
  ), filas_r as (
    select jsonb_build_object(
      'id', r.id, 'tipo', 'recepcion',
      'estado', case when r.antes_del_corte then 'en_diez' else 'por_aclarar' end,
      'proveedor', jsonb_build_object('id', r.supplier_id, 'nombre', coalesce(r.proveedor_nombre, r.doc->>'supplier_name')),
      'numero', nullif(r.doc->>'doc_number', ''), 'fecha', coalesce(nullif(r.doc->>'doc_date', '')::date, r.receipt_date), 'total', r.total,
      'canal', 'cocina', 'confianza', null,
      'porque', case
        when r.antes_del_corte and r.diez is not null then 'Es de antes del corte y ya está en Diez (asiento ' || (r.diez->>'serie') || '/' || (r.diez->>'numero') || ', mismo proveedor, número y total): no se vuelve a apuntar.'
        when r.antes_del_corte then 'Es de antes del corte: la llevó el programa anterior y no se vuelve a apuntar. No la encuentro en Diez por su número y su total: míralo allí.'
        when r.question = 'factura_sin_importes' then 'La recepción la leyó, pero no trae importes por línea con su IVA: no he podido hacer la factura. Súbela o díctamela.'
        when r.question is not null then 'La recepción la leyó, pero no he podido hacer la factura: ' || coalesce(r.camino_porque, 'falta algo en la recepción') || '.'
        else 'La recepción la leyó y aún no es factura: ábrela en Compras.' end,
      'entendido', null, 'recepcion', jsonb_build_object('fecha', r.receipt_date, 'local', null),
      'asiento', case when r.diez is not null then jsonb_build_object('id', r.diez->>'id', 'estado', 'validado', 'solo', false, 'diez', true) end,
      'diez', r.diez, 'papel', r.raw_document_url,
      'llego', r.created_at) as fila
      from recepciones_diez r
  ), filas_l as (
    -- Lo que llegó y no es (todavía) una factura: por aclarar, con su motivo.
    select jsonb_build_object(
      'id', d.id, 'tipo', 'llegada',
      'estado', case when d.status = 'repetida' then 'repetida' else 'por_aclarar' end,
      'proveedor', jsonb_build_object('id', null, 'nombre', null),
      'numero', null, 'fecha', (d.created_at at time zone 'Europe/Madrid')::date, 'total', null,
      'canal', d.channel, 'confianza', null,
      'porque', coalesce(d.reason, case d.status when 'falta_pdf' then 'Falta el PDF: el correo trae un enlace.' when 'leyendo' then 'Leyéndola.' when 'recibido' then 'Recibida, sin leer todavía.' else 'Hay algo que aclarar.' end),
      'entendido', null, 'recepcion', null, 'asiento', null, 'llego', d.created_at, 'archivo', d.file_name) as fila
      from public.document_inbox d
     where d.account_id = v_acc and (d.company_id = p_company or d.company_id is null)
       and d.supplier_invoice_id is null and d.status <> 'descartado'
       -- V02 · Lo que la puerta sabe que NO es una factura (un extracto, una
       -- nómina, una liquidación…) tiene su sitio y sale en Inicio › Documentos;
       -- aquí, lo que es factura o ticket y lo que aún no se sabe qué es.
       and coalesce(d.doc_kind, 'factura') in ('factura', 'ticket')
       and (d.created_at at time zone 'Europe/Madrid')::date between p_desde and p_hasta
  )
  select coalesce(jsonb_agg(fila order by (fila->>'llego') desc), '[]'::jsonb) into v_filas
    from (select fila from filas_f union all select fila from filas_l union all select fila from filas_r) x;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.periodo, x.supplier_name), '[]'::jsonb) into v_esperadas
    from public.conta_esperadas_no_llegadas(p_company, least(v_hoy, p_hasta + 1)) x;

  select a.local_part || '@' || a.domain as direccion, a.active into v_correo
    from public.company_inbound_address a where a.company_id = p_company and a.account_id = v_acc
   -- V02: la dirección única de la empresa, si la tiene; si no, la de facturas.
   order by (a.kind = 'documentos') desc, (a.kind = 'facturas') desc limit 1;

  return jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'correo', jsonb_build_object('activo', coalesce(v_correo.active, false), 'direccion', v_correo.direccion),
    'recibe_mercancia', public.conta_recibe_mercancia(p_company),
    'filas', v_filas,
    'esperadas', v_esperadas,
    'cifras', jsonb_build_object(
      -- R5 · 8: las del periodo elegido, no «esta semana».
      'llegadas', jsonb_array_length(v_filas),
      'llegadas_por_canal', (select coalesce(jsonb_object_agg(c, n), '{}'::jsonb) from (select f->>'canal' c, count(*) n from jsonb_array_elements(v_filas) f group by 1) y),
      'apuntadas_solas', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'apuntada' and (f->'asiento'->>'solo')::boolean),
      'apuntadas', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'apuntada'),
      'para_mirar', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'para_mirar'),
      'por_aclarar', (select count(*) from jsonb_array_elements(v_filas) f where f->>'estado' = 'por_aclarar'),
      'esperadas_no_llegadas', jsonb_array_length(v_esperadas)));
end $$;
