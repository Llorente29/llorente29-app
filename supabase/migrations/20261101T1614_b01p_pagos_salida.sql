-- supabase/migrations/20261101T1614_b01p_pagos_salida.sql
-- cambia: public.conta_pago_remesa · prueba: supabase/staging/sql/20261101_b01p_pagos_salida_prueba.sql
-- cambia: public.conta_pago_remesa_estado · prueba: supabase/staging/sql/20261101_b01p_pagos_salida_prueba.sql
--
-- B01 Revolut · PR 2b · LA SALIDA AL BANCO, en la base. Lo que usa la función
-- conta-pagar (clave de servicio) para mandar un lote que la 1234 dejó
-- «listo», y lo que apunta cuando el banco contesta. Y «Activar pagos».
--
--   1. conta_pago_remesa.kind admite «banco» (solo amplía el CHECK): un pago
--      mandado por la API del banco es una remesa de PC01 más, con su línea.
--      Así la factura solo queda pagada cuando su cargo se casa en Bancos y
--      tiene asiento (PC01 · E1), como cualquier remesa.
--   2. conta_pago_remesa_estado: una remesa «banco» está «en el banco» desde
--      que se manda, como una «a mano» (antes de esto no había ninguna).
--   3. conta_pago_mandar_empezar: el lote «listo» pasa a «enviando»; cada
--      pago, vuelto a comprobar (la factura sigue por pagar, el IBAN de la
--      ficha es el que se aprobó, la lista no ha cambiado), queda como línea de
--      su remesa «banco». Si el IBAN pidió segunda aprobación, esa aprobación
--      lo confirma: en la línea (quién y cuándo) y en la ficha del proveedor.
--   4. conta_pago_banco_dice: lo que contesta el banco, en el pago y en su
--      línea. Rechazado: la línea queda rechazada y la factura vuelve a tener
--      lo pendiente.
--   5. conta_pago_activar: al volver de Revolut con el permiso de pagar, quien
--      lo activó (un administrador) es la primera persona que puede pagar.
--
-- No está en el camino del pedido. Dueño único: lo escriben funciones conta_*.

-- ── 1 · El tipo «banco» ─────────────────────────────────────────────────────
-- Las tablas que cierra (la remesa y, por la vista, nada más): de entrada y con límite.
set local lock_timeout = '5s';
alter table public.conta_pago_remesa
  drop constraint if exists conta_pago_remesa_kind_check,
  add constraint conta_pago_remesa_kind_check check (kind in ('fichero', 'a_mano', 'banco'));
comment on column public.conta_pago_remesa.kind is
  'PC01 · E2 · fichero: remesa SEPA que se descarga · a_mano: «Ya la he pagado» · banco (B01 Revolut · PR 2b): mandada por la API del banco desde Sumied.';

-- ── 2 · Su estado ──────────────────────────────────────────────────────────
create or replace view public.conta_pago_remesa_estado with (security_invoker = true) as
  with l as (
    select remesa_id,
           count(*) filter (where estado not in ('sacada', 'rechazada')) as vivas,
           count(*) filter (where estado = 'pagada') as pagadas,
           count(*) filter (where estado = 'por_confirmar') as por_confirmar,
           count(*) filter (where estado = 'rechazada') as rechazadas,
           coalesce(sum(amount) filter (where estado not in ('sacada', 'rechazada')), 0)::numeric(14,2) as total,
           coalesce(sum(amount) filter (where estado in ('pendiente', 'por_confirmar')), 0)::numeric(14,2) as por_cargar
      from public.conta_pago_remesa_linea_estado group by remesa_id
  )
  select r.*, coalesce(l.vivas, 0) as vivas, coalesce(l.pagadas, 0) as pagadas, coalesce(l.por_confirmar, 0) as por_confirmar,
         coalesce(l.rechazadas, 0) as rechazadas, coalesce(l.total, 0) as total, coalesce(l.por_cargar, 0) as por_cargar,
         case
           when coalesce(l.vivas, 0) = 0 then 'vacia'
           when l.pagadas = l.vivas then 'pagada'
           -- B01 Revolut · PR 2b: la del banco, como la de a mano, está en el banco desde que se manda.
           when r.kind in ('a_mano', 'banco') or r.file_at is not null then 'en_banco'
           when l.por_confirmar > 0 then 'preparada'
           else 'fichero'
         end as estado
    from public.conta_pago_remesa r
    left join l on l.remesa_id = r.id;
grant select on public.conta_pago_remesa_estado to authenticated;
comment on view public.conta_pago_remesa_estado is 'PC01 · E2 · El estado de cada remesa de pagos, calculado de sus líneas: preparada, fichero, en_banco, pagada o vacia. B01 · 2b: la del banco, en_banco desde que se manda.';

-- ── 3 · Mandar un lote: lo que la función necesita, y todo apuntado ────────
create or replace function public.conta_pago_mandar_empezar(p_lote uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_l public.conta_pago_lote; v_sal record; v_cuenta text; v_r uuid; v_code text; v_s public.conta_pago_salida;
  v_inv public.supplier_invoice; v_sup public.supplier; v_lin uuid; v_pagos jsonb := '[]'::jsonb; v_total numeric := 0; v_n int := 0;
begin
  select * into v_l from public.conta_pago_lote where id = p_lote for update;
  if v_l.id is null then raise exception 'Ese pago no existe.' using errcode = 'P0002'; end if;
  if v_l.estado <> 'listo' then
    raise exception 'Este pago no está listo para mandar (está %).', replace(v_l.estado, '_', ' ') using errcode = '23514';
  end if;
  if public._conta_pago_huella(p_lote) <> v_l.huella then
    raise exception 'La lista de pagos ha cambiado desde que se aprobó: no se manda. Vuelve a aprobarla.' using errcode = '23514';
  end if;
  select * into v_sal from public._conta_pago_salida_de(v_l.company_id, v_l.treasury_account_id);
  if not v_sal.puede then raise exception '%', v_sal.porque using errcode = '23514'; end if;
  select b.external_account_id into v_cuenta from public.bank_aggregator_link b
   where b.treasury_account_id = v_l.treasury_account_id and b.company_id = v_l.company_id and b.provider = v_l.proveedor and b.status = 'activo';
  v_code := public._pc01e2_codigo(v_l.company_id, public.conta_hoy());
  insert into public.conta_pago_remesa (account_id, company_id, code, kind, treasury_account_id, pay_date, created_by, created_by_name)
  values (v_l.account_id, v_l.company_id, v_code, 'banco', v_l.treasury_account_id, public.conta_hoy(), v_l.created_by, v_l.created_by_name)
  returning id into v_r;
  for v_s in select * from public.conta_pago_salida where lote_id = p_lote and estado = 'lista' order by created_at, id for update loop
    select * into v_inv from public.supplier_invoice where id = v_s.invoice_id for update;
    if v_inv.status <> 'aprobada' or v_inv.paid_at is not null then
      raise exception 'La factura % ya no está por pagar: no se manda ningún pago del lote.', coalesce(v_inv.invoice_number, '') using errcode = '23514';
    end if;
    -- Su propio importe ya está descontado de lo pendiente (es un pago vivo): basta con que no quede negativo.
    if public._conta_pago_pendiente(v_inv.id) < -0.005 then
      raise exception 'A la factura % ya no le queda %: se ha pagado por otro lado. No se manda ningún pago del lote.',
        coalesce(v_inv.invoice_number, ''), public.conta_euros_exactos(v_s.amount) using errcode = '23514';
    end if;
    select * into v_sup from public.supplier where id = v_s.supplier_id;
    if public._pc01e2_iban(v_sup.iban) is distinct from v_s.iban then
      raise exception 'El IBAN de % ha cambiado en su ficha desde que se aprobó el pago: no se manda. Vuelve a aprobarlo.', coalesce(v_sup.name, 'su proveedor') using errcode = '23514';
    end if;
    insert into public.conta_pago_remesa_linea (account_id, company_id, remesa_id, invoice_id, supplier_id, amount, iban, iban_check, iban_note,
                                                iban_confirmed_at, iban_confirmed_by, iban_confirmed_by_name)
    values (v_l.account_id, v_l.company_id, v_r, v_s.invoice_id, v_s.supplier_id, v_s.amount, v_s.iban, v_s.iban_check, v_s.iban_nota,
            case when v_s.iban_check <> 'comprobado' then v_l.segunda_at end,
            case when v_s.iban_check <> 'comprobado' then v_l.segunda_por end,
            case when v_s.iban_check <> 'comprobado' then v_l.segunda_por_nombre end)
    returning id into v_lin;
    -- La segunda aprobación de un IBAN nuevo, cambiado o leído de la factura lo confirma también en la ficha.
    if v_s.iban_check <> 'comprobado' then
      if v_l.segunda_at is null then
        raise exception 'El IBAN ···· % pedía segunda aprobación y no la tiene: no se manda.', right(v_s.iban, 4) using errcode = '23514';
      end if;
      update public.supplier set iban_verified_at = now(), iban_unconfirmed_invoice_id = null, updated_at = now()
       where id = v_s.supplier_id and public._pc01e2_iban(iban) = v_s.iban;
      perform public._pc01e2_evento(v_l.account_id, v_r, v_lin, format('IBAN ···· %s de %s confirmado con la segunda aprobación de %s (%s).',
        right(v_s.iban, 4), v_s.beneficiario, coalesce(v_l.segunda_por_nombre, 'una persona'), case v_l.segunda_via when 'llave' then 'su llave' else 'su PIN de pago' end));
    end if;
    update public.conta_pago_salida set remesa_id = v_r, remesa_linea_id = v_lin, estado = 'enviando', estado_at = now() where id = v_s.id;
    v_pagos := v_pagos || jsonb_build_array(jsonb_build_object('salida', v_s.id, 'request_id', v_s.request_id, 'importe', v_s.amount,
      'beneficiario', v_s.beneficiario, 'iban', v_s.iban, 'concepto', v_s.concepto));
    v_total := v_total + v_s.amount; v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Este lote no tiene ningún pago para mandar.' using errcode = '23514'; end if;
  update public.conta_pago_lote set estado = 'enviando' where id = p_lote;
  perform public._pc01e2_evento(v_l.account_id, v_r, null, format('Se manda a %s: %s %s, %s, desde %s (aprobado por %s).',
    v_sal.banco, v_n, case when v_n = 1 then 'pago' else 'pagos' end, public.conta_euros_exactos(v_total),
    (select name from public.treasury_account where id = v_l.treasury_account_id), coalesce(v_l.created_by_name, 'una persona')));
  perform public._conta_pago_evento(v_l.account_id, p_lote, null, 'Sumied', format('Se manda a %s (remesa %s).', v_sal.banco, v_code));
  return jsonb_build_object('lote', p_lote, 'remesa', v_r, 'codigo', v_code, 'proveedor', v_l.proveedor, 'banco', v_sal.banco,
    'company', v_l.company_id, 'cuenta', v_cuenta, 'pagos', v_pagos, 'total', v_total);
end $$;
revoke all on function public.conta_pago_mandar_empezar(uuid) from public, anon, authenticated;
grant execute on function public.conta_pago_mandar_empezar(uuid) to service_role;

-- ── 4 · Lo que dice el banco ───────────────────────────────────────────────
create or replace function public.conta_pago_banco_dice(p_salida uuid, p_estado text, p_banco_id text, p_porque text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s public.conta_pago_salida; v_l public.conta_pago_lote; v_banco text; v_texto text; v_quedan int;
begin
  if p_estado not in ('enviada', 'esperando_banco', 'pagada', 'rechazada', 'devuelta') then
    raise exception 'Estado del banco desconocido: %.', p_estado using errcode = '22023';
  end if;
  select * into v_s from public.conta_pago_salida where id = p_salida for update;
  if v_s.id is null then raise exception 'Ese pago no existe.' using errcode = 'P0002'; end if;
  select * into v_l from public.conta_pago_lote where id = v_s.lote_id for update;
  v_banco := initcap(v_l.proveedor);
  -- Lo que ya acabó no vuelve atrás, salvo una devolución de lo pagado.
  if v_s.estado in ('rechazada', 'devuelta', 'cancelada') or (v_s.estado = 'pagada' and p_estado <> 'devuelta') then
    return jsonb_build_object('estado', v_s.estado, 'sin_cambio', true);
  end if;
  if v_s.estado = p_estado and v_s.banco_id is not distinct from coalesce(p_banco_id, v_s.banco_id) then
    return jsonb_build_object('estado', v_s.estado, 'sin_cambio', true);
  end if;
  update public.conta_pago_salida set estado = p_estado, banco_id = coalesce(nullif(p_banco_id, ''), banco_id),
    estado_porque = case when p_estado in ('rechazada', 'devuelta') then left(coalesce(nullif(trim(p_porque), ''), 'El banco no ha dicho por qué.'), 300) end,
    estado_at = now() where id = p_salida;
  if p_estado = 'rechazada' and v_s.remesa_linea_id is not null then
    update public.conta_pago_remesa_linea set rejected_at = now(), rejected_by_name = v_banco,
      reject_reason = left(coalesce(nullif(trim(p_porque), ''), 'El banco no ha dicho por qué.'), 300)
     where id = v_s.remesa_linea_id and rejected_at is null;
  end if;
  v_texto := case p_estado
    when 'enviada' then format('%s lo ha recibido.', v_banco)
    when 'esperando_banco' then format('%s lo está procesando (o espera la aprobación en %s).', v_banco, v_banco)
    when 'pagada' then format('%s lo ha confirmado: pagado.', v_banco)
    when 'rechazada' then format('%s no ha hecho el pago: %s La factura sigue por pagar.', v_banco, coalesce(nullif(trim(p_porque), ''), 'no ha dicho por qué.'))
    else format('%s ha devuelto el pago: %s', v_banco, coalesce(nullif(trim(p_porque), ''), 'no ha dicho por qué.')) end;
  perform public._conta_pago_evento(v_s.account_id, v_s.lote_id, p_salida, v_banco, v_texto);
  if v_s.remesa_id is not null then perform public._pc01e2_evento(v_s.account_id, v_s.remesa_id, v_s.remesa_linea_id, v_texto); end if;
  select count(*) into v_quedan from public.conta_pago_salida where lote_id = v_s.lote_id and estado = 'enviando';
  if v_quedan = 0 and v_l.estado = 'enviando' then update public.conta_pago_lote set estado = 'enviado' where id = v_s.lote_id; end if;
  return jsonb_build_object('estado', p_estado, 'frase', v_texto);
end $$;
revoke all on function public.conta_pago_banco_dice(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.conta_pago_banco_dice(uuid, text, text, text) to service_role;

-- Los pagos que esperan respuesta del banco (para la lectura de cada hora y el aviso).
create or replace function public.conta_pago_por_saber(p_company uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('salida', s.id, 'request_id', s.request_id, 'banco_id', s.banco_id, 'estado', s.estado) order by s.created_at), '[]'::jsonb)
    from public.conta_pago_salida s
   where s.company_id = p_company and s.estado in ('enviando', 'enviada', 'esperando_banco')
$$;
revoke all on function public.conta_pago_por_saber(uuid) from public, anon, authenticated;
grant execute on function public.conta_pago_por_saber(uuid) to service_role;

-- ── 5 · «Activar pagos» ────────────────────────────────────────────────────
-- Al volver de Revolut con PAY: quien lo activó, si es administrador de la
-- cuenta, es la primera persona que puede pagar (si no lo era ya).
create or replace function public.conta_pago_activar(p_company uuid, p_user uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_acc uuid; v_n int; v_nombre text := public._conta_pago_nombre(p_user);
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.user_profiles where user_id = p_user and account_id = v_acc and role = 'admin' and active) then
    raise exception 'Solo un administrador activa los pagos.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('conta_pago_permiso:' || p_company::text, 0));
  if not public._conta_pago_puede(p_company, p_user) then
    insert into public.conta_pago_permiso (account_id, company_id, user_id, user_name, granted_by, granted_by_name)
    values (v_acc, p_company, p_user, v_nombre, p_user, v_nombre || ' (al activar los pagos)');
  end if;
  select count(*) into v_n from public._conta_pago_pagadores(p_company);
  return jsonb_build_object('n', v_n, 'personas', (select coalesce(jsonb_agg(nombre), '[]'::jsonb) from public._conta_pago_pagadores(p_company)));
end $$;
revoke all on function public.conta_pago_activar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.conta_pago_activar(uuid, uuid) to service_role;
