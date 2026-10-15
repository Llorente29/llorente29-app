-- supabase/migrations/20261113T0100_d01_liquidaciones_correo.sql
--
-- cambia: public.company_inbound_address · prueba: supabase/staging/sql/20261113_d01_liquidaciones_prueba.sql
-- cambia: public.inbound_email_log · prueba: supabase/staging/sql/20261113_d01_liquidaciones_prueba.sql
-- cambia: public.conta_entrada_destino · prueba: supabase/staging/sql/20261113_d01_liquidaciones_prueba.sql
-- cambia: public.supplier_invoice · prueba: supabase/staging/sql/20261113_d01_liquidaciones_prueba.sql
-- cambia: public.channel_settlement · prueba: supabase/staging/sql/20261113_d01_liquidaciones_prueba.sql
-- cambia: public.conta_recibida_envio · prueba: supabase/staging/sql/20261113_d01_liquidaciones_prueba.sql
--
-- D01 · LIQUIDACIONES POR CORREO · T1 (la base), empezando por Uber Eats.
-- Plan aprobado el 15/10. Todo nuevo salvo lo de la cabecera, que solo AMPLÍA:
--
--   1. company_inbound_address: además de facturas-<empresa>@, la dirección
--      liquidaciones-<empresa>@entrada.folvy.app (kind «liquidaciones»; el
--      prefijo de la dirección y su clase, atados). conta_direccion_entrada la
--      crea (nace apagada, como la de facturas).
--      conta_entrada_destino dice además de qué clase es la dirección (la
--      función conta-facturas-entrada enruta por ella). Misma firma; lo que ya
--      devolvía, igual.
--      inbound_email_log: tres resultados más («liquidacion», «confirmacion»
--      —el código que manda Gmail al reenviar— y «no_es_liquidacion»).
--   2. platform_store: EL MAPA DE TIENDAS DE LAS PLATAFORMAS. Cómo nombra cada
--      plataforma a cada marca × local (Uber, en el saludo de su resumen) → la
--      marca, el local, el canal y la cuenta del banco donde paga. Lo usarán
--      Glovo, Just Eat y CTB (por eso lleva también su tercero); generaliza el
--      de E05 (supplier_batch_store), que Catcher seguirá usando hasta que su
--      pantalla lea este: entonces se pasa en dos tandas (regla de borrar).
--      Una tienda nueva entra «sin asignar»: nunca se adivina su marca.
--   3. channel_settlement: lo que trae el resumen de Uber y no tenía columna
--      (otras ganancias, otros cargos de la promoción, anuncios, contracargo,
--      ajustes) y «Promociones en artículos» APARTE (item_promotions), fuera de
--      la factura y fuera de los cargos del asiento hasta que Julio decida.
--      Su tienda (store_id), el correo del que sale y su factura de comisión.
--   4. La factura de comisión: supplier_invoice con origen «liquidacion» y su
--      marca (brand_id); cada línea con su cuenta de gasto
--      (supplier_invoice_line.expense_account_code: comisión y anuncios van a
--      cuentas distintas); la plataforma dice cuáles (party_role
--      commission_account_code / ads_account_code; si no, la 623 y la 627 de la
--      plantilla). Sale SIN número —Uber no lo manda en el correo— y así se
--      queda: «Falta el número», en revisión, y no va a Diez sin él
--      (conta_recibida_envio lo frena).
--   5. conta_liquidacion_registrar: el resumen leído (lo lee
--      _shared/liquidacionUber.ts) → la tienda (nueva: sin asignar), la
--      liquidación, y su factura de comisión. La misma semana de la misma
--      tienda dos veces no crea nada y lo dice (import_key = tienda + periodo).
--      conta_liquidacion_factura_proponer: la factura de una liquidación (la
--      llama la de arriba; se puede volver a llamar cuando falte el proveedor).
--      conta_tienda_plataforma_asignar: dar a una tienda su marca, local y banco.
--
-- Vuelta atrás: supabase/vuelta-atras/20261113T0100_d01_liquidaciones_correo.down.sql
-- Prueba: supabase/staging/sql/20261113_d01_liquidaciones_prueba.sql

-- 1 · La dirección de liquidaciones ---------------------------------------------------
alter table public.company_inbound_address drop constraint if exists company_inbound_address_kind_check;
alter table public.company_inbound_address add constraint company_inbound_address_kind_check check (kind in ('facturas', 'liquidaciones'));
alter table public.company_inbound_address drop constraint if exists company_inbound_address_local_part_check;
alter table public.company_inbound_address add constraint company_inbound_address_local_part_check
  check (local_part ~ ('^' || kind || '-[a-z0-9][a-z0-9-]{1,40}$'));
comment on table public.company_inbound_address is
  'D01 · Las direcciones propias de cada empresa: facturas-<empresa>@entrada.folvy.app (facturas) y liquidaciones-<empresa>@ (los resúmenes de pagos de las plataformas). Nacen apagadas: se encienden cuando el dominio está dado de alta en Resend.';

alter table public.inbound_email_log drop constraint if exists inbound_email_log_outcome_check;
alter table public.inbound_email_log add constraint inbound_email_log_outcome_check
  check (outcome in ('recibido', 'sin_facturas', 'sin_destino', 'apagada', 'error', 'liquidacion', 'confirmacion', 'no_es_liquidacion'));

create or replace function public.conta_entrada_destino(p_local_part text, p_domain text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('company_id', a.company_id, 'account_id', a.account_id, 'activa', a.active, 'tipo', a.kind)
    from public.company_inbound_address a
   where lower(a.local_part) = lower(p_local_part) and lower(a.domain) = lower(p_domain)
$$;
revoke all on function public.conta_entrada_destino(text, text) from public, anon, authenticated;
grant execute on function public.conta_entrada_destino(text, text) to service_role;

-- La dirección de una clase (facturas o liquidaciones): el mismo identificador
-- corto que la 0200 (del nombre comercial, sin tildes ni signos; con sufijo si
-- ya lo tiene otra empresa). La de facturas sigue saliendo también de
-- conta_direccion_facturas, que no se toca.
create or replace function public.conta_direccion_entrada(p_company uuid, p_tipo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
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
end $$;
revoke all on function public.conta_direccion_entrada(uuid, text, text) from public, anon;
grant execute on function public.conta_direccion_entrada(uuid, text, text) to authenticated;

-- 2 · El mapa de tiendas de las plataformas -------------------------------------------
create table if not exists public.platform_store (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  provider text not null check (provider in ('uber', 'glovo', 'justeat', 'ctb', 'catcher')),
  -- Como la nombra la plataforma (Uber: el saludo del resumen, «Marca (dirección)»).
  external_text text not null check (btrim(external_text) <> ''),
  -- Su identificador en la plataforma, si lo da (Glovo y Just Eat lo dan en sus ficheros).
  external_id text,
  channel_id uuid references public.sales_channel(id) on delete set null,
  brand_id uuid references public.brand(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  -- La cuenta del banco donde paga esta marca × local.
  treasury_account_id uuid references public.treasury_account(id) on delete set null,
  -- El tercero, cuando no es el de la plataforma (CTB liquida por marca cedida).
  party_id uuid references public.party(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  created_by_name text,
  updated_at timestamptz,
  updated_by uuid,
  updated_by_name text
);
create unique index if not exists platform_store_uq on public.platform_store (account_id, company_id, provider, lower(btrim(external_text)));
comment on table public.platform_store is
  'D01 · El mapa de tiendas de las plataformas: cómo nombra cada una (Uber, Glovo, Just Eat, CTB, Catcher) a cada marca × local → la marca, el local, el canal y la cuenta del banco donde paga. Una tienda nueva entra sin asignar: su marca y su local los da una persona.';
alter table public.platform_store enable row level security;
drop policy if exists platform_store_read on public.platform_store;
create policy platform_store_read on public.platform_store for select using (account_id = any (public.current_user_account_ids()));
revoke insert, update, delete, truncate on public.platform_store from anon, authenticated;
grant select on public.platform_store to authenticated;

-- Dar a una tienda su marca, su local y su banco (los tres, de la misma cuenta).
create or replace function public.conta_tienda_plataforma_asignar(p_store uuid, p_marca uuid, p_local uuid, p_banco uuid default null, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.platform_store;
begin
  select * into v_s from public.platform_store where id = p_store for update;
  if v_s.id is null or not public.belongs_to_account(v_s.account_id) then raise exception 'Esa tienda no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_s.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta asigna las tiendas.' using errcode = '42501';
  end if;
  if p_marca is not null and not exists (select 1 from public.brand where id = p_marca and account_id = v_s.account_id) then raise exception 'Esa marca no es de esta cuenta.' using errcode = '22023'; end if;
  if p_local is not null and not exists (select 1 from public.locations where id = p_local and account_id = v_s.account_id) then raise exception 'Ese local no es de esta cuenta.' using errcode = '22023'; end if;
  if p_banco is not null and not exists (select 1 from public.treasury_account where id = p_banco and account_id = v_s.account_id and company_id = v_s.company_id) then
    raise exception 'Esa cuenta del banco no es de esta empresa.' using errcode = '22023';
  end if;
  update public.platform_store set brand_id = p_marca, location_id = p_local, treasury_account_id = p_banco,
         updated_at = now(), updated_by = auth.uid(), updated_by_name = coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor())
   where id = p_store returning * into v_s;
  -- Sus liquidaciones aún sin marca ni local las toman ahora (las que ya tenían, no se tocan).
  -- Lo que no cuadró al leer sigue por revisar: asignar la tienda no lo arregla.
  update public.channel_settlement c set brand_id = coalesce(c.brand_id, p_marca), location_id = coalesce(c.location_id, p_local),
         needs_review = (coalesce(c.brand_id, p_marca) is null or coalesce(c.location_id, p_local) is null or x.avisos > 0),
         review_note = nullif(concat_ws(' ',
           case when coalesce(c.brand_id, p_marca) is null or coalesce(c.location_id, p_local) is null then 'Tienda sin asignar: dale su marca y su local.' end,
           case when x.avisos > 0 then x.avisos || case when x.avisos = 1 then ' cosa no cuadra al leer.' else ' cosas no cuadran al leer.' end end), ''),
         updated_at = now()
    from (select id, coalesce(jsonb_array_length(case when jsonb_typeof(raw->'avisos') = 'array' then raw->'avisos' end), 0) as avisos
            from public.channel_settlement where store_id = p_store) x
   where x.id = c.id and c.store_id = p_store and (c.brand_id is null or c.location_id is null);
  return to_jsonb(v_s);
end $$;
revoke all on function public.conta_tienda_plataforma_asignar(uuid, uuid, uuid, uuid, text) from public, anon;
grant execute on function public.conta_tienda_plataforma_asignar(uuid, uuid, uuid, uuid, text) to authenticated;

-- 3 · Lo que trae el resumen de Uber ---------------------------------------------------
alter table public.channel_settlement add column if not exists other_earnings numeric;
alter table public.channel_settlement add column if not exists promo_charges numeric;
alter table public.channel_settlement add column if not exists ads_spend numeric;
alter table public.channel_settlement add column if not exists item_promotions numeric;
alter table public.channel_settlement add column if not exists chargebacks numeric;
alter table public.channel_settlement add column if not exists adjustments numeric;
alter table public.channel_settlement add column if not exists store_id uuid references public.platform_store(id) on delete set null;
alter table public.channel_settlement add column if not exists inbound_email_id text;
alter table public.channel_settlement add column if not exists commission_invoice_id uuid references public.supplier_invoice(id) on delete set null;
comment on column public.channel_settlement.other_earnings is 'D01 · «Otras ganancias» del resumen (Uber): a tu favor, signo del origen.';
comment on column public.channel_settlement.promo_charges is 'D01 · «Otros cargos de la promoción» (Uber): va en su factura de comisión.';
comment on column public.channel_settlement.ads_spend is 'D01 · «Gastos en anuncios» (Uber): va en su factura de comisión, a la cuenta de publicidad.';
comment on column public.channel_settlement.item_promotions is
  'D01 · «Promociones en artículos» (Uber): NO va en la factura de comisión ni en los cargos del asiento. Se guarda aparte hasta que Julio decida cómo se apunta.';
comment on column public.channel_settlement.chargebacks is 'D01 · «Importe neto del contracargo» (Uber): lo que la plataforma descuenta por pedidos con error.';
comment on column public.channel_settlement.adjustments is 'D01 · «Ajustes» (Uber).';
comment on column public.channel_settlement.store_id is 'D01 · La tienda de la plataforma (platform_store) de la que es la liquidación.';
comment on column public.channel_settlement.inbound_email_id is 'D01 · El correo (inbound_email_log.email_id) del que se leyó.';
comment on column public.channel_settlement.commission_invoice_id is
  'D01 · Su factura de comisión (supplier_invoice). Si la tiene, el asiento de la liquidación ya no lleva la comisión: va en la factura (serie 2).';
create index if not exists channel_settlement_tienda_idx on public.channel_settlement (store_id, period_to) where store_id is not null;

-- 4 · La factura de comisión ------------------------------------------------------------
alter table public.supplier_invoice drop constraint if exists supplier_invoice_source_check;
alter table public.supplier_invoice add constraint supplier_invoice_source_check check (source in ('manual', 'ocr', 'lote', 'liquidacion'));
alter table public.supplier_invoice add column if not exists brand_id uuid references public.brand(id) on delete set null;
comment on column public.supplier_invoice.brand_id is 'D01 · La marca de la factura, cuando se sabe (la de comisión de una plataforma es de una marca × local).';
alter table public.supplier_invoice_line add column if not exists expense_account_code text;
comment on column public.supplier_invoice_line.expense_account_code is
  'D01 · La cuenta de gasto de ESTA línea, si no es la del proveedor (la factura de comisión de Uber: comisión a la 623, anuncios a la 627).';
alter table public.party_role add column if not exists commission_account_code text;
alter table public.party_role add column if not exists ads_account_code text;
comment on column public.party_role.commission_account_code is 'D01 · Plataforma: la cuenta de la comisión de su factura (si no, la 623 de la plantilla).';
comment on column public.party_role.ads_account_code is 'D01 · Plataforma: la cuenta de los anuncios de su factura (si no, la 627 de la plantilla).';

-- La factura de comisión de una liquidación. Sin número (no lo trae el correo):
-- en revisión, «Falta el número». Idempotente: si ya la tiene, la devuelve.
create or replace function public.conta_liquidacion_factura_proponer(p_settlement uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cs public.channel_settlement; v_e uuid; v_f jsonb; v_sup uuid; v_rol public.party_role; v_inv uuid;
  v_c623 text; v_c627 text; v_tasa uuid; v_fecha date; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Liquidación por correo');
  v_base numeric; v_iva numeric; v_total numeric; v_bc numeric; v_ba numeric; v_sem int;
begin
  select * into v_cs from public.channel_settlement where id = p_settlement for update;
  if v_cs.id is null then raise exception 'Esa liquidación no está.' using errcode = 'P0002'; end if;
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_cs.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta propone facturas.' using errcode = '42501';
  end if;
  if v_cs.commission_invoice_id is not null then
    return jsonb_build_object('estado', 'ya_estaba', 'factura_id', v_cs.commission_invoice_id, 'texto', 'La factura de comisión ya estaba.');
  end if;
  v_f := v_cs.raw->'factura';
  if v_f is null or jsonb_typeof(v_f) <> 'object' or coalesce((v_f->>'total')::numeric, 0) = 0 then
    return jsonb_build_object('estado', 'sin_factura', 'texto', 'Esta liquidación no tiene comisión ni cargos que facturar.');
  end if;
  v_base := (v_f->>'base')::numeric; v_iva := (v_f->>'iva')::numeric; v_total := (v_f->>'total')::numeric;
  v_bc := (v_f->'comision'->>'base')::numeric; v_ba := (v_f->'publicidad'->>'base')::numeric;
  if round(v_base * 100) + round(v_iva * 100) <> round(v_total * 100) or round(v_bc * 100) + round(v_ba * 100) <> round(v_base * 100) then
    raise exception 'La factura de comisión no cuadra: base + IVA no es el total.' using errcode = '22023';
  end if;
  select company_id into v_e from public.platform_store where id = v_cs.store_id;
  if v_e is null then raise exception 'La liquidación no dice de qué empresa es (no tiene tienda).' using errcode = '22023'; end if;

  -- El proveedor: el de la plataforma del canal (tercero de la plataforma → su ficha de proveedor).
  select * into v_rol from public.party_role where account_id = v_cs.account_id and role = 'platform' and channel_id = v_cs.channel_id order by created_at limit 1;
  select supplier_id into v_sup from public.party_role where account_id = v_cs.account_id and role = 'supplier' and party_id = v_rol.party_id order by created_at limit 1;
  if v_sup is null then
    update public.channel_settlement set needs_review = true,
           review_note = 'Falta el proveedor de la plataforma: dale a su tercero su ficha de proveedor y vuelve a proponer la factura.', updated_at = now()
     where id = v_cs.id;
    return jsonb_build_object('estado', 'falta_proveedor', 'texto', 'La plataforma no tiene ficha de proveedor: la factura de comisión no se ha creado.');
  end if;

  -- Las cuentas: las de la plataforma; si no, la 623 / 627 de la plantilla.
  v_c623 := coalesce(nullif(btrim(v_rol.commission_account_code), ''),
                     (select code from public.company_account where company_id = v_e and kind = 'template' and template_code = '623' order by code limit 1));
  v_c627 := coalesce(nullif(btrim(v_rol.ads_account_code), ''),
                     (select code from public.company_account where company_id = v_e and kind = 'template' and template_code = '627' order by code limit 1));
  select id into v_tasa from public.tax_rate where code = 'iva_general' and is_system order by valid_to desc nulls first limit 1;

  -- La fecha la pone la plataforma con el número: se propone el martes siguiente (Uber, medido en Diez).
  v_fecha := v_cs.period_to + 2;
  v_sem := ((v_cs.period_to - v_cs.period_from) + 1) / 7;
  insert into public.supplier_invoice (account_id, company_id, supplier_id, location_id, brand_id, doc_kind, invoice_number, invoice_date, status, source,
                                       arrival_channel, tax_base_total, tax_total, grand_total, needs_review, notes, reading, reading_confidence, created_by_name)
  values (v_cs.account_id, v_e, v_sup, v_cs.location_id, v_cs.brand_id, 'invoice', null, v_fecha, 'en_revision', 'liquidacion', 'correo',
          v_base, v_iva, v_total, true,
          'De la liquidación del ' || to_char(v_cs.period_from, 'DD/MM/YYYY') || ' al ' || to_char(v_cs.period_to, 'DD/MM/YYYY') ||
          '. Falta el número: la plataforma no lo manda en el correo.',
          jsonb_build_object('origen', 'liquidacion', 'liquidacion_id', v_cs.id,
            'requisitos', jsonb_build_array(
              jsonb_build_object('id', 'numero', 'ok', false, 'texto', 'Falta el número: la plataforma no lo manda en el correo.'),
              jsonb_build_object('id', 'fecha', 'ok', false, 'texto', 'Fecha propuesta: la pone la plataforma con el número.')) ||
              case when v_sem > 1 then jsonb_build_array(jsonb_build_object('id', 'semanas', 'ok', false,
                'texto', 'La liquidación es de ' || v_sem || ' semanas: la plataforma puede haber hecho una factura por semana.')) else '[]'::jsonb end,
            'avisos', coalesce(v_f->'avisos', '[]'::jsonb)),
          'duda', v_quien)
  returning id into v_inv;
  insert into public.supplier_invoice_line (supplier_invoice_id, raw_text, qty, unit_price, line_amount, vat_pct, expense_account_code, position)
  select v_inv, x.texto, 1, x.base, x.base, 21, x.cuenta, x.pos
    from (values (1, 'Comisión y cargos de la plataforma', v_bc, v_c623), (2, 'Publicidad (anuncios)', v_ba, v_c627)) as x(pos, texto, base, cuenta)
   where x.base <> 0;
  insert into public.supplier_invoice_tax (account_id, supplier_invoice_id, tax_rate_id, vat_pct, base, vat_amount)
  values (v_cs.account_id, v_inv, v_tasa, 21, v_base, v_iva);
  update public.channel_settlement set commission_invoice_id = v_inv, updated_at = now() where id = v_cs.id;
  return jsonb_build_object('estado', 'creada', 'factura_id', v_inv, 'total', v_total,
    'texto', 'Factura de comisión propuesta: ' || public.conta_euros_exactos(v_total) || ', a falta del número.');
end $$;
revoke all on function public.conta_liquidacion_factura_proponer(uuid, text) from public, anon;
grant execute on function public.conta_liquidacion_factura_proponer(uuid, text) to authenticated, service_role;

-- 5 · Registrar un resumen leído --------------------------------------------------------
create or replace function public.conta_liquidacion_registrar(p_company uuid, p jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_acc uuid; v_prov text := coalesce(p->>'proveedor', ''); v_tienda text := btrim(coalesce(p->>'tienda', ''));
  v_desde date := nullif(p->>'desde', '')::date; v_hasta date := nullif(p->>'hasta', '')::date;
  v_s public.platform_store; v_canal uuid; v_clave text; v_ya public.channel_settlement; v_id uuid; v_fac jsonb; v_nueva boolean := false;
  v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), 'Liquidación por correo');
  v_avisos int := coalesce(jsonb_array_length(case when jsonb_typeof(p->'avisos') = 'array' then p->'avisos' end), 0);
  v_neto numeric := nullif(p->>'neto', '')::numeric; v_texto text;
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  -- La llama la función de entrada (sin persona) o, a mano, un administrador o encargado.
  if auth.uid() is not null and not public.current_user_is_admin_or_manager_of(v_acc) then
    raise exception 'Solo un administrador o un encargado de la cuenta registra liquidaciones.' using errcode = '42501';
  end if;
  if v_prov <> 'uber' then raise exception 'Solo se leen todavía los resúmenes de Uber Eats.' using errcode = '22023'; end if;
  if v_tienda = '' then raise exception 'El resumen no dice de qué tienda es.' using errcode = '22023'; end if;
  if v_desde is null or v_hasta is null or v_hasta < v_desde then raise exception 'El resumen no dice de qué periodo es.' using errcode = '22023'; end if;
  if v_neto is null then raise exception 'El resumen no trae el pago neto.' using errcode = '22023'; end if;

  -- La tienda: la que ya estaba (por cómo la nombra la plataforma) o una nueva, sin asignar.
  select * into v_s from public.platform_store where account_id = v_acc and company_id = p_company and provider = v_prov and lower(btrim(external_text)) = lower(v_tienda);
  if v_s.id is null then
    select id into v_canal from public.sales_channel where account_id = v_acc and (slug = 'uber' or slug like 'uber%' or name ilike 'uber%') order by (slug = 'uber') desc, created_at limit 1;
    insert into public.platform_store (account_id, company_id, provider, external_text, channel_id, created_by_name)
    values (v_acc, p_company, v_prov, v_tienda, v_canal, v_quien) returning * into v_s;
    v_nueva := true;
  else
    update public.platform_store set last_seen_at = now() where id = v_s.id;
  end if;

  -- La misma semana de la misma tienda dos veces: nada nuevo, y se dice.
  v_clave := v_prov || '-correo:' || v_s.id::text || ':' || v_desde::text || ':' || v_hasta::text;
  select * into v_ya from public.channel_settlement where account_id = v_acc and import_key = v_clave;
  if v_ya.id is not null then
    return jsonb_build_object('liquidacion_id', v_ya.id, 'ya_estaba', true, 'tienda_id', v_s.id, 'tienda_nueva', false,
      'texto', 'Esta liquidación ya estaba (del ' || to_char(v_desde, 'DD/MM') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY') || '): no se ha creado nada.');
  end if;

  insert into public.channel_settlement (
    account_id, channel_id, brand_id, location_id, external_brand_text, external_location_text, settlement_ref, period_from, period_to,
    settlement_date, period_grain, orders_count, gross_sales, base_amount, vat_amount,
    commission, other_cost, other_earnings, promo_charges, ads_spend, item_promotions, chargebacks, adjustments,
    net_payout, source, import_key, raw, needs_review, review_note, store_id, inbound_email_id, created_by_name)
  values (
    v_acc, v_s.channel_id, v_s.brand_id, v_s.location_id, nullif(p->>'marca', ''), v_tienda, nullif(p->>'referencia', ''), v_desde, v_hasta,
    coalesce(nullif(p->>'deposito_iniciado', '')::date, v_hasta + 1), case when v_hasta - v_desde = 6 then 'week' else 'weeks' end,
    nullif(p->>'pedidos', '')::int, (p->'ventas'->>'total')::numeric, (p->'ventas'->>'base')::numeric, (p->'ventas'->>'iva')::numeric,
    coalesce((p->'uber'->>'tasas')::numeric, 0), coalesce((p->'uber'->>'otros')::numeric, 0), (p->'ganancias'->>'otras')::numeric,
    (p->'marketing'->>'otrosPromo')::numeric, (p->'marketing'->>'anuncios')::numeric, (p->'marketing'->>'promociones')::numeric,
    (p->'modificaciones'->>'contracargo')::numeric, (p->'modificaciones'->>'ajustes')::numeric,
    v_neto, 'correo_' || v_prov, v_clave, p, (v_s.brand_id is null or v_s.location_id is null or v_avisos > 0),
    nullif(concat_ws(' ', case when v_s.brand_id is null or v_s.location_id is null then 'Tienda sin asignar: dale su marca y su local.' end,
                          case when v_avisos > 0 then v_avisos || case when v_avisos = 1 then ' cosa no cuadra al leer.' else ' cosas no cuadran al leer.' end end), ''),
    v_s.id, nullif(p->>'email_id', ''), v_quien)
  returning id into v_id;

  v_fac := public.conta_liquidacion_factura_proponer(v_id, v_quien);
  v_texto := 'Liquidación del ' || to_char(v_desde, 'DD/MM') || ' al ' || to_char(v_hasta, 'DD/MM/YYYY') || ' leída: neto ' ||
             public.conta_euros_exactos(v_neto) || case when v_neto <= 0 then ' (sin cobro: pasa al siguiente)' else '' end || '. ' ||
             (v_fac->>'texto') || case when v_nueva then ' Tienda nueva: dale su marca y su local.' else '' end;
  return jsonb_build_object('liquidacion_id', v_id, 'ya_estaba', false, 'tienda_id', v_s.id, 'tienda_nueva', v_nueva,
                            'factura', v_fac, 'texto', v_texto);
end $$;
revoke all on function public.conta_liquidacion_registrar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_liquidacion_registrar(uuid, jsonb, text) to authenticated, service_role;

-- 6 · Sin número, no va a Diez ----------------------------------------------------------
-- Copia de la 0110 de E05 con una guarda más: la factura de comisión de una
-- liquidación sale sin número y no se envía hasta tenerlo.
create or replace function public.conta_recibida_envio(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_i public.supplier_invoice;
  v_s public.supplier;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if v_e.source_type <> 'supplier_invoice' then
    raise exception 'Ese asiento no es de una factura recibida.' using errcode = '22023';
  end if;
  select * into v_i from public.supplier_invoice where id = v_e.source_id and account_id = v_e.account_id;
  if v_i.id is null then raise exception 'La factura de ese asiento no está.' using errcode = 'P0002'; end if;
  if v_i.source = 'liquidacion' and nullif(btrim(v_i.invoice_number), '') is null then
    raise exception 'La factura de comisión no tiene número: no va a Diez hasta tenerlo.' using errcode = '22023';
  end if;
  select * into v_s from public.supplier where id = v_i.supplier_id and account_id = v_e.account_id;

  return jsonb_build_object(
    'id', v_e.id, 'account_id', v_e.account_id, 'company_id', v_e.company_id, 'estado', v_e.status, 'fecha', v_e.entry_date,
    'factura', jsonb_build_object('numero', v_i.invoice_number, 'fecha', coalesce(v_i.invoice_date, v_e.document_date, v_e.entry_date)),
    -- E05: si la factura lleva su emisor (los riders y flotas de Catcher, en el
    -- proveedor genérico «Riders»), es el emisor el que va a Diez.
    'proveedor', jsonb_build_object('nombre', coalesce(nullif(trim(v_i.issuer_name), ''), nullif(trim(v_s.legal_name), ''), v_s.name),
                                    'nif', coalesce(nullif(trim(v_i.issuer_tax_id), ''), nullif(trim(v_s.tax_id), ''))),
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object('cuenta', a.code, 'debe', l.debit, 'haber', l.credit,
                                          'tipoIva', t.rate, 'baseIva', l.tax_base) order by l.position)
        from public.journal_line l
        join public.company_account a on a.id = l.company_account_id and a.company_id = v_e.company_id
        left join public.tax_rate t on t.id = l.tax_rate_id
       where l.entry_id = v_e.id), '[]'::jsonb),
    'documento', (select jsonb_build_object('id', d.id, 'ruta', d.storage_path, 'nombre', d.file_name, 'sha256', d.sha256)
                    from public.journal_entry_document d where d.entry_id = v_e.id and d.kind = 'factura_recibida'));
end $$;
comment on function public.conta_recibida_envio(uuid) is
  'D01 · Lo que el envío a Diez (serie 2) lee de una factura recibida: asiento, líneas con tipo y base del IVA, factura, proveedor y su documento. Solo para los de la cuenta. La de comisión de una liquidación, solo con número.';
revoke all on function public.conta_recibida_envio(uuid) from public, anon;
grant execute on function public.conta_recibida_envio(uuid) to authenticated;

-- 7 · La lectura de conta_lectura (los agentes) ------------------------------------------
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then grant select on table public.platform_store to conta_lectura; end if;
end $$;
