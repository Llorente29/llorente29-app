-- supabase/migrations/20261028T0735_s01_enlace_validado.sql
--
-- S01 · PR 3 · Respuesta 7 (Julio, 28/10): EL COBRO POR EL ENLACE NACE VALIDADO,
-- como el de efectivo. Viene con el aviso firmado del banco (Redsys) o de
-- Stripe: es tan seguro como el efectivo. Si el cliente devuelve el pago, se
-- deshace con su propio asiento (journal_entry_anular: el contraasiento,
-- validado, y el cobro sale de la factura), no se borra. La transferencia
-- apuntada a mano no cambia: sigue sin asiento y se casa en Bancos.
--
-- cambia: public.journal_entry_validar · prueba: supabase/staging/sql/20261028_s01_enlace_validado_prueba.sql
-- cambia: public._s01_asiento_cobro · prueba: supabase/staging/sql/20261028_s01_enlace_validado_prueba.sql
--
-- Lo que hace:
--   1. _journal_entry_validar: el cuerpo de journal_entry_validar (las reglas
--      de conta_motivos_para_validar, el número sin huecos y la huella
--      encadenada) SIN la comprobación de quién valida. La usan el servidor (el
--      aviso del banco o de Stripe llega sin usuario) y, en la entrega 5, la
--      pasada de noche. Una sola copia de las reglas: journal_entry_validar
--      (misma firma) comprueba quién valida y llama a esta, como
--      journal_entry_proponer y _journal_entry_proponer (la 0100 del 18/10).
--   2. _s01_asiento_cobro (misma firma): propone el asiento del cobro como
--      antes y lo valida en el acto. Si no se puede validar (un mes cerrado, el
--      IVA del periodo presentado…), el asiento se queda propuesto y el
--      historial de la factura dice por qué (regla 8): no se esconde.
--
-- Medido en producción, solo lectura, el 28/10: 0 enlaces de pago y 0 asientos
-- de cobro por el enlace (customer_payment). No hay nada de antes que validar.
--
-- Las dos funciones de antes se respaldan (_respaldar_funcion) y su vuelta
-- atrás las deja byte a byte: supabase/vuelta-atras/20261028T0735_s01_enlace_validado.down.sql.

select public._respaldar_funcion('public.journal_entry_validar(uuid,text)', '20261028T0735_s01_enlace_validado');
select public._respaldar_funcion('public._s01_asiento_cobro(uuid,text)', '20261028T0735_s01_enlace_validado');

-- ── 1 · Validar sin usuario: el cuerpo, una sola vez ─────────────────────────
create or replace function public._journal_entry_validar(p_entry uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_e public.journal_entry;
  v_numero int; v_seq bigint; v_prev text; v_hash text; v_mal text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if v_e.status not in ('propuesto', 'borrador') then
    raise exception 'El asiento ya está %.', v_e.status using errcode = '23514';
  end if;

  -- Reglas 1, 4 y 5 y el envío por aclarar: el primer motivo, con su texto.
  -- La regla vive en conta_motivos_para_validar (M01, 16/10).
  select m.motivo into v_mal from public.conta_motivos_para_validar(p_entry) m order by m.orden limit 1;
  if v_mal is not null then raise exception '%', v_mal using errcode = '23514'; end if;

  -- Regla 2: número siguiente de su serie en el ejercicio, sin huecos. Huella encadenada.
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || v_e.company_id, 0));
  select coalesce(max(number), 0) + 1 into v_numero from public.journal_entry
   where company_id = v_e.company_id and fiscal_year_id = v_e.fiscal_year_id and series = v_e.series and number is not null;
  select chain_seq, hash into v_seq, v_prev from public.journal_entry
   where company_id = v_e.company_id and chain_seq is not null order by chain_seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;

  update public.journal_entry set number = v_numero, status = 'validado', validated_at = now(), validated_by = auth.uid(),
         validated_by_name = coalesce(p_quien_nombre, public.conta_nombre_actor()), chain_seq = v_seq, prev_hash = v_prev,
         hash = 'pendiente'
   where id = p_entry;
  v_hash := public.journal_huella(v_prev, public.journal_entry_canonico(p_entry));
  -- La huella se escribe en la misma transacción: el disparador deja pasar este
  -- cambio porque el asiento acaba de validarse (journal_entry_inalterable, 0100).
  perform set_config('folvy.journal_huella', p_entry::text, true);
  update public.journal_entry set hash = v_hash where id = p_entry;
  perform set_config('folvy.journal_huella', '', true);
  return jsonb_build_object('id', p_entry, 'serie', v_e.series, 'numero', v_numero, 'huella', v_hash);
end $$;
revoke all on function public._journal_entry_validar(uuid, text) from public, anon, authenticated;
comment on function public._journal_entry_validar(uuid, text) is
  'S01 · PR 3: el cuerpo de journal_entry_validar sin comprobar quién valida (servidor: el aviso del banco, la pasada de noche). Una sola copia de las reglas de validar.';

-- ── 1b · journal_entry_validar (misma firma): comprueba quién y llama al cuerpo ──
create or replace function public.journal_entry_validar(p_entry uuid, p_quien_nombre text default null::text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_e public.journal_entry;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida asientos.' using errcode = '42501';
  end if;
  -- S01 · PR 3: las reglas de validar viven en _journal_entry_validar (una sola copia).
  return public._journal_entry_validar(p_entry, p_quien_nombre);
end $function$;

-- ── 2 · El asiento del cobro por el enlace, validado al nacer ────────────────
create or replace function public._s01_asiento_cobro(p_payment uuid, p_proveedor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p public.customer_invoice_payment; v public.customer_invoice; v_cli text; v_pas text; v_res jsonb; v_entry uuid; v_nombre text; v_concepto text;
        v_sin_validar text;
begin
  select * into p from public.customer_invoice_payment where id = p_payment for update;
  if p.id is null then return jsonb_build_object('asiento', null, 'motivo', 'el cobro no existe'); end if;
  if p.entry_id is not null and exists (select 1 from public.journal_entry where id = p.entry_id and status in ('propuesto', 'borrador', 'validado')) then
    return jsonb_build_object('asiento', p.entry_id, 'motivo', null, 'ya', true);
  end if;
  select * into v from public.customer_invoice where id = p.invoice_id;
  select coalesce(pa.name, v.customer->>'nombre') into v_nombre from public.party pa where pa.id = v.party_id;
  v_nombre := coalesce(v_nombre, v.customer->>'nombre', 'el cliente');
  v_cli := public._pc01e3_cuenta_cliente(p.company_id, v.party_id);
  if v_cli is null then return jsonb_build_object('asiento', null, 'motivo', format('%s no tiene su cuenta de cliente (430)', v_nombre)); end if;
  v_pas := public._s01_cuenta_pasarela(p.company_id, p_proveedor);
  if v_pas is null then return jsonb_build_object('asiento', null, 'motivo', 'la empresa aún no tiene el plan contable activado'); end if;
  v_concepto := format('Cobro %s · %s · %s', case p_proveedor when 'redsys' then 'TPV' else 'Stripe' end, v_nombre, coalesce(v.number_text, 'sin número'));
  v_res := public._journal_entry_proponer(p.company_id,
    jsonb_build_object('fecha', p.paid_on, 'series', (public._bank_ajustes(p.company_id)).treasury_series, 'concepto', v_concepto,
                       'source_type', 'customer_payment', 'source_id', p.id, 'confianza', 'seguro',
                       'porque', format('El cliente pagó %s con %s por el enlace de pago, y %s lo confirmó: ya no debe; queda por abonar en el banco.',
                                        public.conta_euros_exactos(p.amount), case when p.method = 'bizum' then 'Bizum' else 'tarjeta' end,
                                        case p_proveedor when 'redsys' then 'el banco' else 'Stripe' end),
                       'razones', '[]'::jsonb, 'party_id', v.party_id, 'documento', v.number_text),
    jsonb_build_array(
      jsonb_build_object('cuenta', v_pas, 'debe', p.amount, 'haber', 0, 'concepto', v_concepto, 'comun', true),
      jsonb_build_object('cuenta', v_cli, 'debe', 0, 'haber', p.amount, 'tercero_id', v.party_id, 'concepto', v_concepto, 'comun', true)),
    '{}'::jsonb, 'Sumied', null);
  v_entry := (v_res->>'id')::uuid;
  update public.customer_invoice_payment set entry_id = v_entry where id = p.id;
  -- S01 · PR 3 (Julio, 28/10): nace validado, como el cobro en efectivo. Si no se
  -- puede, se queda propuesto y la factura lo dice (regla 8).
  begin
    perform public._journal_entry_validar(v_entry, format('Sumied (cobro confirmado por %s)', case p_proveedor when 'redsys' then 'el banco' else 'Stripe' end));
  exception when others then
    v_sin_validar := sqlerrm;
  end;
  if v_sin_validar is not null then
    perform public._conta_venta_evento(v.id, 'asiento_sin_validar',
      format('El asiento del cobro de %s se queda propuesto, sin validar: %s Valídalo en Contabilidad › Asientos.', public.conta_euros_exactos(p.amount), v_sin_validar),
      jsonb_build_object('asiento', v_entry), 'Sumied');
  end if;
  return jsonb_build_object('asiento', v_entry, 'motivo', null, 'cuenta', v_pas, 'validado', v_sin_validar is null, 'sin_validar', v_sin_validar);
end $$;
revoke all on function public._s01_asiento_cobro(uuid, text) from public, anon, authenticated;
