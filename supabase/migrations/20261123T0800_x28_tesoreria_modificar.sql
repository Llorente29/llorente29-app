-- supabase/migrations/20261123T0800_x28_tesoreria_modificar.sql
--
-- X28 · Tesorería como ERP10: «cambiar» un movimiento del banco ya contabilizado CONSERVA SU NÚMERO DE ASIENTO, como el
-- X26 con las recibidas (respuesta X28 · 1, decisión 2: la pieza 9 del concepto ERP10, todo se edita mientras el IVA de
-- su trimestre no esté presentado). «Deshacer» sigue existiendo para quitar, no para cambiar.
--
-- Solo AÑADE (nada de lo que existe cambia):
--   1. conta_tesoreria_modificada: el respaldo y el historial de cada cambio (quién, cuándo, el asiento y sus líneas
--      antes y después, y la cadena de huellas de antes de cada asiento que se volvió a encadenar).
--   2. conta_tesoreria_se_puede_modificar(asiento): si se puede y, si no, por qué, con su frase. Solo un asiento de
--      tesorería (el de un movimiento del banco o uno escrito a mano en el banco), validado, con el IVA de su trimestre
--      sin presentar, su ejercicio y su mes abiertos, sin haber salido a Diez ni a ERP10, la cadena íntegra y quien lo
--      pide administrador o encargado de la cuenta.
--   3. conta_tesoreria_modificar(asiento, cambios, quién): la subcuenta de la contrapartida (si es una sola línea y el
--      movimiento no paga ni cobra un documento: una factura, una liquidación de plataforma o un traspaso), el
--      concepto y la analítica (local, marca y plataforma; marca y plataforma, solo en una empresa de hostelería).
--      EL MISMO ASIENTO: el mismo número, la misma fecha y los mismos importes. Como el X26: respaldo, los dos
--      candados de «inalterable» quitados solo en esta transacción, la cadena de huellas vuelta a encadenar desde
--      este asiento con la función de siempre y comprobada íntegra al final (si no, no se hace nada).
--   4. conta_tesoreria_a_mano: «⊕ otro movimiento», el «a mano» de siempre (conta_banco_a_mano, E05: validado al
--      momento en la serie 3) con el local, la marca y la plataforma de la línea de edición. Es nueva para no cambiar
--      la firma de conta_banco_a_mano (regla 2), que sigue igual y la siguen leyendo las emitidas.
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita las tres funciones y la tabla.

-- 1 · El respaldo y el historial ----------------------------------------------------------------------------------
create table if not exists public.conta_tesoreria_modificada (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  entry_id         uuid not null,
  movement_id      uuid,
  numero           integer,
  asiento_antes    jsonb not null,
  lineas_antes     jsonb not null,
  lineas_despues   jsonb not null,
  cadena_antes     jsonb not null,
  cambios          jsonb not null,
  quien            text not null,
  at               timestamptz not null default now()
);
comment on table public.conta_tesoreria_modificada is
  'X28 · Cada cambio de un movimiento de tesorería ya contabilizado: el asiento y sus líneas antes y después, y la cadena de huellas de antes de cada asiento que se volvió a encadenar (para saber qué era y poder volver).';
create index if not exists idx_conta_tesoreria_modificada_asiento on public.conta_tesoreria_modificada (entry_id, at desc);
alter table public.conta_tesoreria_modificada enable row level security;
drop policy if exists conta_tesoreria_modificada_leer on public.conta_tesoreria_modificada;
create policy conta_tesoreria_modificada_leer on public.conta_tesoreria_modificada for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.conta_tesoreria_modificada from anon, authenticated;
grant select on table public.conta_tesoreria_modificada to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_tesoreria_modificada to conta_lectura;
  end if;
end $$;

-- 2 · ¿Se puede cambiar? --------------------------------------------------------------------------------------------
create or replace function public.conta_tesoreria_se_puede_modificar(p_asiento uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  e public.journal_entry; y public.fiscal_year; v_p jsonb; v_lock public.fiscal_period_lock; v_no text; v_mov uuid;
  v_paga text; v_lineas int;
begin
  select * into e from public.journal_entry where id = p_asiento;
  if e.id is null or not public.belongs_to_account(e.account_id) then
    return jsonb_build_object('puede', false, 'porque', 'Ese asiento no está.');
  end if;
  if e.source_type not in ('bank', 'manual') then
    return jsonb_build_object('puede', false, 'porque', 'Ese asiento no es de tesorería: se cambia en su sitio.');
  end if;
  if e.status <> 'validado' then
    return jsonb_build_object('puede', false, 'porque', 'No está contabilizado: no hay nada que modificar.');
  end if;
  select m.movement_id into v_mov from public.bank_match m where m.journal_entry_id = e.id and m.status = 'vivo' and m.kind <> 'traspaso' limit 1;
  if not public.current_user_is_admin_or_manager_of(e.account_id) then
    v_no := 'Solo un administrador o un encargado de la cuenta modifica un movimiento contabilizado.';
  end if;
  if v_no is null then
    v_p := public.conta_iva_presentado(e.company_id, e.entry_date);
    if v_p is not null then
      v_no := format('El IVA del %s ya está presentado: este movimiento no se puede modificar.',
                     case when v_p->>'periodo' ~ 'T$' then v_p->>'periodo' else 'mes ' || (v_p->>'periodo') end);
    end if;
  end if;
  if v_no is null then
    select * into y from public.fiscal_year where id = e.fiscal_year_id;
    if y.status is distinct from 'open' then v_no := format('El ejercicio %s está cerrado: este movimiento no se puede modificar.', coalesce(y.code, '')); end if;
  end if;
  if v_no is null then
    select * into v_lock from public.fiscal_period_lock
     where company_id = e.company_id and month = date_trunc('month', e.entry_date)::date and reopened_at is null limit 1;
    if v_lock.id is not null then
      v_no := format('El mes de %s está cerrado: reábrelo antes de modificar este movimiento.', to_char(e.entry_date, 'MM/YYYY'));
    end if;
  end if;
  if v_no is null and (exists (select 1 from public.external_send x where x.entry_id = e.id and x.status in ('enviado', 'enlazado'))
                       or exists (select 1 from public.conta_erp10_salida_partida p where p.entry_id = e.id)
                       or exists (select 1 from public.conta_erp10_envio x where x.entry_id = e.id)) then
    v_no := 'Su asiento ya salió a Diez o a ERP10: se modifica allí, no aquí.';
  end if;
  if v_no is null and public._conta_cadena_rota(e.company_id) <> 0 then
    v_no := 'La cadena de huellas de la empresa ya estaba rota: no se modifica nada hasta arreglarla.';
  end if;
  -- Qué se puede cambiar: la subcuenta, solo si la contrapartida es una línea y no paga ni cobra un documento.
  select count(*) into v_lineas from public.journal_line where entry_id = e.id;
  select case when i.supplier_invoice_id is not null then 'una factura recibida'
              when i.customer_invoice_id is not null then 'una factura emitida'
              when i.channel_settlement_id is not null then 'una liquidación de plataforma' end
    into v_paga
    from public.bank_match m join public.bank_match_item i on i.match_id = m.id
   where m.journal_entry_id = e.id and m.status = 'vivo'
     and (i.supplier_invoice_id is not null or i.customer_invoice_id is not null or i.channel_settlement_id is not null)
   limit 1;
  if v_paga is null and exists (select 1 from public.bank_match m where m.journal_entry_id = e.id and m.status = 'vivo' and m.kind = 'traspaso') then
    v_paga := 'un traspaso';
  end if;
  return jsonb_build_object('puede', v_no is null, 'porque', v_no, 'numero', e.number, 'serie', e.series, 'asiento', e.id, 'movimiento', v_mov,
                            'subcuenta', v_no is null and v_paga is null and v_lineas = 2,
                            'subcuenta_porque', case when v_paga is not null then format('Paga o cobra %s: su subcuenta es la de ese documento.', v_paga)
                                                     when v_lineas <> 2 then 'Tiene más de una contrapartida: su subcuenta se cambia en el diario.' end);
end $function$;
comment on function public.conta_tesoreria_se_puede_modificar(uuid) is
  'X28 · Si un asiento de tesorería contabilizado se puede modificar y, si no, por qué (IVA presentado, ejercicio o mes cerrado, ya en Diez o ERP10, cadena rota, sin permiso). Dice también si se puede cambiar su subcuenta.';
revoke all on function public.conta_tesoreria_se_puede_modificar(uuid) from public, anon;
grant execute on function public.conta_tesoreria_se_puede_modificar(uuid) to authenticated, service_role;

-- 3 · Modificar: la subcuenta, el concepto y la analítica, en el mismo asiento ----------------------------------------
create or replace function public.conta_tesoreria_modificar(p_asiento uuid, p_cambios jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  e public.journal_entry; v_se jsonb; v_quien text; l public.journal_line; v_cta public.company_account; v_banco public.journal_line;
  v_concepto text; v_local uuid; v_comun boolean; v_marca uuid; v_canal uuid; v_sector text; v_textos text[] := '{}';
  v_antes jsonb; v_entrada jsonb; v_despues jsonb; v_cadena jsonb; v_prev text; r record; v_n int := 0; v_otra text;
begin
  select * into e from public.journal_entry where id = p_asiento for update;
  v_se := public.conta_tesoreria_se_puede_modificar(p_asiento);
  if not coalesce((v_se->>'puede')::boolean, false) then raise exception '%', v_se->>'porque' using errcode = '23514'; end if;
  if jsonb_typeof(coalesce(p_cambios, 'null')) <> 'object' or p_cambios = '{}'::jsonb then
    raise exception 'No hay nada que cambiar.' using errcode = '22023';
  end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || e.company_id, 0));
  -- La línea del banco es la primera (así la escriben el casado y el «a mano»); la contrapartida, las demás.
  select * into v_banco from public.journal_line where entry_id = e.id and position = 1;

  -- Lo que cambia, comprobado antes de tocar nada.
  if p_cambios ? 'cuenta' then
    select * into l from public.journal_line where entry_id = e.id and position <> 1 order by position limit 1;
    select code into v_otra from public.company_account where id = l.company_account_id;
    if v_otra is distinct from btrim(coalesce(p_cambios->>'cuenta', '')) then
      if not coalesce((v_se->>'subcuenta')::boolean, false) then raise exception '%', v_se->>'subcuenta_porque' using errcode = '23514'; end if;
      select * into v_cta from public.company_account
       where company_id = e.company_id and account_id = e.account_id and code = btrim(coalesce(p_cambios->>'cuenta', ''));
      if v_cta.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', coalesce(nullif(btrim(p_cambios->>'cuenta'), ''), '(vacía)') using errcode = '22023'; end if;
      if v_cta.id = v_banco.company_account_id then raise exception 'La cuenta no puede ser la del propio banco (%).', v_cta.code using errcode = '22023'; end if;
      if v_cta.status is distinct from 'activa' then raise exception 'La % está oculta o cerrada: no se le puede apuntar nada.', v_cta.code using errcode = '22023'; end if;
    end if;
  end if;
  if p_cambios ? 'local' then
    v_comun := coalesce(p_cambios->>'local', '') in ('', 'comun');
    v_local := case when coalesce(p_cambios->>'local', '') ~ '^[0-9a-f-]{36}$' then (p_cambios->>'local')::uuid end;
    if v_local is not null and not exists (select 1 from public.locations x where x.id = v_local and x.account_id = e.account_id) then
      raise exception 'Ese local no es de la cuenta.' using errcode = '22023';
    end if;
  end if;
  if nullif(p_cambios->>'marca', '') is not null or nullif(p_cambios->>'plataforma', '') is not null then
    select sector into v_sector from public.company where id = e.company_id;
    if v_sector is distinct from 'hosteleria' then
      raise exception 'La marca y la plataforma son de una empresa de hostelería: esta no lo es.' using errcode = '22023';
    end if;
  end if;
  if p_cambios ? 'marca' then
    v_marca := nullif(p_cambios->>'marca', '')::uuid;
    if v_marca is not null and not exists (select 1 from public.brand b where b.id = v_marca and b.account_id = e.account_id) then
      raise exception 'Esa marca no es de la cuenta.' using errcode = '22023';
    end if;
  end if;
  if p_cambios ? 'plataforma' then
    v_canal := nullif(p_cambios->>'plataforma', '')::uuid;
    if v_canal is not null and not exists (select 1 from public.sales_channel c where c.id = v_canal and c.account_id = e.account_id) then
      raise exception 'Esa plataforma no es de la cuenta.' using errcode = '22023';
    end if;
  end if;
  v_concepto := nullif(btrim(p_cambios->>'concepto'), '');

  -- El respaldo: el asiento, sus líneas y la cadena de este y de todos los de detrás (los que se vuelven a encadenar).
  select coalesce(jsonb_agg(jsonb_build_object('entry_id', o.id, 'chain_seq', o.chain_seq, 'prev_hash', o.prev_hash, 'hash', o.hash) order by o.chain_seq), '[]')
    into v_cadena from public.journal_entry o where o.company_id = e.company_id and o.chain_seq >= e.chain_seq;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.position), '[]') into v_antes from public.journal_line j where j.entry_id = e.id;
  v_entrada := to_jsonb(e);

  -- Solo en esta transacción: sin los dos candados de «inalterable» (como el X26 y el S01q).
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
  alter table public.journal_line disable trigger trg_journal_line_inalterable;

  if v_cta.id is not null then
    update public.journal_line set company_account_id = v_cta.id where id = l.id;
    v_textos := array_append(v_textos, format('%s → %s', v_otra, v_cta.code)); v_n := v_n + 1;
  end if;
  if v_concepto is not null and v_concepto is distinct from e.concept then
    update public.journal_entry set concept = v_concepto where id = e.id;
    update public.journal_line set concept = v_concepto where entry_id = e.id;
    v_textos := array_append(v_textos, 'el concepto'); v_n := v_n + 1;
  end if;
  if p_cambios ? 'local' and exists (select 1 from public.journal_line j where j.entry_id = e.id
                                       and (j.location_id is distinct from v_local or j.is_common is distinct from v_comun)) then
    update public.journal_line set location_id = v_local, is_common = v_comun where entry_id = e.id;
    v_textos := array_append(v_textos, 'el local'); v_n := v_n + 1;
  end if;
  if p_cambios ? 'marca' and exists (select 1 from public.journal_line j where j.entry_id = e.id and j.brand_id is distinct from v_marca) then
    update public.journal_line set brand_id = v_marca where entry_id = e.id;
    v_textos := array_append(v_textos, 'la marca'); v_n := v_n + 1;
  end if;
  if p_cambios ? 'plataforma' and exists (select 1 from public.journal_line j where j.entry_id = e.id and j.channel_id is distinct from v_canal) then
    update public.journal_line set channel_id = v_canal where entry_id = e.id;
    v_textos := array_append(v_textos, 'la plataforma'); v_n := v_n + 1;
  end if;

  if v_n > 0 then
    -- La cadena: desde este asiento, cada huella con la función de siempre (los eslabones y su orden no cambian).
    select hash into v_prev from public.journal_entry where company_id = e.company_id and chain_seq is not null and chain_seq < e.chain_seq order by chain_seq desc limit 1;
    for r in select o.id from public.journal_entry o where o.company_id = e.company_id and o.chain_seq >= e.chain_seq order by o.chain_seq loop
      update public.journal_entry set prev_hash = v_prev where id = r.id;
      update public.journal_entry set hash = public.journal_huella(v_prev, public.journal_entry_canonico(r.id)) where id = r.id returning hash into v_prev;
    end loop;
  end if;

  alter table public.journal_line enable trigger trg_journal_line_inalterable;
  alter table public.journal_entry enable trigger trg_journal_entry_inalterable;
  set constraints public.trg_journal_entry_valida_con_pdf deferred;

  if v_n = 0 then
    return jsonb_build_object('texto', format('No había nada distinto: el asiento %s se queda como estaba.', e.number), 'numero', e.number, 'cambiadas', 0);
  end if;
  if public._conta_cadena_rota(e.company_id) <> 0 then
    raise exception 'No se modifica nada: después de cambiarlo, la cadena de huellas no cuadra.' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(to_jsonb(j) order by j.position), '[]') into v_despues from public.journal_line j where j.entry_id = e.id;
  insert into public.conta_tesoreria_modificada (account_id, company_id, entry_id, movement_id, numero, asiento_antes, lineas_antes, lineas_despues,
                                                 cadena_antes, cambios, quien)
  values (e.account_id, e.company_id, e.id, nullif(v_se->>'movimiento', '')::uuid, e.number, v_entrada, v_antes, v_despues, v_cadena, p_cambios, v_quien);
  return jsonb_build_object('texto', format('Modificado: el asiento %s sigue siendo el %s, con %s. La misma fecha y los mismos importes.',
                                            e.number, e.number, array_to_string(v_textos, ', ')),
                            'numero', e.number, 'cambiadas', v_n);
end $function$;
comment on function public.conta_tesoreria_modificar(uuid, jsonb, text) is
  'X28 · Modificar un asiento de tesorería contabilizado: la subcuenta de la contrapartida, el concepto y la analítica (local, marca, plataforma), en el mismo asiento (mismo número, fecha e importes). Respaldo, candados quitados solo en la transacción, cadena vuelta a encadenar y comprobada. p_cambios: {cuenta?, concepto?, local?: uuid | ''comun'', marca?: uuid | '''', plataforma?: uuid | ''''}.';
revoke all on function public.conta_tesoreria_modificar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_tesoreria_modificar(uuid, jsonb, text) to authenticated, service_role;

-- 4 · ⊕ otro movimiento: el «a mano» de siempre, con local, marca y plataforma ------------------------------------------
create or replace function public.conta_tesoreria_a_mano(p_banco uuid, p_fecha date, p_cuenta text, p_concepto text, p_importe numeric,
                                             p_quien_nombre text default null, p_local uuid default null, p_marca uuid default null,
                                             p_plataforma uuid default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  t public.treasury_account; v_572 text; v_nombre572 text; v_cta public.company_account; v_imp numeric := round(coalesce(p_importe, 0), 2);
  v_concepto text := nullif(btrim(p_concepto), ''); v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_res jsonb; v_entry uuid; v_val jsonb; v_lineas jsonb; v_ana jsonb;
begin
  select * into t from public.treasury_account where id = p_banco;
  if t.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(t.account_id)) then
    raise exception 'Ese banco no es de tu cuenta.' using errcode = '42501';
  end if;
  -- La 572 del banco (regla 9: de su empresa y su cuenta).
  select a.code, a.name into v_572, v_nombre572
    from public.company_account_link l join public.company_account a on a.id = l.company_account_id and a.company_id = t.company_id
   where l.account_id = t.account_id and l.company_id = t.company_id and l.entity = 'bank_account' and l.entity_id = t.id::text and l.role = 'principal'
   limit 1;
  if v_572 is null then raise exception 'Este banco no tiene su cuenta (572) en el plan: dásela en Cuentas y extractos.' using errcode = '22023'; end if;
  if p_fecha is null then raise exception 'Pon la fecha.' using errcode = '22023'; end if;
  if v_imp = 0 then raise exception 'Pon el ingreso o el pago.' using errcode = '22023'; end if;
  select * into v_cta from public.company_account a
   where a.company_id = t.company_id and a.account_id = t.account_id and a.code = btrim(coalesce(p_cuenta, ''));
  if v_cta.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', coalesce(nullif(btrim(p_cuenta), ''), '(vacía)') using errcode = '22023'; end if;
  if v_cta.code = v_572 then raise exception 'La cuenta no puede ser la del propio banco (%).', v_572 using errcode = '22023'; end if;
  -- X28 · la analítica de la línea de edición: el local (de la cuenta); marca y plataforma, solo en hostelería.
  if p_local is not null and not exists (select 1 from public.locations x where x.id = p_local and x.account_id = t.account_id) then
    raise exception 'Ese local no es de la cuenta.' using errcode = '22023';
  end if;
  if p_marca is not null or p_plataforma is not null then
    if (select c.sector from public.company c where c.id = t.company_id) is distinct from 'hosteleria' then
      raise exception 'La marca y la plataforma son de una empresa de hostelería: esta no lo es.' using errcode = '22023';
    end if;
    if p_marca is not null and not exists (select 1 from public.brand b where b.id = p_marca and b.account_id = t.account_id) then
      raise exception 'Esa marca no es de la cuenta.' using errcode = '22023';
    end if;
    if p_plataforma is not null and not exists (select 1 from public.sales_channel c where c.id = p_plataforma and c.account_id = t.account_id) then
      raise exception 'Esa plataforma no es de la cuenta.' using errcode = '22023';
    end if;
  end if;
  v_ana := jsonb_strip_nulls(jsonb_build_object('comun', p_local is null, 'local_id', p_local, 'marca_id', p_marca, 'canal_id', p_plataforma));
  v_concepto := coalesce(v_concepto, v_cta.name);
  -- Ingreso: el banco al debe; pago: al haber. La otra cuenta, al revés.
  v_lineas := jsonb_build_array(
    jsonb_build_object('cuenta', v_572, 'debe', case when v_imp > 0 then v_imp else 0 end, 'haber', case when v_imp > 0 then 0 else -v_imp end,
                       'concepto', v_concepto) || v_ana,
    jsonb_build_object('cuenta', v_cta.code, 'debe', case when v_imp > 0 then 0 else -v_imp end, 'haber', case when v_imp > 0 then v_imp else 0 end,
                       'concepto', v_concepto) || v_ana);
  v_res := public._journal_entry_proponer(t.company_id,
    jsonb_build_object('series', 3, 'fecha', p_fecha, 'concepto', v_concepto, 'source_type', 'manual', 'source_id', null,
                       'confianza', 'seguro', 'porque', format('Escrito a mano en Bancos (%s): no venía en el extracto.', coalesce(t.short_name, t.name)),
                       'razones', jsonb_build_array(jsonb_build_object('decision', 'Escrito a mano', 'porque', 'no venía en el extracto'))),
    v_lineas, null, v_quien, null);
  v_entry := nullif(v_res->>'id', '')::uuid;
  if v_entry is null then raise exception 'No ha salido su asiento (%).', v_res using errcode = 'P0001'; end if;
  -- Validado al momento, como en ERP10: con las reglas de siempre. Si no se puede, no queda nada.
  v_val := public._journal_entry_validar(v_entry, v_quien);
  return jsonb_build_object('asiento_id', v_entry, 'numero', v_val->>'numero', 'serie', v_val->>'serie',
    'texto', format('Apuntado y validado: asiento %s, %s de %s en %s (%s). Cuando llegue en el extracto, se enlaza con él: no se duplica.',
                    v_val->>'numero', case when v_imp > 0 then 'ingreso' else 'pago' end,
                    public.conta_euros_exactos(abs(v_imp)), v_cta.code, v_concepto));
end $function$;
comment on function public.conta_tesoreria_a_mano(uuid, date, text, text, numeric, text, uuid, uuid, uuid) is
  'X28 · ⊕ otro movimiento en Tesorería: como conta_banco_a_mano (E05, validado al momento en la serie 3), con su local, su marca y su plataforma (marca y plataforma, solo en hostelería); sin ellos, común, como el de siempre.';
revoke all on function public.conta_tesoreria_a_mano(uuid, date, text, text, numeric, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.conta_tesoreria_a_mano(uuid, date, text, text, numeric, text, uuid, uuid, uuid) to authenticated, service_role;
