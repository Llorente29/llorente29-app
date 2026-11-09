-- supabase/migrations/20261109T2027_g05_apuntar_pendiente.sql
--
-- G05 · APUNTAR UN PAGO QUE QUEDÓ PENDIENTE Y PONER LA CUENTA DE STRIPE (Julio,
-- nº 59 y nº 60, punto 2). Un pago con tarjeta desde el portal sin la cuenta de
-- Stripe en Ajustes (o con una que no vale) quedó en «Pendiente de revisar»
-- (falta_cuenta_stripe, 1822). Hoy solo se apunta volviendo a llamar a
-- conta_recibo_pagado_portal; esto es lo que usarán la pantalla de Ajustes del
-- cobro y el botón de la incidencia (su maqueta, aparte). Solo AÑADE:
--   1. conta_cobro_cuenta_stripe_poner(empresa, código): pone (o quita, con
--      null) la cuenta puente de Stripe de la empresa. Una subcuenta 572 de las
--      cifras del plan. Si no existe, se crea «Plataforma Stripe» con su apunte
--      en el registro del plan; si existe con otro nombre o es la de un banco,
--      para y lo dice (nunca la usa a ciegas). Dice cuántos pagos esperan.
--   2. conta_recibo_apuntar_pendiente(incidencia): el botón. Apunta el pago que
--      guarda la incidencia (vía, importe y referencia) con
--      conta_recibo_pagado_portal, en nombre de quien pulsa. Si la cuenta aún no
--      vale, no se apunta y lo dice (la incidencia sigue, con el motivo de ahora).
--   3. conta_cobro_cuenta_stripe_leer(empresa): lo que enseña la pantalla: la
--      cuenta puesta, su nombre en el plan, si vale, y los pagos que esperan.
-- Las tres, de un administrador o un encargado de la cuenta. Nada en el camino
-- del pedido. Vuelta atrás: supabase/vuelta-atras/20261109T2027_g05_apuntar_pendiente.down.sql

/** Cuántos pagos con tarjeta esperan a la cuenta de Stripe en una empresa (incidencias vigentes). */
create or replace function public._conta_cobro_pendientes_stripe(p_company uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.conta_gestoria_diferencia where company_id = p_company and tipo = 'falta_cuenta_stripe' and vigente
$$;
revoke all on function public._conta_cobro_pendientes_stripe(uuid) from public, anon, authenticated;

-- ── 1 · Poner (o quitar) la cuenta de Stripe de la empresa ─────────────────────────
create or replace function public.conta_cobro_cuenta_stripe_poner(p_company uuid, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_quien text := public.conta_nombre_actor(); v_code text := nullif(btrim(coalesce(p_code, '')), '');
  v_d int; v_no text; v_nombre text; v_n int; v_espera text;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_cuenta) then raise exception 'Solo un administrador o un encargado cambia los ajustes del cobro.' using errcode = '42501'; end if;
  v_n := public._conta_cobro_pendientes_stripe(p_company);
  v_espera := case when v_n = 0 then '' when v_n = 1 then ' Hay 1 pago con tarjeta esperando: apúntalo desde «Pendiente de revisar».'
                   else format(' Hay %s pagos con tarjeta esperando: apúntalos desde «Pendiente de revisar».', v_n) end;
  if v_code is null then
    insert into public.conta_gestoria_ajustes (company_id, account_id, cuenta_stripe, updated_by_name) values (p_company, v_cuenta, null, v_quien)
    on conflict (company_id) do update set cuenta_stripe = null, updated_at = now(), updated_by_name = excluded.updated_by_name;
    return jsonb_build_object('cuenta', null, 'frase', 'Quitada la cuenta de Stripe: los pagos con tarjeta desde el portal quedarán en «Pendiente de revisar» hasta que pongas una.');
  end if;
  select length(a.code) into v_d from public.company_account a where a.company_id = p_company limit 1;
  if v_d is null then raise exception 'El plan contable de la empresa no está activado.' using errcode = '23514'; end if;
  if v_code !~ '^572[0-9]+$' or length(v_code) <> v_d then
    raise exception 'La cuenta de Stripe es una subcuenta de la 572 de % cifras (por ejemplo, 57200003).', v_d using errcode = '22023';
  end if;
  v_no := public._conta_cobro_stripe_no_vale(p_company, v_code);
  if v_no is not null then
    select name into v_nombre from public.company_account where company_id = p_company and code = v_code;
    raise exception '%', case v_no
      when 'de_banco' then format('La %s es la de un banco («%s»): no puede ser la cuenta de Stripe.', v_code, v_nombre)
      else format('La %s ya existe como «%s», no como «Plataforma Stripe»: no se usa a ciegas. Elige otra o cámbiale el nombre en el plan.', v_code, v_nombre) end
      using errcode = '23514';
  end if;
  -- Si no existe, se crea «Plataforma Stripe» con su apunte en el registro del plan.
  perform public._conta_cobro_puente(p_company, v_code, 'Plataforma Stripe', 'Lo que Stripe ha cobrado (tarjeta o Bizum) y aún no ha ingresado en el banco', v_quien);
  insert into public.conta_gestoria_ajustes (company_id, account_id, cuenta_stripe, updated_by_name) values (p_company, v_cuenta, v_code, v_quien)
  on conflict (company_id) do update set cuenta_stripe = excluded.cuenta_stripe, updated_at = now(), updated_by_name = excluded.updated_by_name;
  return jsonb_build_object('cuenta', v_code, 'pendientes', v_n,
    'frase', format('Guardada: la cuenta de Stripe es la %s «Plataforma Stripe».%s', v_code, v_espera));
end $$;
revoke all on function public.conta_cobro_cuenta_stripe_poner(uuid, text) from public, anon;
grant execute on function public.conta_cobro_cuenta_stripe_poner(uuid, text) to authenticated;
comment on function public.conta_cobro_cuenta_stripe_poner(uuid, text) is
  'G05 · nº 60 · Ajustes del cobro: la cuenta puente de Stripe de la empresa (una 572 de las cifras del plan). Si no existe, se crea «Plataforma Stripe» con su registro; con otro nombre o de un banco, para. null la quita.';

-- ── 2 · El botón: apuntar el pago que guarda la incidencia ─────────────────────────
create or replace function public.conta_recibo_apuntar_pendiente(p_diferencia uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_d public.conta_gestoria_diferencia; r jsonb;
begin
  select * into v_d from public.conta_gestoria_diferencia where id = p_diferencia;
  if v_d.id is null or not public.belongs_to_account(v_d.account_id) then raise exception 'Esa incidencia no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_d.account_id) then raise exception 'Solo un administrador o un encargado apunta un pago.' using errcode = '42501'; end if;
  if v_d.tipo <> 'falta_cuenta_stripe' then raise exception 'Esta incidencia no es un pago pendiente de apuntar.' using errcode = '22023'; end if;
  if not v_d.vigente then
    if exists (select 1 from public.conta_recibo_pago_portal where recibo_id = (v_d.datos->>'recibo')::uuid) then
      return jsonb_build_object('apuntado', true, 'ya', true, 'frase', 'Ya estaba apuntado: este pago ya está en la contabilidad.');
    end if;
    raise exception 'Esta incidencia ya no está vigente: mira la de ahora en «Pendiente de revisar».' using errcode = '23514';
  end if;
  -- El mismo pago que guardó el portal, en nombre de quien pulsa (la función comprueba todo otra vez).
  r := public.conta_recibo_pagado_portal((v_d.datos->>'recibo')::uuid, v_d.datos->>'via', (v_d.datos->>'importe')::numeric, v_d.datos->>'referencia');
  if coalesce((r->>'apuntado')::boolean, false) or coalesce((r->>'ya')::boolean, false) then
    return r || jsonb_build_object('apuntado', true);
  end if;
  -- Sigue sin valer: lo dice, con la incidencia de ahora (la de antes la ha cambiado la función).
  return r;
end $$;
revoke all on function public.conta_recibo_apuntar_pendiente(uuid) from public, anon;
grant execute on function public.conta_recibo_apuntar_pendiente(uuid) to authenticated;
comment on function public.conta_recibo_apuntar_pendiente(uuid) is
  'G05 · nº 60 · «Apuntar el pago» de una incidencia falta_cuenta_stripe: el pago con tarjeta que guardó el portal, con conta_recibo_pagado_portal, en nombre de quien pulsa. Si la cuenta de Stripe aún no vale, no se apunta y lo dice.';

-- ── 3 · Lo que enseña la pantalla ───────────────────────────────────────────────────
create or replace function public.conta_cobro_cuenta_stripe_leer(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v_code text; v_no text;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'Esa empresa no está.' using errcode = 'P0002'; end if;
  select nullif(btrim(cuenta_stripe), '') into v_code from public.conta_gestoria_ajustes where company_id = p_company;
  v_no := public._conta_cobro_stripe_no_vale(p_company, v_code);
  return jsonb_build_object(
    'cuenta', v_code,
    'nombre', (select name from public.company_account where company_id = p_company and code = v_code),
    'vale', v_no is null, 'motivo', v_no,
    'pendientes', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'cliente', p.name, 'party_id', d.party_id, 'mes', d.datos->>'mes',
        'importe', (d.datos->>'importe')::numeric, 'referencia', d.datos->>'referencia', 'porque', d.porque, 'desde', d.created_at) order by d.created_at)
      from public.conta_gestoria_diferencia d left join public.party p on p.id = d.party_id
     where d.company_id = p_company and d.tipo = 'falta_cuenta_stripe' and d.vigente), '[]'::jsonb));
end $$;
revoke all on function public.conta_cobro_cuenta_stripe_leer(uuid) from public, anon;
grant execute on function public.conta_cobro_cuenta_stripe_leer(uuid) to authenticated;
comment on function public.conta_cobro_cuenta_stripe_leer(uuid) is
  'G05 · nº 60 · Ajustes del cobro: la cuenta de Stripe puesta, su nombre en el plan, si vale, y los pagos con tarjeta que esperan a apuntarse.';
