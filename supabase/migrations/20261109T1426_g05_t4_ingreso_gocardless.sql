-- supabase/migrations/20261109T1426_g05_t4_ingreso_gocardless.sql
--
-- G05 · Tarea 4 · EL INGRESO DE GOCARDLESS EN EL BANCO (Julio, nº 43).
-- GoCardless junta los cobros de un día en un pago a la cuenta de la empresa
-- (un «payout»): cada cobro trae links.payout y el payout trae su día de
-- llegada (arrival_date) y su importe neto (lo cobrado menos su comisión).
-- SOLO AÑADE:
--   1. conta_gc_cobro.payout_gc_id: el payout de cada cobro (lo guarda la lectura).
--   2. conta_gc_payout: los payouts leídos (llegada, neto, comisión, referencia)
--      y, cuando Bancos lo casa, su casado (bank_match).
--   3. conta_abonos_gocardless_pendientes(empresa): los payouts que esperan su
--      movimiento en el banco, para el motor de Bancos (lib/conciliacion.ts).
--   4. conta_abono_gocardless_casar(movimiento, payout, …): el asiento del
--      ingreso, el banco (su 572) contra la cuenta puente de GoCardless
--      (57200002) por el neto, y lo casa con bank_casar. Como el de Stripe
--      (conta_abono_pasarela_casar): deshacer el casado en Bancos lo quita. La
--      comisión NO va aquí: llega en la factura mensual de GoCardless (1006).
--      Cada recibo de ese payout apunta en su historial que ha llegado.
-- Nada en el camino del pedido. Vuelta atrás:
-- supabase/vuelta-atras/20261109T1426_g05_t4_ingreso_gocardless.down.sql

alter table public.conta_gc_cobro add column if not exists payout_gc_id text;
comment on column public.conta_gc_cobro.payout_gc_id is 'G05 · El pago de GoCardless al banco que lleva este cobro (links.payout).';

create table if not exists public.conta_gc_payout (
  company_id   uuid not null references public.company(id) on delete cascade,
  gc_id        text not null,
  account_id   uuid not null references public.accounts(id) on delete cascade,
  estado       text,
  llegada      date,
  importe      numeric(14,2),
  comision     numeric(14,2),
  moneda       text,
  referencia   text,
  match_id     uuid references public.bank_match(id) on delete set null,
  leido_at     timestamptz not null default now(),
  primary key (company_id, gc_id)
);
comment on table public.conta_gc_payout is
  'G05 · Los pagos de GoCardless a la cuenta de la empresa (payouts), como se leyeron: día de llegada, neto, comisión y referencia; y su casado en Bancos.';
alter table public.conta_gc_payout enable row level security;
drop policy if exists conta_gc_payout_leer on public.conta_gc_payout;
create policy conta_gc_payout_leer on public.conta_gc_payout for select using (public.belongs_to_account(account_id));
grant select on public.conta_gc_payout to authenticated;

/** Los payouts pagados que esperan su movimiento en el banco (para el motor de Bancos). */
create or replace function public.conta_abonos_gocardless_pendientes(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then raise exception 'La empresa no existe.' using errcode = 'P0002'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.gc_id, 'llegada', p.llegada, 'neto', p.importe, 'comision', p.comision, 'referencia', p.referencia,
      'cuenta', public._conta_cobro_ajustes(p_company)->>'cuenta_plataforma',
      'cobros', (select count(*) from public.conta_gc_cobro c where c.company_id = p.company_id and c.payout_gc_id = p.gc_id)) order by p.llegada, p.gc_id)
    from public.conta_gc_payout p
   where p.company_id = p_company and p.estado = 'paid' and p.moneda = 'EUR' and p.importe > 0 and p.llegada is not null
     and not exists (select 1 from public.bank_match b where b.id = p.match_id and b.status = 'vivo')), '[]'::jsonb);
end $$;
revoke all on function public.conta_abonos_gocardless_pendientes(uuid) from public, anon;
grant execute on function public.conta_abonos_gocardless_pendientes(uuid) to authenticated;

/** Casar el ingreso de GoCardless en el banco con su payout: 572 del banco / cuenta puente, por el neto. */
create or replace function public.conta_abono_gocardless_casar(p_movement uuid, p_payout text, p_confianza text, p_porque text, p_por text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_m public.bank_movement; v_t public.treasury_account; v_p public.conta_gc_payout; v_aj public.bank_settings; v_572 text; v_puente text;
  v_lineas jsonb; v_res jsonb; v_entry uuid; v_match uuid; v_concepto text; v_quien text; v_r record; v_n int := 0;
begin
  select * into v_m from public.bank_movement where id = p_movement for update;
  if v_m.id is null then raise exception 'Ese movimiento no existe.' using errcode = 'P0002'; end if;
  perform public._pc01e3_empresa(v_m.company_id);
  if p_por not in ('folvy', 'persona') then raise exception 'Quién casa: folvy o persona.' using errcode = '23514'; end if;
  if v_m.amount <= 0 then raise exception 'El pago de GoCardless entra en el banco, y este movimiento sale.' using errcode = '23514'; end if;
  select * into v_p from public.conta_gc_payout where company_id = v_m.company_id and gc_id = p_payout for update;
  if v_p.gc_id is null then raise exception 'Ese pago de GoCardless no es de esta empresa.' using errcode = 'P0002'; end if;
  if exists (select 1 from public.bank_match b where b.id = v_p.match_id and b.status = 'vivo') then
    raise exception 'Ese pago de GoCardless ya está casado con otro movimiento.' using errcode = '23505';
  end if;
  if round(v_p.importe, 2) <> round(v_m.amount, 2) then
    raise exception 'GoCardless pagó % y este movimiento es de %: no es este.', public.conta_euros_exactos(v_p.importe), public.conta_euros_exactos(v_m.amount) using errcode = '23514';
  end if;
  select * into v_t from public.treasury_account where id = v_m.treasury_account_id;
  v_572 := public._bank_cuenta_572(v_t.id);
  if v_572 is null then raise exception 'La cuenta «%» no tiene su cuenta contable (572): dila en Cuentas y extractos.', v_t.name using errcode = '23514'; end if;
  v_puente := public._conta_cobro_ajustes(v_m.company_id)->>'cuenta_plataforma';
  perform public._conta_cobro_cuenta(v_m.company_id, v_puente, 'Plataforma GoCardless', public.conta_nombre_actor());
  select count(*) into v_n from public.conta_gc_cobro where company_id = v_m.company_id and payout_gc_id = p_payout;
  v_concepto := format('Ingreso de GoCardless del %s · %s %s', to_char(coalesce(v_p.llegada, v_m.op_date), 'DD/MM'), v_n, case when v_n = 1 then 'cobro' else 'cobros' end);
  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta', v_572, 'debe', v_m.amount, 'haber', 0, 'concepto', v_concepto, 'local_id', v_t.location_id, 'comun', v_t.location_id is null),
    jsonb_build_object('cuenta', v_puente, 'debe', 0, 'haber', v_m.amount, 'concepto', v_concepto, 'local_id', v_t.location_id, 'comun', v_t.location_id is null));
  v_aj := public._bank_ajustes(v_m.company_id);
  v_quien := case when p_por = 'folvy' then 'Folvy' else public.conta_nombre_actor() end;
  v_res := public._journal_entry_proponer(v_m.company_id,
    jsonb_build_object('fecha', v_m.op_date, 'series', v_aj.treasury_series, 'concepto', v_concepto, 'source_type', 'bank', 'source_id', v_m.id,
                       'confianza', p_confianza, 'porque', p_porque, 'razones', '[]'::jsonb, 'party_id', null, 'documento', coalesce(v_p.referencia, v_m.document_no, v_m.reference_1)),
    v_lineas, '{}'::jsonb, v_quien, auth.uid());
  if coalesce((v_res->>'descartada')::boolean, false) then raise exception 'Ese movimiento tenía la propuesta descartada.' using errcode = '23514'; end if;
  v_entry := (v_res->>'id')::uuid;
  perform public.bank_casar(p_movement, jsonb_build_object('tipo', 'asiento', 'entry_id', v_entry, 'concepto', v_concepto), p_confianza, p_porque, '[]'::jsonb, p_por, null);
  select id into v_match from public.bank_match where movement_id = p_movement and status = 'vivo';
  -- El asiento lo ha creado este casado: deshacerlo en Bancos lo quita (bank_deshacer).
  update public.bank_match set entry_created = not coalesce((v_res->>'existente')::boolean, false) where id = v_match;
  update public.conta_gc_payout set match_id = v_match where company_id = v_m.company_id and gc_id = p_payout;
  for v_r in select r.id from public.conta_recibo r join public.conta_gc_cobro c on c.company_id = r.company_id and c.gc_id = r.gc_cobro_id
              where r.company_id = v_m.company_id and c.payout_gc_id = p_payout loop
    perform public._conta_cobro_evento(v_r.id, 'ingreso', format('Ha llegado al banco el %s, con los demás cobros del día (%s).', to_char(v_m.op_date, 'DD/MM/YYYY'),
      public.conta_euros_exactos(v_m.amount)), jsonb_build_object('payout', p_payout, 'casado', v_match, 'asiento', v_entry), v_quien);
  end loop;
  return jsonb_build_object('casado', v_match, 'asiento', v_entry, 'cobros', v_n,
    'frase', format('Casado el ingreso de GoCardless del %s: %s de %s %s. Asiento: %s al banco contra la %s.', to_char(coalesce(v_p.llegada, v_m.op_date), 'DD/MM'),
      public.conta_euros_exactos(v_m.amount), v_n, case when v_n = 1 then 'cobro' else 'cobros' end, public.conta_euros_exactos(v_m.amount), v_puente));
end $$;
revoke all on function public.conta_abono_gocardless_casar(uuid, text, text, text, text) from public, anon;
grant execute on function public.conta_abono_gocardless_casar(uuid, text, text, text, text) to authenticated;
comment on function public.conta_abono_gocardless_casar(uuid, text, text, text, text) is
  'G05 · Casa el ingreso de GoCardless en el banco con su payout: la 572 del banco contra la cuenta puente (57200002) por el neto. La comisión llega en la factura mensual de GoCardless. Deshacer el casado lo quita.';
