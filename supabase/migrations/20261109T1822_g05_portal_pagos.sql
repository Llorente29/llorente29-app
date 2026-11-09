-- supabase/migrations/20261109T1822_g05_portal_pagos.sql
-- cambia: public.conta_gc_cobro_otra_via · prueba: supabase/staging/sql/20261109_g05_portal_pagos_prueba.sql
--
-- G05 · LO QUE EL CLIENTE HACE DESDE EL PORTAL Y TOCA EL COBRO (Julio, nº 54 y
-- nº 55; lo llama Code 3 con la clave de servicio cuando su operación queda
-- hecha, como conta_recibo_parar). Code 1 no lee las tablas del portal.
-- CAMBIA (declarado arriba) el CHECK de conta_gc_cobro_otra_via.via: solo
-- AMPLÍA, con «portal_banco» y «portal_tarjeta». Y AÑADE:
--   1. conta_gestoria_ajustes.cuenta_stripe: la cuenta puente de Stripe de cada
--      empresa (tarjeta o Bizum). Sin poner, la 57200003 «Plataforma Stripe».
--      _conta_cobro_puente la crea si falta, con su apunte en el registro del
--      plan; en las cuentas de demostración, ya en esta migración.
--   2. conta_recibo_pago_portal: el pago de cada devuelto desde el portal (uno
--      por recibo: repetir la llamada no duplica nada).
--   3. conta_recibo_pagado_portal(recibo, via, importe, referencia): un recibo
--      devuelto que el cliente paga desde el portal.
--        · Con factura (devuelto después de cobrarse, ya deshecho el cobro): el
--          asiento del cobro de nuevo, la puente contra la 430 del cliente.
--        · Sin factura (devuelto antes de cobrarse): su factura y su cobro, como
--          un cobro confirmado, con la fecha de hoy y la puente de su vía.
--        · La puente: «banco» (GoCardless), la de GoCardless (57200002);
--          «tarjeta» (Stripe, tarjeta o Bizum), la de Stripe de la empresa.
--        · Sale de «Te deben» (conta_gc_cobro_otra_via, «portal_…») y su
--          historial lo dice.
--   4. conta_cobro_cuenta_cambiada(empresa, cliente, mandato nuevo, …): lo que
--      guarda conta-cobro («cambiar_cuenta») después de cancelar en GoCardless
--      la domiciliación vieja: el mandato nuevo y, si es de otro cliente de
--      GoCardless, el cliente al que se cobra (con su enlace, para que la
--      lectura lo respete). Los recibos siguientes van contra el nuevo
--      (conta_cobro_para_enviar toma el mandato vivo de ese cliente).
-- Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261109T1822_g05_portal_pagos.down.sql

-- ── 1 · La cuenta puente de Stripe de cada empresa ───────────────────────────────
alter table public.conta_gestoria_ajustes add column if not exists cuenta_stripe text;
comment on column public.conta_gestoria_ajustes.cuenta_stripe is 'G05 · La cuenta puente de Stripe (tarjeta o Bizum desde el portal). Sin poner, la 57200003 «Plataforma Stripe» (en QBO esa subcuenta es «TPV tienda online»: para QBO real se decidirá).';

-- ── 2 · «Cobrado por otra vía», también desde el portal ──────────────────────────
alter table public.conta_gc_cobro_otra_via drop constraint if exists conta_gc_cobro_otra_via_via_check;
alter table public.conta_gc_cobro_otra_via add constraint conta_gc_cobro_otra_via_via_check
  check (via = any (array['transferencia'::text, 'efectivo'::text, 'portal_banco'::text, 'portal_tarjeta'::text]));

/**
 * La cuenta puente de un cobro, con su código: si la empresa aún no la tiene, se
 * crea en su plan con su apunte en el registro del plan (company_account_log,
 * «subcuenta_creada»), como hizo la siembra de la demo con la 57200002.
 */
create or replace function public._conta_cobro_puente(p_company uuid, p_code text, p_nombre text, p_claro text, p_quien text)
returns text language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_plan text; v_d int; v_hoja text;
begin
  if exists (select 1 from public.company_account where company_id = p_company and code = p_code) then return p_code; end if;
  select account_id into v_cuenta from public.company where id = p_company;
  select a.plan, length(a.code) into v_plan, v_d from public.company_account a where a.company_id = p_company limit 1;
  if v_plan is null then raise exception 'El plan contable de la empresa no está activado.' using errcode = '23514'; end if;
  if length(p_code) <> v_d then raise exception 'La subcuenta % no tiene las % cifras del plan de la empresa.', p_code, v_d using errcode = '23514'; end if;
  select p.code into v_hoja from public.pgc_account p where p.plan = v_plan and p.is_leaf and p.valid_to is null and p_code like p.code || '%'
   order by length(p.code) desc limit 1;
  if v_hoja is null then raise exception 'La subcuenta % no cuelga de ninguna cuenta del plan.', p_code using errcode = '23514'; end if;
  insert into public.company_account (account_id, company_id, plan, code, template_code, name, plain_name, kind, source, created_by_name)
  values (v_cuenta, p_company, v_plan, p_code, v_hoja, p_nombre, p_claro, 'own', 'manual', p_quien);
  insert into public.company_account_log (account_id, company_id, que, code, detalle, despues, source, done_by_name)
  values (v_cuenta, p_company, 'subcuenta_creada', p_code, format('Subcuenta %s · %s, bajo la %s.', p_code, p_nombre, v_hoja),
          jsonb_build_object('code', p_code, 'name', p_nombre), 'manual', p_quien);
  return p_code;
end $$;
revoke all on function public._conta_cobro_puente(uuid, text, text, text, text) from public, anon, authenticated;

-- En la demo, la 57200003 «Plataforma Stripe» ya, en la empresa que cobra con GoCardless (la sociedad): se ve en
-- su plan antes del primer pago. Solo cuentas de demostración con su plan activado.
do $$
declare r record;
begin
  for r in select a.company_id from public.conta_gestoria_ajustes a join public.accounts c on c.id = a.account_id and c.is_demo
            where a.cuenta_plataforma is not null and exists (select 1 from public.company_account x where x.company_id = a.company_id) loop
    perform public._conta_cobro_puente(r.company_id, '57200003', 'Plataforma Stripe', 'Lo que Stripe ha cobrado (tarjeta o Bizum) y aún no ha ingresado en el banco', 'Sumied');
  end loop;
end $$;

-- ── 3 · El pago de un devuelto desde el portal ───────────────────────────────────
create table if not exists public.conta_recibo_pago_portal (
  recibo_id    uuid primary key references public.conta_recibo(id) on delete cascade,
  id           uuid not null default gen_random_uuid() unique,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  company_id   uuid not null references public.company(id) on delete cascade,
  via          text not null check (via in ('banco', 'tarjeta')),
  importe      numeric(14,2) not null check (importe > 0),
  referencia   text not null check (length(btrim(referencia)) between 1 and 200),
  cuenta       text not null,
  factura_id   uuid references public.customer_invoice(id) on delete set null,
  asiento_id   uuid,
  quien_name   text,
  cuando       timestamptz not null default now()
);
comment on table public.conta_recibo_pago_portal is 'G05 · El pago de un recibo devuelto que el cliente hace desde el portal (banco por GoCardless, o tarjeta o Bizum por Stripe): su vía, su referencia, la cuenta puente y el asiento. Uno por recibo.';
alter table public.conta_recibo_pago_portal enable row level security;
drop policy if exists conta_recibo_pago_portal_leer on public.conta_recibo_pago_portal;
create policy conta_recibo_pago_portal_leer on public.conta_recibo_pago_portal for select using (public.belongs_to_account(account_id));
grant select on public.conta_recibo_pago_portal to authenticated;

/** La factura y el cobro de un recibo devuelto ANTES de cobrarse, que se paga desde el portal (lo mismo que _conta_cobro_facturar, con su fecha y su puente). */
create or replace function public._conta_cobro_facturar_portal(p_recibo uuid, p_fecha date, p_puente text, p_forma text, p_referencia text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_recibo; v_aj jsonb; v_antes jsonb; v_id uuid; v_g jsonb; v_numero text; v_tipo uuid; v_ret uuid;
  v_705 uuid; v_lin jsonb := '[]'::jsonb; v_x jsonb; v_cli text; v_nombre text; v_pago uuid; v_entry uuid; v_total numeric;
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.invoice_id is not null then raise exception 'Este recibo ya tiene su factura.' using errcode = '23514'; end if;
  if v_r.enviado_por is null then raise exception 'No se sabe quién envió el cobro: la factura se emite en su nombre.' using errcode = '23514'; end if;
  if v_r.factura is null or jsonb_array_length(coalesce(v_r.factura->'lineas', '[]'::jsonb)) = 0 then raise exception 'Este recibo no tiene las líneas de su factura.' using errcode = '23514'; end if;
  v_aj := public._conta_cobro_ajustes(v_r.company_id);
  v_antes := public._conta_cobro_como(v_r.enviado_por, v_r.account_id);
  begin
    v_705 := public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_ingresos', 'Prestaciones de servicios', v_r.enviado_por_name);
    select id into v_tipo from public.tax_rate where is_system and code = 'iva_general' and rate = (v_aj->>'iva_pct')::numeric limit 1;
    if v_tipo is null then raise exception 'No encuentro el IVA general al % %%.', v_aj->>'iva_pct' using errcode = '23514'; end if;
    insert into public.company_account_link (account_id, company_id, company_account_id, entity, entity_id, role, source)
    values (v_r.account_id, v_r.company_id, public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_iva', 'IVA repercutido ' || (v_aj->>'iva_pct') || ' %', v_r.enviado_por_name),
            'tax_rate', v_tipo::text, 'repercutido', 'manual')
    on conflict (company_id, entity, entity_id, role) do nothing;
    v_cli := public._conta_cobro_cuenta_cliente(v_r.company_id, v_r.party_id, v_r.enviado_por_name);
    if (v_aj->>'retencion_pct')::numeric > 0 then
      perform public._conta_cobro_cuenta(v_r.company_id, v_aj->>'cuenta_retencion', 'Hacienda Pública, retenciones y pagos a cuenta', v_r.enviado_por_name);
      select id into v_ret from public.withholding_rate where is_system and code = case when (v_aj->>'retencion_pct')::numeric = 7 then 'profesional_inicio' else 'profesional' end limit 1;
    end if;
    for v_x in select * from jsonb_array_elements(v_r.factura->'lineas') loop
      v_lin := v_lin || jsonb_build_array(jsonb_build_object('concepto', v_x->>'concepto', 'cantidad', (v_x->>'cantidad')::numeric,
        'precio', (v_x->>'precioCent')::numeric / 100, 'descuento', 0, 'tipo_id', v_tipo, 'cuenta_id', v_705));
    end loop;
    v_g := public.conta_venta_guardar(v_r.company_id, null, jsonb_build_object('cliente_id', v_r.party_id, 'fecha', p_fecha, 'serie', v_aj->>'serie',
      'retencion_id', v_ret, 'notas', 'Recibo de ' || v_r.mes || ', devuelto y pagado después desde el portal.'), v_lin, v_r.enviado_por_name);
    v_id := (v_g->>'id')::uuid;
    v_total := (v_g->>'total')::numeric;
    if round(v_total * 100) <> coalesce(v_r.cobrar_cent, v_r.total_cent) then
      raise exception 'La factura saldría por % € y el recibo es de % €: no se emite.', v_total, coalesce(v_r.cobrar_cent, v_r.total_cent) / 100.0 using errcode = '23514';
    end if;
    perform public.conta_venta_emitir(v_id, v_r.enviado_por_name);
    select number_text into v_numero from public.customer_invoice where id = v_id;
    perform public.conta_venta_cobrar(v_id, p_fecha, v_total, p_forma, p_referencia, v_r.enviado_por_name);
    select id into v_pago from public.customer_invoice_payment where invoice_id = v_id order by created_at desc limit 1;
    select name into v_nombre from public.party where id = v_r.party_id;
    v_entry := public._conta_cobro_asiento(v_r.company_id, p_fecha, v_numero || '-' || coalesce(v_nombre, 'Cliente'), v_numero, v_r.party_id, v_pago,
      jsonb_build_array(
        jsonb_build_object('cuenta', p_puente, 'concepto', v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', v_total, 'haber', 0),
        jsonb_build_object('cuenta', v_cli, 'tercero_id', v_r.party_id, 'concepto', v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', 0, 'haber', v_total)),
      v_r.enviado_por_name, v_r.enviado_por);
    update public.customer_invoice_payment set entry_id = v_entry where id = v_pago;
  exception when others then
    perform public._conta_cobro_dejar(v_antes);
    raise;
  end;
  perform public._conta_cobro_dejar(v_antes);
  update public.conta_recibo set invoice_id = v_id, asiento_cobro = v_entry, confirmado_el = p_fecha, updated_at = now() where id = p_recibo;
  return jsonb_build_object('factura', v_id, 'numero', v_numero, 'asiento', v_entry);
end $$;
revoke all on function public._conta_cobro_facturar_portal(uuid, date, text, text, text) from public, anon, authenticated;

/**
 * Un recibo devuelto que el cliente paga desde el portal. Lo llama Code 3 con
 * la clave de servicio cuando su operación queda hecha (o la gestoría).
 * p_via: 'banco' (GoCardless) o 'tarjeta' (Stripe: tarjeta o Bizum). p_importe,
 * en euros: el del recibo. Repetirla con la misma referencia no duplica nada.
 */
create or replace function public.conta_recibo_pagado_portal(p_recibo uuid, p_via text, p_importe numeric, p_referencia text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_r public.conta_recibo; v_ya public.conta_recibo_pago_portal; v_servidor boolean := coalesce(auth.role(), '') = 'service_role';
  v_aj jsonb; v_puente text; v_nombre_puente text; v_ref text := nullif(btrim(coalesce(p_referencia, '')), ''); v_fecha date := public.conta_hoy();
  v_cent int; v_f jsonb; v_entry uuid; v_numero text; v_nombre text; v_cli text; v_antes jsonb; v_quien text; v_id uuid := gen_random_uuid();
begin
  select * into v_r from public.conta_recibo where id = p_recibo for update;
  if v_r.id is null or not (v_servidor or public.belongs_to_account(v_r.account_id)) then raise exception 'Ese recibo no está.' using errcode = 'P0002'; end if;
  if not (v_servidor or public.current_user_is_admin_or_manager_of(v_r.account_id)) then
    raise exception 'El pago de un devuelto lo apunta el portal (su servidor) o la gestoría.' using errcode = '42501';
  end if;
  if p_via not in ('banco', 'tarjeta') then raise exception 'La vía es «banco» o «tarjeta».' using errcode = '22023'; end if;
  if v_ref is null or length(v_ref) > 200 then raise exception 'Falta la referencia del pago (la de GoCardless o la de Stripe).' using errcode = '22023'; end if;
  -- Repetir no duplica: la misma referencia devuelve lo hecho; otra, es un error.
  select * into v_ya from public.conta_recibo_pago_portal where recibo_id = p_recibo;
  if v_ya.recibo_id is not null then
    if v_ya.referencia = v_ref then
      return jsonb_build_object('id', p_recibo, 'ya', true, 'factura', v_ya.factura_id, 'asiento', v_ya.asiento_id,
        'frase', format('Ya estaba apuntado: el recibo de %s se pagó desde el portal (%s).', v_r.mes, case v_ya.via when 'banco' then 'desde el banco' else 'con tarjeta o Bizum' end));
    end if;
    raise exception 'Este recibo ya se pagó desde el portal con otra referencia (%).', v_ya.referencia using errcode = '23505';
  end if;
  if v_r.estado not in ('devuelto', 'retrocedido') then raise exception 'Este recibo no está devuelto: no hay nada que pagar desde el portal.' using errcode = '23514'; end if;
  v_cent := coalesce(v_r.cobrar_cent, v_r.total_cent);
  if p_importe is null or round(p_importe * 100) <> v_cent then
    raise exception 'El recibo es de % y el pago, de %: no se apunta.', public._conta_gestoria_euros(v_cent / 100.0), public._conta_gestoria_euros(coalesce(p_importe, 0)) using errcode = '23514';
  end if;
  v_aj := public._conta_cobro_ajustes(v_r.company_id);
  if p_via = 'banco' then
    v_puente := v_aj->>'cuenta_plataforma'; v_nombre_puente := 'Plataforma GoCardless';
  else
    select coalesce(a.cuenta_stripe, '57200003') into v_puente from public.conta_gestoria_ajustes a where a.company_id = v_r.company_id;
    v_puente := coalesce(v_puente, '57200003'); v_nombre_puente := 'Plataforma Stripe';
  end if;
  v_quien := case when v_servidor then 'El cliente, desde el portal' else public.conta_nombre_actor() end;
  -- La puente con su código (si no existe, se crea en el plan con su apunte en el registro, como la 57200002).
  perform public._conta_cobro_puente(v_r.company_id, v_puente, v_nombre_puente,
    case p_via when 'banco' then 'Lo que GoCardless ha cobrado y aún no ha ingresado en el banco' else 'Lo que Stripe ha cobrado (tarjeta o Bizum) y aún no ha ingresado en el banco' end,
    coalesce(v_r.enviado_por_name, v_quien));

  if v_r.invoice_id is null then
    -- Devuelto antes de cobrarse: su factura y su cobro, ahora.
    v_f := public._conta_cobro_facturar_portal(p_recibo, v_fecha, v_puente, case p_via when 'banco' then 'GoCardless' else 'Tarjeta (Stripe)' end, 'Portal ' || v_ref);
    v_entry := (v_f->>'asiento')::uuid; v_numero := v_f->>'numero';
  else
    -- Devuelto después de cobrarse (el cobro ya se deshizo): el asiento del cobro de nuevo, la puente contra la 430.
    select number_text into v_numero from public.customer_invoice where id = v_r.invoice_id;
    select name into v_nombre from public.party where id = v_r.party_id;
    if v_r.enviado_por is null then raise exception 'No se sabe quién envió el cobro: el asiento se hace en su nombre.' using errcode = '23514'; end if;
    v_antes := public._conta_cobro_como(v_r.enviado_por, v_r.account_id);
    begin
      v_cli := public._conta_cobro_cuenta_cliente(v_r.company_id, v_r.party_id, v_r.enviado_por_name);
      -- Su origen, el pago del portal (el recibo ya es el de la devolución).
      v_entry := public._conta_cobro_asiento(v_r.company_id, v_fecha, 'Pagado desde el portal ' || v_numero || '-' || coalesce(v_nombre, 'Cliente'), v_numero, v_r.party_id, v_id,
        jsonb_build_array(
          jsonb_build_object('cuenta', v_puente, 'concepto', 'Pagado desde el portal ' || v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', v_cent / 100.0, 'haber', 0),
          jsonb_build_object('cuenta', v_cli, 'tercero_id', v_r.party_id, 'concepto', 'Pagado desde el portal ' || v_numero || '-' || coalesce(v_nombre, 'Cliente'), 'debe', 0, 'haber', v_cent / 100.0)),
        v_r.enviado_por_name, v_r.enviado_por);
    exception when others then
      perform public._conta_cobro_dejar(v_antes);
      raise;
    end;
    perform public._conta_cobro_dejar(v_antes);
  end if;

  insert into public.conta_recibo_pago_portal (recibo_id, id, account_id, company_id, via, importe, referencia, cuenta, factura_id, asiento_id, quien_name)
  values (p_recibo, v_id, v_r.account_id, v_r.company_id, p_via, v_cent / 100.0, v_ref, v_puente, (select invoice_id from public.conta_recibo where id = p_recibo), v_entry, v_quien);
  -- Sale de «Te deben»: el cargo devuelto de GoCardless, cobrado por otra vía (el portal).
  if v_r.gc_cobro_id is not null then
    insert into public.conta_gc_cobro_otra_via (company_id, gc_id, account_id, via, fecha, nota, quien_name)
    values (v_r.company_id, v_r.gc_cobro_id, v_r.account_id, 'portal_' || p_via, v_fecha, 'Pagado desde el portal · ' || v_ref, v_quien)
    on conflict (company_id, gc_id) do update set via = excluded.via, fecha = excluded.fecha, nota = excluded.nota, quien_name = excluded.quien_name, cuando = now();
  end if;
  update public.conta_recibo set updated_at = now() where id = p_recibo;
  perform public._conta_cobro_evento(p_recibo, 'pagado_portal',
    format('Pagado desde el portal %s (%s): %s. Asiento: %s contra la 430 del cliente%s.', case p_via when 'banco' then 'desde el banco' else 'con tarjeta o Bizum' end,
      v_ref, public._conta_gestoria_euros(v_cent / 100.0), v_puente, case when v_f is not null then format('; su factura, %s', v_numero) else '' end),
    jsonb_build_object('via', p_via, 'referencia', v_ref, 'asiento', v_entry, 'cuenta', v_puente), v_quien);
  return jsonb_build_object('id', p_recibo, 'factura', (select invoice_id from public.conta_recibo where id = p_recibo), 'numero', v_numero, 'asiento', v_entry, 'cuenta', v_puente,
    'frase', format('Apuntado: el recibo de %s (%s) pagado desde el portal %s. Ya no sale en «Te deben».', v_r.mes, public._conta_gestoria_euros(v_cent / 100.0),
      case p_via when 'banco' then 'desde el banco' else 'con tarjeta o Bizum' end));
end $$;
revoke all on function public.conta_recibo_pagado_portal(uuid, text, numeric, text) from public, anon;
grant execute on function public.conta_recibo_pagado_portal(uuid, text, numeric, text) to authenticated, service_role;
comment on function public.conta_recibo_pagado_portal(uuid, text, numeric, text) is
  'G05 · nº 55 · Un recibo devuelto que el cliente paga desde el portal (banco por GoCardless o tarjeta/Bizum por Stripe): su asiento contra la puente de su vía (y, si aún no la tenía, su factura), sale de «Te deben» y su historial lo dice. Repetir no duplica.';

-- ── 4 · Cambiar de cuenta: lo que guarda conta-cobro después de cancelar la vieja ─
create or replace function public.conta_cobro_cuenta_cambiada(p_company uuid, p_party uuid, p_mandato_nuevo text, p_cliente_gc text,
  p_cancelados text[], p_quien text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_cc public.conta_cobro_cliente; v_quien text := coalesce(nullif(btrim(coalesce(p_quien, '')), ''), 'El cliente, desde el portal');
  v_nombre text;
begin
  -- Solo el servidor (conta-cobro, «cambiar_cuenta»), que antes ha cancelado en GoCardless.
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Esto lo guarda el servidor del cobro.' using errcode = '42501'; end if;
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select * into v_cc from public.conta_cobro_cliente where company_id = p_company and party_id = p_party;
  if v_cc.party_id is null then raise exception 'Ese cliente no se cobra en esta empresa.' using errcode = 'P0002'; end if;
  if nullif(btrim(coalesce(p_mandato_nuevo, '')), '') is null or nullif(btrim(coalesce(p_cliente_gc, '')), '') is null then
    raise exception 'Falta el mandato nuevo o su cliente de GoCardless.' using errcode = '22023';
  end if;
  insert into public.conta_gc_mandato (company_id, gc_id, account_id, gc_cliente_id, estado, creado, leido_at)
  values (p_company, p_mandato_nuevo, v_cuenta, p_cliente_gc, 'active', now(), now())
  on conflict (company_id, gc_id) do update set gc_cliente_id = excluded.gc_cliente_id, estado = 'active', leido_at = now();
  update public.conta_gc_mandato set estado = 'cancelled', leido_at = now()
   where company_id = p_company and gc_id = any (coalesce(p_cancelados, '{}')) and gc_id <> p_mandato_nuevo;
  if v_cc.gc_cliente_id is distinct from p_cliente_gc then
    update public.conta_cobro_cliente set gc_cliente_id = p_cliente_gc, gc_casado_por = 'persona', updated_at = now(), updated_by_name = v_quien
     where company_id = p_company and party_id = p_party;
    -- El enlace, para que la lectura de GoCardless lo respete (manda sobre el casado).
    insert into public.conta_gestoria_decision (account_id, company_id, tipo, party_id, gc_cliente_id, frase, quien_name)
    values (v_cuenta, p_company, 'enlace', p_party, p_cliente_gc, 'Cuenta de cargo cambiada desde el portal: la domiciliación nueva es de este cliente de GoCardless.', v_quien);
  end if;
  select name into v_nombre from public.party where id = p_party;
  return jsonb_build_object('mandato', p_mandato_nuevo, 'cancelados', coalesce(p_cancelados, '{}'),
    'frase', format('Cambiada la cuenta de %s: los recibos siguientes se cargan en la domiciliación nueva%s.', coalesce(v_nombre, 'el cliente'),
      case when cardinality(coalesce(p_cancelados, '{}')) > 0 then format(' y la vieja está cancelada en GoCardless (%s)', array_to_string(p_cancelados, ', ')) else '' end));
end $$;
revoke all on function public.conta_cobro_cuenta_cambiada(uuid, uuid, text, text, text[], text) from public, anon, authenticated;
grant execute on function public.conta_cobro_cuenta_cambiada(uuid, uuid, text, text, text[], text) to service_role;
