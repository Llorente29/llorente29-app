-- ============================================================================
-- B01 · Cola 1e · EL JUSTIFICANTE DE UN PAGO (solo añade)
-- ----------------------------------------------------------------------------
-- Julio (02/11, respuestas B01·7 y B01·8). La API de Revolut no da comprobante
-- de una transferencia: lo hace Sumied.
--
--   · Cuando el banco confirma que un pago ha salido (conta_pago_salida en
--     «pagada»), la lectura de Revolut, el aviso o «Pagar» hacen su PDF, con la
--     marca de la empresa que paga, y lo guardan aquí: queda en la ficha de la
--     factura.
--   · Cada justificante tiene una CLAVE que no se puede adivinar (32 bytes al
--     azar, en base64url) para el enlace público del WhatsApp. Caduca a los 30
--     días. El enlace solo enseña el justificante, con el IBAN tapado salvo los
--     4 últimos (el PDF ya va así).
--   · supplier.justificante_al_pagar: «Mandar el justificante al pagar», nueva
--     en la ficha del proveedor. Sin marcar (o nula), no se manda solo.
--
-- Funciones (dueño único: las escriben estas):
--   conta_pago_justificante_por_hacer(p_company)   servicio · los pagados sin justificante (60 días)
--   conta_pago_justificante_datos(p_salida)         servicio · lo que lleva el PDF
--   conta_pago_justificante_guardar(…)              servicio · lo guarda (una vez por pago)
--   conta_pago_justificante_correo(…)               servicio · apunta el envío por correo
--   conta_justificante_publico(p_clave)             servicio · el enlace público
--   conta_factura_justificantes(p_factura)          quien llama · la ficha de la factura
--
-- Solo añade: una columna que admite nulos, una tabla y funciones nuevas. Se
-- puede pasar dos veces. No toca datos ni nada del camino del pedido.
-- Vuelta atrás: supabase/vuelta-atras/20261102T2140_b01p_justificante.down.sql
-- Prueba: supabase/staging/sql/20261102_b01p_justificante_prueba.sql
-- ============================================================================

alter table public.supplier add column if not exists justificante_al_pagar boolean;
comment on column public.supplier.justificante_al_pagar is
  'B01 · Cola 1e · «Mandar el justificante al pagar»: con true, cuando el banco confirma un pago a este proveedor, Sumied le manda por correo su justificante. Nula o false: no se manda solo.';

create table if not exists public.conta_pago_justificante (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null,
  company_id   uuid not null,
  salida_id    uuid not null unique references public.conta_pago_salida(id) on delete cascade,
  invoice_id   uuid not null,
  supplier_id  uuid not null,
  clave        text not null unique check (clave ~ '^[A-Za-z0-9_-]{43}$'),
  pdf_path     text not null,
  created_at   timestamptz not null default now(),
  caduca_at    timestamptz not null default now() + interval '30 days',
  correo_a     text,
  correo_at    timestamptz,
  correo_texto text
);
create index if not exists conta_pago_justificante_factura_idx on public.conta_pago_justificante (invoice_id);
comment on table public.conta_pago_justificante is
  'B01 · Cola 1e · El justificante de un pago que el banco ha confirmado: su PDF (conta-documentos) y la clave del enlace público, que caduca a los 30 días. Uno por pago.';
alter table public.conta_pago_justificante enable row level security;
drop policy if exists conta_pago_justificante_leer on public.conta_pago_justificante;
create policy conta_pago_justificante_leer on public.conta_pago_justificante for select to authenticated using (public._conta_pago_de_la_cuenta(account_id));
-- En Supabase una tabla nueva de public nace con todos los permisos para anon y authenticated
-- (los de por defecto): se quitan y solo se deja leer. Escriben solo las funciones del servicio.
revoke all on public.conta_pago_justificante from anon, authenticated;
grant select on public.conta_pago_justificante to authenticated;

-- ── Los pagados sin justificante (la lectura de cada hora los hace) ──────────
create or replace function public.conta_pago_justificante_por_hacer(p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(s.id order by s.estado_at), '[]'::jsonb)
    from public.conta_pago_salida s
   where s.company_id = p_company and s.estado = 'pagada' and s.estado_at > now() - interval '60 days'
     and not exists (select 1 from public.conta_pago_justificante j where j.salida_id = s.id)
$$;
revoke all on function public.conta_pago_justificante_por_hacer(uuid) from public, anon, authenticated;
grant execute on function public.conta_pago_justificante_por_hacer(uuid) to service_role;

-- ── Lo que lleva el PDF ─────────────────────────────────────────────────────
-- El IBAN del proveedor sale ya tapado: solo los 4 últimos.
create or replace function public.conta_pago_justificante_datos(p_salida uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'salida', s.id, 'account_id', s.account_id, 'company_id', s.company_id, 'invoice_id', s.invoice_id, 'supplier_id', s.supplier_id,
    'estado', s.estado, 'pagado_at', s.estado_at, 'importe', s.amount, 'concepto', s.concepto, 'referencia', s.banco_id,
    'banco', initcap(l.proveedor),
    'empresa', jsonb_build_object('nombre', coalesce(nullif(c.trade_name, ''), c.legal_name), 'razon', c.legal_name, 'nif', c.tax_id,
                                  'color', c.color, 'logo_path', c.logo_path, 'email', c.email,
                                  'direccion', nullif(concat_ws(', ', nullif(trim(concat_ws(' ', c.fiscal_street, c.fiscal_number)), ''), nullif(trim(c.fiscal_city), '')), '')),
    'desde', jsonb_build_object('nombre', t.name, 'iban4', right(regexp_replace(coalesce(t.iban, ''), '\s', '', 'g'), 4)),
    'proveedor', jsonb_build_object('nombre', s.beneficiario, 'nif', sp.tax_id, 'iban4', right(regexp_replace(s.iban, '\s', '', 'g'), 4),
                                    'iban_pais', left(regexp_replace(s.iban, '\s', '', 'g'), 2),
                                    'al_pagar', coalesce(sp.justificante_al_pagar, false),
                                    'correo', (select sc.email from public.supplier_contact sc
                                                where sc.supplier_id = s.supplier_id and nullif(trim(sc.email), '') is not null
                                                order by sc.is_primary desc nulls last, sc.created_at limit 1)),
    'factura', jsonb_build_object('numero', si.invoice_number, 'fecha', si.invoice_date, 'total', si.grand_total),
    'justificante', (select jsonb_build_object('id', j.id, 'clave', j.clave, 'pdf_path', j.pdf_path, 'correo_at', j.correo_at)
                       from public.conta_pago_justificante j where j.salida_id = s.id))
    from public.conta_pago_salida s
    join public.conta_pago_lote l on l.id = s.lote_id
    join public.company c on c.id = s.company_id
    left join public.treasury_account t on t.id = l.treasury_account_id
    left join public.supplier sp on sp.id = s.supplier_id
    left join public.supplier_invoice si on si.id = s.invoice_id
   where s.id = p_salida
$$;
revoke all on function public.conta_pago_justificante_datos(uuid) from public, anon, authenticated;
grant execute on function public.conta_pago_justificante_datos(uuid) to service_role;

-- ── Guardarlo: una vez por pago; si ya estaba, devuelve el que había ────────
create or replace function public.conta_pago_justificante_guardar(p_salida uuid, p_clave text, p_pdf_path text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.conta_pago_salida; v_j public.conta_pago_justificante;
begin
  select * into v_s from public.conta_pago_salida where id = p_salida;
  if v_s.id is null then raise exception 'Ese pago no existe.' using errcode = 'P0002'; end if;
  if v_s.estado <> 'pagada' then
    raise exception 'Este pago no está confirmado por el banco (está %): no lleva justificante.', replace(v_s.estado, '_', ' ') using errcode = '23514';
  end if;
  insert into public.conta_pago_justificante (account_id, company_id, salida_id, invoice_id, supplier_id, clave, pdf_path)
  values (v_s.account_id, v_s.company_id, v_s.id, v_s.invoice_id, v_s.supplier_id, p_clave, p_pdf_path)
  on conflict (salida_id) do nothing
  returning * into v_j;
  if v_j.id is null then
    select * into v_j from public.conta_pago_justificante where salida_id = p_salida;
    return to_jsonb(v_j) || jsonb_build_object('nuevo', false);
  end if;
  perform public._conta_pago_evento(v_s.account_id, v_s.lote_id, v_s.id, 'Sumied', 'Hecho el justificante del pago: queda en la ficha de la factura.');
  return to_jsonb(v_j) || jsonb_build_object('nuevo', true);
end $$;
revoke all on function public.conta_pago_justificante_guardar(uuid, text, text) from public, anon, authenticated;
grant execute on function public.conta_pago_justificante_guardar(uuid, text, text) to service_role;

-- ── Apuntar el correo (mandado o no, y por qué) ─────────────────────────────
create or replace function public.conta_pago_justificante_correo(p_id uuid, p_a text, p_texto text, p_quien text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_j public.conta_pago_justificante; v_s public.conta_pago_salida;
begin
  select * into v_j from public.conta_pago_justificante where id = p_id for update;
  if v_j.id is null then raise exception 'Ese justificante no existe.' using errcode = 'P0002'; end if;
  if p_a is not null then
    update public.conta_pago_justificante set correo_a = p_a, correo_at = now(), correo_texto = left(p_texto, 300) where id = p_id;
  else
    update public.conta_pago_justificante set correo_texto = left(p_texto, 300) where id = p_id;
  end if;
  select * into v_s from public.conta_pago_salida where id = v_j.salida_id;
  perform public._conta_pago_evento(v_j.account_id, v_s.lote_id, v_s.id, coalesce(nullif(trim(p_quien), ''), 'Sumied'), left(p_texto, 300));
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.conta_pago_justificante_correo(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_pago_justificante_correo(uuid, text, text, text) to service_role;

-- ── El enlace público: solo con la clave entera ─────────────────────────────
create or replace function public.conta_justificante_publico(p_clave text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('pdf_path', j.pdf_path, 'caducado', j.caduca_at <= now(), 'numero', si.invoice_number)
    from public.conta_pago_justificante j
    left join public.supplier_invoice si on si.id = j.invoice_id
   where p_clave ~ '^[A-Za-z0-9_-]{43}$' and j.clave = p_clave
$$;
revoke all on function public.conta_justificante_publico(text) from public, anon, authenticated;
grant execute on function public.conta_justificante_publico(text) to service_role;

-- ── La ficha de la factura: sus justificantes y cómo mandarlos ──────────────
-- De seguridad del que llama: lee con su RLS (si no es de su cuenta, no está).
create or replace function public.conta_factura_justificantes(p_factura uuid)
returns jsonb language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', j.id, 'clave', j.clave, 'creado', j.created_at, 'caduca', j.caduca_at, 'importe', s.amount, 'pagado_at', s.estado_at,
           'correo_a', j.correo_a, 'correo_at', j.correo_at, 'correo_texto', j.correo_texto,
           'proveedor', s.beneficiario, 'supplier_id', j.supplier_id, 'al_pagar', coalesce(sp.justificante_al_pagar, false),
           'banco', initcap(l.proveedor), 'desde', t.name, 'desde_iban4', right(regexp_replace(coalesce(t.iban, ''), '\s', '', 'g'), 4),
           'telefono', (select sc.phone from public.supplier_contact sc where sc.supplier_id = j.supplier_id and nullif(trim(sc.phone), '') is not null
                         order by sc.is_primary desc nulls last, sc.created_at limit 1),
           'correo', (select sc.email from public.supplier_contact sc where sc.supplier_id = j.supplier_id and nullif(trim(sc.email), '') is not null
                       order by sc.is_primary desc nulls last, sc.created_at limit 1))
         order by j.created_at desc), '[]'::jsonb)
    from public.conta_pago_justificante j
    join public.conta_pago_salida s on s.id = j.salida_id
    join public.conta_pago_lote l on l.id = s.lote_id
    left join public.treasury_account t on t.id = l.treasury_account_id
    left join public.supplier sp on sp.id = j.supplier_id
   where j.invoice_id = p_factura
$$;
revoke all on function public.conta_factura_justificantes(uuid) from public, anon;
grant execute on function public.conta_factura_justificantes(uuid) to authenticated;
comment on function public.conta_factura_justificantes(uuid) is 'B01 · Cola 1e (02/11). Los justificantes de los pagos de una factura, con la clave de su enlace, cuándo caduca, si se mandó por correo y el teléfono y el correo del proveedor.';
