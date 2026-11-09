-- supabase/migrations/20261109T2027_g05_apuntar_pendiente.sql
--
-- G05 · APUNTAR UN PAGO CON TARJETA QUE QUEDÓ PENDIENTE Y PONER LA CUENTA DE
-- STRIPE (Julio, nº 59 a nº 61, punto 2; la maqueta, «Pagos con tarjeta»,
-- Stripe.dc.html v23). Un pago con tarjeta desde el portal sin la cuenta de
-- Stripe en Ajustes (o con una que no vale) quedó en «Pendiente de revisar»
-- (falta_cuenta_stripe, 1822): el recibo devuelto, sin factura (si no la tenía)
-- hasta que se apunte. Esto es lo que usan Ajustes › Cobros y la ficha del
-- cliente. Solo AÑADE funciones:
--   1. conta_cobro_cuenta_stripe_poner(empresa, código): pone (o quita, con
--      null) la cuenta puente de Stripe. Una subcuenta 572 de las cifras del
--      plan. Si no existe, se crea «Plataforma Stripe» con su apunte en el
--      registro del plan. Si existe con otro nombre o es la de un banco, NO se
--      guarda y lo dice (guardada: false, con el nombre y el banco).
--   2. conta_recibo_apuntar_pendiente(incidencia): «Apuntar el pago». El pago
--      que guarda la incidencia, con conta_recibo_pagado_portal, en nombre de
--      quien pulsa; devuelve la factura (y si es nueva) y sus dos asientos con
--      sus apuntes, para el bloque verde. Si la cuenta aún no vale, no se apunta.
--   3. conta_cobro_apuntar_pendientes(empresa): «Apuntar los N pagos», uno a uno;
--      uno que no se puede no para a los demás, y se dice cuál y por qué.
--   4. conta_cobro_cuenta_stripe_leer(empresa): lo que enseñan las pantallas: la
--      cuenta puesta y cómo está (sin poner, bien, otro nombre, de un banco), los
--      pagos que esperan (cliente, mes, importe, el día que pagó, referencia) y
--      los apuntados hoy.
-- De un administrador o un encargado de la cuenta (leer, de quien es de la
-- cuenta). Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261109T2027_g05_apuntar_pendiente.down.sql

/** Cómo está una cuenta de Stripe: su nombre en el plan, el motivo si no vale y, si es de un banco, el nombre del banco. */
create or replace function public._conta_cobro_stripe_estado(p_company uuid, p_code text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cuenta', nullif(btrim(coalesce(p_code, '')), ''),
    'nombre', (select x.name from public.company_account x where x.company_id = p_company and x.code = p_code),
    'motivo', public._conta_cobro_stripe_no_vale(p_company, nullif(btrim(coalesce(p_code, '')), '')),
    'banco', (select coalesce(nullif(t.short_name, ''), t.name, x.name)
                from public.company_account x join public.company_account_link k on k.company_account_id = x.id and k.entity = 'bank_account'
                left join public.treasury_account t on t.id::text = k.entity_id
               where x.company_id = p_company and x.code = p_code limit 1))
$$;
revoke all on function public._conta_cobro_stripe_estado(uuid, text) from public, anon, authenticated;

/** El día que pagó: el de la primera incidencia de ese recibo (al reintentar, la de antes deja de estar vigente y entra otra). */
create or replace function public._conta_cobro_stripe_pagado_el(p_company uuid, p_recibo text)
returns timestamptz language sql stable security definer set search_path = public as $$
  select min(created_at) from public.conta_gestoria_diferencia where company_id = p_company and tipo = 'falta_cuenta_stripe' and datos->>'recibo' = p_recibo
$$;
revoke all on function public._conta_cobro_stripe_pagado_el(uuid, text) from public, anon, authenticated;

/** Los asientos de un pago apuntado: el de la factura (si la hay) y el del cobro, con sus apuntes. */
create or replace function public._conta_cobro_asientos_pago(p_factura uuid, p_cobro uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tipo', q.tipo, 'id', e.id, 'numero', e.number, 'fecha', e.entry_date,
      'apuntes', (select coalesce(jsonb_agg(jsonb_build_object('codigo', c.code, 'nombre', c.name, 'debe', l.debit, 'haber', l.credit) order by l.position), '[]'::jsonb)
                    from public.journal_line l join public.company_account c on c.id = l.company_account_id where l.entry_id = e.id)) order by q.orden), '[]'::jsonb)
    from (select 'factura'::text as tipo, 1 as orden, (select entry_id from public.customer_invoice where id = p_factura) as id
          union all select 'cobro', 2, p_cobro) q
    join public.journal_entry e on e.id = q.id
$$;
revoke all on function public._conta_cobro_asientos_pago(uuid, uuid) from public, anon, authenticated;

-- ── 1 · Poner (o quitar) la cuenta de Stripe de la empresa ─────────────────────────
create or replace function public.conta_cobro_cuenta_stripe_poner(p_company uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_quien text := public.conta_nombre_actor(); v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_d int; v_est jsonb; v_n int;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then raise exception 'Solo un administrador o un encargado cambia los ajustes del cobro.' using errcode = '42501'; end if;
  select count(*)::int into v_n from public.conta_gestoria_diferencia where company_id = p_company and tipo = 'falta_cuenta_stripe' and vigente;
  if v_code is null then
    insert into public.conta_gestoria_ajustes (company_id, account_id, cuenta_stripe, updated_by_name) values (p_company, v_cuenta, null, v_quien)
    on conflict (company_id) do update set cuenta_stripe = null, updated_at = now(), updated_by_name = excluded.updated_by_name;
    return jsonb_build_object('guardada', true, 'cuenta', null, 'motivo', 'sin_cuenta', 'pendientes', v_n,
      'frase', 'Quitada la cuenta de Stripe: los pagos con tarjeta desde el portal quedarán en «Pendiente de revisar» hasta que pongas una.');
  end if;
  select length(a.code) into v_d from public.company_account a where a.company_id = p_company limit 1;
  if v_d is null then raise exception 'El plan contable de la empresa no está activado.' using errcode = '23514'; end if;
  if v_code !~ '^572[0-9]+$' or length(v_code) <> v_d then
    raise exception 'La cuenta de Stripe es una subcuenta de la 572 de % cifras (por ejemplo, 57200003).', v_d using errcode = '22023';
  end if;
  -- Nunca a ciegas: de un banco o con otro nombre, no se guarda (y se dice, con su nombre).
  v_est := public._conta_cobro_stripe_estado(p_company, v_code);
  if v_est->>'motivo' is not null then
    return v_est || jsonb_build_object('guardada', false, 'pendientes', v_n,
      'frase', case v_est->>'motivo'
        when 'de_banco' then format('No se ha guardado: la %s es tu banco (%s). Elige otra 572, por ejemplo la 57200003.', v_code, v_est->>'banco')
        else format('No se ha guardado: la %s ya existe y se llama «%s». Elige otra 572, por ejemplo la 57200003.', v_code, v_est->>'nombre') end);
  end if;
  -- Si no existe, se crea «Plataforma Stripe» con su apunte en el registro del plan.
  perform public._conta_cobro_puente(p_company, v_code, 'Plataforma Stripe', 'Lo que Stripe ha cobrado (tarjeta o Bizum) y aún no ha ingresado en el banco', v_quien);
  insert into public.conta_gestoria_ajustes (company_id, account_id, cuenta_stripe, updated_by_name) values (p_company, v_cuenta, v_code, v_quien)
  on conflict (company_id) do update set cuenta_stripe = excluded.cuenta_stripe, updated_at = now(), updated_by_name = excluded.updated_by_name;
  return public._conta_cobro_stripe_estado(p_company, v_code) || jsonb_build_object('guardada', true, 'pendientes', v_n,
    'frase', format('Guardada: la cuenta de Stripe es la %s «Plataforma Stripe».%s', v_code,
      case when v_n = 0 then '' when v_n = 1 then ' Hay 1 pago con tarjeta esperando: apúntalo desde aquí o desde la ficha del cliente.'
           else format(' Hay %s pagos con tarjeta esperando: apúntalos desde aquí o desde la ficha de cada cliente.', v_n) end));
end $$;
revoke all on function public.conta_cobro_cuenta_stripe_poner(uuid, text) from public, anon;
grant execute on function public.conta_cobro_cuenta_stripe_poner(uuid, text) to authenticated;
comment on function public.conta_cobro_cuenta_stripe_poner(uuid, text) is
  'G05 · nº 60/61 · Ajustes › Cobros: la cuenta puente de Stripe de la empresa (una 572 de las cifras del plan). Si no existe, se crea «Plataforma Stripe» con su registro; con otro nombre o de un banco, no se guarda y lo dice. null la quita.';

-- ── 2 · «Apuntar el pago» de una incidencia ─────────────────────────────────────────
create or replace function public.conta_recibo_apuntar_pendiente(p_diferencia uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.conta_gestoria_diferencia; r jsonb; v_recibo uuid; v_antes uuid; v_factura uuid; v_pago public.conta_recibo_pago_portal;
begin
  select * into v_d from public.conta_gestoria_diferencia where id = p_diferencia;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Esa incidencia no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then raise exception 'Solo un administrador o un encargado apunta un pago.' using errcode = '42501'; end if;
  if v_d.tipo <> 'falta_cuenta_stripe' then raise exception 'Esta incidencia no es un pago pendiente de apuntar.' using errcode = '22023'; end if;
  v_recibo := (v_d.datos->>'recibo')::uuid;
  select * into v_pago from public.conta_recibo_pago_portal where recibo_id = v_recibo;
  if not v_d.vigente then
    if v_pago.recibo_id is not null then
      return jsonb_build_object('apuntado', true, 'ya', true, 'frase', 'Ya estaba apuntado: este pago ya está en la contabilidad.');
    end if;
    raise exception 'Esta incidencia ya no está vigente: mira la de ahora en «Pendiente de revisar».' using errcode = '23514';
  end if;
  select invoice_id into v_antes from public.conta_recibo where id = v_recibo;
  -- El mismo pago que guardó el portal, en nombre de quien pulsa (la función comprueba todo otra vez).
  r := public.conta_recibo_pagado_portal(v_recibo, v_d.datos->>'via', (v_d.datos->>'importe')::numeric, v_d.datos->>'referencia');
  if not (coalesce((r->>'apuntado')::boolean, false) or coalesce((r->>'ya')::boolean, false)) then return r; end if;
  select * into v_pago from public.conta_recibo_pago_portal where recibo_id = v_recibo;
  v_factura := coalesce(v_pago.factura_id, (select invoice_id from public.conta_recibo where id = v_recibo));
  return r || jsonb_build_object('apuntado', true, 'recibo', v_recibo, 'mes', v_d.datos->>'mes', 'importe', (v_d.datos->>'importe')::numeric,
    'factura', v_factura, 'numero', (select number_text from public.customer_invoice where id = v_factura),
    'factura_nueva', v_antes is null and v_factura is not null,
    'quien', v_pago.quien_name, 'cuando', v_pago.cuando,
    'asientos', public._conta_cobro_asientos_pago(v_factura, v_pago.asiento_id));
end $$;
revoke all on function public.conta_recibo_apuntar_pendiente(uuid) from public, anon;
grant execute on function public.conta_recibo_apuntar_pendiente(uuid) to authenticated;
comment on function public.conta_recibo_apuntar_pendiente(uuid) is
  'G05 · nº 60/61 · «Apuntar el pago» de una incidencia falta_cuenta_stripe: el pago con tarjeta que guardó el portal, en nombre de quien pulsa, con su factura (si no la tenía, sale ahora) y sus dos asientos. Si la cuenta de Stripe aún no vale, no se apunta y lo dice.';

-- ── 3 · «Apuntar los N pagos» ───────────────────────────────────────────────────────
create or replace function public.conta_cobro_apuntar_pendientes(p_company uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_x record; r jsonb; v_ok jsonb := '[]'::jsonb; v_no jsonb := '[]'::jsonb;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then raise exception 'Solo un administrador o un encargado apunta un pago.' using errcode = '42501'; end if;
  for v_x in select d.id, p.name as cliente from public.conta_gestoria_diferencia d left join public.party p on p.id = d.party_id
              where d.company_id = p_company and d.tipo = 'falta_cuenta_stripe' and d.vigente order by d.created_at loop
    begin
      r := public.conta_recibo_apuntar_pendiente(v_x.id);
      if coalesce((r->>'apuntado')::boolean, false) then v_ok := v_ok || jsonb_build_array(r || jsonb_build_object('cliente', v_x.cliente));
      else v_no := v_no || jsonb_build_array(jsonb_build_object('cliente', v_x.cliente, 'frase', r->>'frase')); end if;
    exception when others then
      v_no := v_no || jsonb_build_array(jsonb_build_object('cliente', v_x.cliente, 'frase', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('apuntados', v_ok, 'no', v_no,
    'frase', case
      when jsonb_array_length(v_ok) = 0 and jsonb_array_length(v_no) = 0 then 'Ningún pago con tarjeta esperaba: no había nada que apuntar.'
      when jsonb_array_length(v_no) = 0 then format('Apuntados %s %s con tarjeta, con su factura y su asiento.', jsonb_array_length(v_ok), case when jsonb_array_length(v_ok) = 1 then 'pago' else 'pagos' end)
      else format('Apuntados %s de %s pagos con tarjeta. Sin apuntar: %s.', jsonb_array_length(v_ok), jsonb_array_length(v_ok) + jsonb_array_length(v_no),
             (select string_agg(coalesce(x->>'cliente', 'un cliente') || ' (' || (x->>'frase') || ')', '; ') from jsonb_array_elements(v_no) x)) end);
end $$;
revoke all on function public.conta_cobro_apuntar_pendientes(uuid) from public, anon;
grant execute on function public.conta_cobro_apuntar_pendientes(uuid) to authenticated;
comment on function public.conta_cobro_apuntar_pendientes(uuid) is
  'G05 · nº 61 · Ajustes › Cobros, «Apuntar los N pagos»: cada pago con tarjeta que espera, uno a uno; uno que no se puede no para a los demás y se dice.';

-- ── 4 · Lo que enseñan las pantallas ────────────────────────────────────────────────
create or replace function public.conta_cobro_cuenta_stripe_leer(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v_code text; v_hoy date := (now() at time zone 'Europe/Madrid')::date;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select nullif(btrim(cuenta_stripe), '') into v_code from public.conta_gestoria_ajustes where company_id = p_company;
  return public._conta_cobro_stripe_estado(p_company, v_code) || jsonb_build_object(
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'recibo', d.datos->>'recibo', 'cliente', p.name, 'party_id', d.party_id,
        'mes', d.datos->>'mes', 'importe', (d.datos->>'importe')::numeric, 'referencia', d.datos->>'referencia',
        'pagado_el', public._conta_cobro_stripe_pagado_el(p_company, d.datos->>'recibo'), 'porque', d.porque,
        -- La factura que ya tiene el recibo (la de un retrocedido después de cobrarse); sin ella, sale al apuntar.
        'numero', (select ci.number_text from public.conta_recibo rr join public.customer_invoice ci on ci.id = rr.invoice_id where rr.id = (d.datos->>'recibo')::uuid)) order by d.created_at)
      from public.conta_gestoria_diferencia d left join public.party p on p.id = d.party_id
     where d.company_id = p_company and d.tipo = 'falta_cuenta_stripe' and d.vigente), '[]'::jsonb),
    -- Los apuntados hoy que habían esperado a la cuenta de Stripe.
    'apuntados_hoy', coalesce((select jsonb_agg(jsonb_build_object('recibo', g.recibo_id, 'cliente', p.name, 'party_id', r.party_id, 'mes', r.mes,
        'importe', g.importe, 'referencia', g.referencia, 'pagado_el', public._conta_cobro_stripe_pagado_el(p_company, g.recibo_id::text),
        'cuando', g.cuando, 'quien', g.quien_name, 'factura', g.factura_id, 'numero', (select number_text from public.customer_invoice where id = g.factura_id)) order by g.cuando)
      from public.conta_recibo_pago_portal g join public.conta_recibo r on r.id = g.recibo_id left join public.party p on p.id = r.party_id
     where g.company_id = p_company and g.via = 'tarjeta' and (g.cuando at time zone 'Europe/Madrid')::date = v_hoy
       and exists (select 1 from public.conta_gestoria_diferencia d where d.company_id = p_company and d.tipo = 'falta_cuenta_stripe' and d.datos->>'recibo' = g.recibo_id::text)), '[]'::jsonb));
end $$;
revoke all on function public.conta_cobro_cuenta_stripe_leer(uuid) from public, anon;
grant execute on function public.conta_cobro_cuenta_stripe_leer(uuid) to authenticated;
comment on function public.conta_cobro_cuenta_stripe_leer(uuid) is
  'G05 · nº 60/61 · Ajustes › Cobros y la ficha: la cuenta de Stripe puesta y cómo está (motivo, nombre en el plan, banco), los pagos con tarjeta que esperan y los apuntados hoy.';
