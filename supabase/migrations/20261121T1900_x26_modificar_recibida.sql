-- supabase/migrations/20261121T1900_x26_modificar_recibida.sql
--
-- X26 · «Modificar» una factura recibida ya contabilizada, como en ERP10 (Julio, 21/11: validó una factura en la
-- 62800000 «Suministros» y quería la 62800001 «Electricidad»; una recibida validada no se podía cambiar desde ningún
-- sitio). Sus reglas: los errores se corrigen, no se tapan con contraasientos (02/11); el IVA presentado no se toca
-- nunca (27/10). Este paso (decidido el 21/11): las CUENTAS de sus líneas de gasto (y su local). El importe y el IVA,
-- en el X26b.
--
-- Solo AÑADE (nada de lo que existe cambia):
--   1. conta_recibida_modificada: el respaldo y el historial de cada modificación (quién, cuándo, cada línea antes y
--      después, y la cadena de huellas de antes de cada asiento que se volvió a encadenar).
--   2. conta_recibida_se_puede_modificar(factura): si se puede y, si no, por qué, con su frase. Solo si: está
--      contabilizada (su asiento validado), el IVA de su trimestre no está presentado, su ejercicio y su mes están
--      abiertos, no ha salido a Diez ni a ERP10, la cadena de huellas está íntegra y quien lo pide puede validar.
--   3. conta_recibida_modificar(factura, líneas, quién): cada línea de gasto del asiento (por su posición), a su
--      cuenta nueva y su local. EL MISMO ASIENTO: el mismo número, la misma fecha, los mismos importes y el mismo
--      IVA (el libro de IVA no se toca: solo cambia la cuenta de gasto). Como el «Borrar» del S01q
--      (_conta_asientos_borrar): respaldo, los dos candados de «inalterable» quitados solo en esta transacción, la
--      cadena de huellas vuelta a encadenar desde este asiento con la función de siempre, y comprobada íntegra al
--      final (si no, no se hace nada). El reparto guardado de la factura (supplier_invoice_expense) se pone igual, y
--      queda en su historial (supplier_invoice_change y document_activity).
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita las dos funciones y la tabla.

create table if not exists public.conta_recibida_modificada (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references public.accounts(id) on delete cascade,
  company_id       uuid not null references public.company(id) on delete cascade,
  invoice_id       uuid not null references public.supplier_invoice(id) on delete cascade,
  entry_id         uuid not null,
  numero           integer,
  lineas_antes     jsonb not null,
  lineas_despues   jsonb not null,
  cadena_antes     jsonb not null,
  quien            text not null,
  at               timestamptz not null default now()
);
comment on table public.conta_recibida_modificada is
  'X26 · Cada «Modificar» de una recibida contabilizada: las líneas del asiento antes y después, y la cadena de huellas de antes de cada asiento que se volvió a encadenar (para saber qué era y poder volver).';
create index if not exists idx_conta_recibida_modificada_factura on public.conta_recibida_modificada (invoice_id, at desc);
alter table public.conta_recibida_modificada enable row level security;
drop policy if exists conta_recibida_modificada_leer on public.conta_recibida_modificada;
create policy conta_recibida_modificada_leer on public.conta_recibida_modificada for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.conta_recibida_modificada from anon, authenticated;
grant select on table public.conta_recibida_modificada to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_recibida_modificada to conta_lectura;
  end if;
end $$;

-- 2 · ¿Se puede modificar? ------------------------------------------------------------------------------------------
create or replace function public.conta_recibida_se_puede_modificar(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  v public.supplier_invoice; e public.journal_entry; y public.fiscal_year; v_p jsonb; v_lock public.fiscal_period_lock;
  v_no text;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or not public.belongs_to_account(v.account_id) then
    return jsonb_build_object('puede', false, 'porque', 'Esa factura no está.');
  end if;
  select * into e from public.journal_entry where id = v.journal_entry_id;
  if e.id is null or e.status <> 'validado' then
    return jsonb_build_object('puede', false, 'porque', 'No está contabilizada: se cambia en la ficha, sin «Modificar».');
  end if;
  if not public.current_user_is_admin_or_manager_of(v.account_id) then
    v_no := 'Solo un administrador o un encargado de la cuenta modifica una factura contabilizada.';
  end if;
  if v_no is null then
    v_p := public.conta_iva_presentado(e.company_id, e.entry_date);
    if v_p is not null then
      v_no := format('El IVA del %s ya está presentado: esta factura no se puede modificar.',
                     case when v_p->>'periodo' ~ 'T$' then v_p->>'periodo' else 'mes ' || (v_p->>'periodo') end);
    end if;
  end if;
  if v_no is null then
    select * into y from public.fiscal_year where id = e.fiscal_year_id;
    if y.status is distinct from 'open' then v_no := format('El ejercicio %s está cerrado: esta factura no se puede modificar.', coalesce(y.code, '')); end if;
  end if;
  if v_no is null then
    select * into v_lock from public.fiscal_period_lock
     where company_id = e.company_id and month = date_trunc('month', e.entry_date)::date and reopened_at is null limit 1;
    if v_lock.id is not null then
      v_no := format('El mes de %s está cerrado: reábrelo antes de modificar esta factura.', to_char(e.entry_date, 'MM/YYYY'));
    end if;
  end if;
  -- Solo si ya está allí (enviado o enlazado): un envío pendiente o rechazado aún no ha salido.
  if v_no is null and exists (select 1 from public.external_send x where x.entry_id = e.id and x.status in ('enviado', 'enlazado')) then
    v_no := 'Su asiento ya salió a Diez o a ERP10: se modifica allí, no aquí.';
  end if;
  if v_no is null and public._conta_cadena_rota(e.company_id) <> 0 then
    v_no := 'La cadena de huellas de la empresa ya estaba rota: no se modifica nada hasta arreglarla.';
  end if;
  return jsonb_build_object('puede', v_no is null, 'porque', v_no, 'numero', e.number, 'serie', e.series, 'asiento', e.id);
end $function$;
comment on function public.conta_recibida_se_puede_modificar(uuid) is
  'X26 · Si una recibida contabilizada se puede «Modificar» y, si no, por qué (IVA presentado, ejercicio o mes cerrado, ya en Diez o ERP10, cadena rota, sin permiso).';
revoke all on function public.conta_recibida_se_puede_modificar(uuid) from public, anon;
grant execute on function public.conta_recibida_se_puede_modificar(uuid) to authenticated, service_role;

-- 3 · Modificar: las cuentas (y el local) de sus líneas de gasto, en el mismo asiento ----------------------------------
create or replace function public.conta_recibida_modificar(p_invoice uuid, p_lineas jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v public.supplier_invoice; e public.journal_entry; v_se jsonb; v_quien text; x jsonb; l public.journal_line;
  v_cta public.company_account; v_antes_code text; v_local uuid; v_comun boolean; v_n int := 0;
  v_antes jsonb := '[]'; v_despues jsonb := '[]'; v_cadena jsonb := '[]'; v_prev text; r record; v_textos text[] := '{}';
  v_reg uuid;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  v_se := public.conta_recibida_se_puede_modificar(p_invoice);
  if not coalesce((v_se->>'puede')::boolean, false) then raise exception '%', v_se->>'porque' using errcode = '23514'; end if;
  if jsonb_typeof(coalesce(p_lineas, 'null')) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'No hay nada que cambiar.' using errcode = '22023';
  end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  select * into e from public.journal_entry where id = v.journal_entry_id for update;
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || e.company_id, 0));

  -- Lo que cambia, comprobado antes de tocar nada: cada línea, de gasto; cada cuenta, una subcuenta de la empresa.
  for x in select * from jsonb_array_elements(p_lineas) loop
    select * into l from public.journal_line where entry_id = e.id and position = (x->>'posicion')::int;
    if l.id is null then raise exception 'El asiento %/% no tiene la línea %.', e.series, e.number, x->>'posicion' using errcode = '22023'; end if;
    select code into v_antes_code from public.company_account where id = l.company_account_id;
    if v_antes_code ~ '^(40|41|472|477|4751)' then
      raise exception 'La línea % es la del proveedor o la del IVA (%): aquí solo se cambian las de gasto.', l.position, v_antes_code using errcode = '22023';
    end if;
    select * into v_cta from public.company_account
     where company_id = e.company_id and account_id = e.account_id and code = btrim(coalesce(x->>'cuenta', ''));
    if v_cta.id is null then raise exception 'La cuenta % no está en el plan de la empresa.', coalesce(nullif(btrim(x->>'cuenta'), ''), '(vacía)') using errcode = '22023'; end if;
    if v_cta.code ~ '^(40|41|472|477|4751)' then
      raise exception 'La % es de proveedor o de IVA: no es una cuenta de gasto.', v_cta.code using errcode = '22023';
    end if;
    if v_cta.status is distinct from 'activa' then raise exception 'La % está oculta o cerrada: no se le puede apuntar nada.', v_cta.code using errcode = '22023'; end if;
  end loop;

  -- La cadena de antes de este asiento y de todos los de detrás (los que se vuelven a encadenar).
  select coalesce(jsonb_agg(jsonb_build_object('entry_id', o.id, 'chain_seq', o.chain_seq, 'prev_hash', o.prev_hash, 'hash', o.hash) order by o.chain_seq), '[]')
    into v_cadena from public.journal_entry o where o.company_id = e.company_id and o.chain_seq >= e.chain_seq;
  select coalesce(jsonb_agg(to_jsonb(j) order by j.position), '[]') into v_antes from public.journal_line j where j.entry_id = e.id;

  -- Solo en esta transacción: sin los dos candados de «inalterable» (como _conta_asientos_borrar, S01q).
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
  alter table public.journal_line disable trigger trg_journal_line_inalterable;

  for x in select * from jsonb_array_elements(p_lineas) loop
    select * into l from public.journal_line where entry_id = e.id and position = (x->>'posicion')::int;
    select code into v_antes_code from public.company_account where id = l.company_account_id;
    select * into v_cta from public.company_account where company_id = e.company_id and account_id = e.account_id and code = btrim(x->>'cuenta');
    v_comun := coalesce(x->>'local', '') = 'comun';
    v_local := case when coalesce(x->>'local', '') ~ '^[0-9a-f-]{36}$' then (x->>'local')::uuid end;
    if not (x ? 'local') then v_comun := l.is_common; v_local := l.location_id; end if;
    if v_cta.id = l.company_account_id and v_local is not distinct from l.location_id and v_comun is not distinct from l.is_common then continue; end if;
    update public.journal_line set company_account_id = v_cta.id, location_id = v_local, is_common = v_comun where id = l.id;
    -- El reparto guardado de la factura, igual (la línea de gasto con esa cuenta y ese importe).
    update public.supplier_invoice_expense s set account_code = v_cta.code, location_id = v_local, is_common = v_comun
     where s.id = (select s2.id from public.supplier_invoice_expense s2 where s2.supplier_invoice_id = v.id and s2.account_code = v_antes_code
                     and s2.amount = round(l.debit - l.credit, 2) order by s2.position limit 1);
    v_textos := array_append(v_textos, case when v_antes_code = v_cta.code then format('la línea %s, de local', l.position)
                                            else format('%s → %s', v_antes_code, v_cta.code) end);
    v_n := v_n + 1;
  end loop;

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
    return jsonb_build_object('texto', 'No había nada distinto: el asiento se queda como estaba.', 'numero', e.number, 'cambiadas', 0);
  end if;
  if public._conta_cadena_rota(e.company_id) <> 0 then
    raise exception 'No se modifica nada: después de cambiarlo, la cadena de huellas no cuadra.' using errcode = '23514';
  end if;

  select coalesce(jsonb_agg(to_jsonb(j) order by j.position), '[]') into v_despues from public.journal_line j where j.entry_id = e.id;
  insert into public.conta_recibida_modificada (account_id, company_id, invoice_id, entry_id, numero, lineas_antes, lineas_despues, cadena_antes, quien)
  values (v.account_id, v.company_id, v.id, e.id, e.number, v_antes, v_despues, v_cadena, v_quien) returning id into v_reg;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  -- En el historial de la factura, como un «guardar» que dice qué fue («modificada», con el asiento y lo que cambió).
  values (v.account_id, v.id, v_quien, 'guardar', jsonb_build_object('modificada', true, 'asiento', e.number, 'cambios', to_jsonb(v_textos), 'registro', v_reg));
  insert into public.document_activity (account_id, company_id, inbox_id, supplier_invoice_id, journal_entry_id, actor, actor_name, action, text)
  values (v.account_id, v.company_id, v.inbox_id, v.id, e.id, 'persona', v_quien, 'corregida',
          format('%s ha modificado el asiento %s (contabilizado): %s. El mismo número, los mismos importes y el mismo IVA.',
                 v_quien, e.number, array_to_string(v_textos, ', ')));
  return jsonb_build_object('texto', format('Modificado: el asiento %s sigue siendo el %s, con %s. Los mismos importes y el mismo IVA.',
                                            e.number, e.number, array_to_string(v_textos, ', ')),
                            'numero', e.number, 'cambiadas', v_n);
end $function$;
comment on function public.conta_recibida_modificar(uuid, jsonb, text) is
  'X26 · «Modificar» una recibida contabilizada: las cuentas (y el local) de sus líneas de gasto, en el mismo asiento (mismo número, fecha, importes e IVA). Respaldo, candados quitados solo en la transacción, cadena vuelta a encadenar y comprobada. p_lineas: [{posicion, cuenta, local?: uuid | ''comun'' | null}].';
revoke all on function public.conta_recibida_modificar(uuid, jsonb, text) from public, anon;
grant execute on function public.conta_recibida_modificar(uuid, jsonb, text) to authenticated, service_role;
