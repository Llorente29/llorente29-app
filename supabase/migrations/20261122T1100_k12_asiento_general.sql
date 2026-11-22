-- supabase/migrations/20261122T1100_k12_asiento_general.sql
--
-- K12 · El asiento general como ERP10 (maqueta nucleo_19, aprobada el 22/11): lo que su pantalla necesita guardar y no
-- tenía dónde (Julio, 22/11: «sí a la tanda, con las cuatro piezas»). Las cuatro, en dos ficheros: éste solo AÑADE; el
-- justificante (que amplía un CHECK) va en la 1101.
--
--   1. journal_entry.notes: las «Observaciones» del asiento. Fuera de la huella (journal_entry_canonico no cambia): es
--      una nota, no un dato contable. En un asiento validado solo la cambia conta_asiento_modificar.
--   2. conta_user_pref.reparto_documento: el ancho del documento de cada persona, en la base y no en el navegador (la
--      parte del documento, de 0 a 1; 1 es el formulario plegado del todo con «‹»). Vacío, el de siempre.
--   3. conta_asiento_modificado: el respaldo y el historial de cada «cambiar» de un asiento validado (como el
--      conta_recibida_modificada del X26).
--   4. conta_asiento_se_puede_modificar(asiento) y conta_asiento_modificar(asiento, cabecera, líneas, quién): cambiar
--      un asiento MANUAL validado mientras el IVA de su trimestre no esté presentado, con el mismo candado de siempre.
--      Es lo del X26 (conta_recibida_modificar) para el asiento general: el mismo número; los dos candados de
--      «inalterable» quitados solo en esta transacción; la cadena de huellas vuelta a encadenar con la función de
--      siempre y comprobada íntegra al final; y las reglas de validar (conta_motivos_para_validar) sobre el asiento
--      cambiado. Si algo no se cumple, no se hace nada. Solo los asientos de origen manual: los de una factura, del
--      banco o de las ventas se cambian en su ficha. Ni antes ni después lleva IVA ni retención (la pantalla no los
--      escribe: el asiento con IVA es una factura).
--
-- Nada en el camino del pedido. El real lo lanza Julio. Vuelta atrás: quita las funciones, la tabla y las dos columnas
-- si nadie las ha usado.

-- 1 · Observaciones ---------------------------------------------------------------------------------------------------
alter table public.journal_entry add column if not exists notes text;
comment on column public.journal_entry.notes is
  'K12 · Las «Observaciones» del asiento (ERP10). Fuera de la huella. En un asiento validado, solo por conta_asiento_modificar.';

-- 2 · El ancho del documento de cada persona ---------------------------------------------------------------------------
alter table public.conta_user_pref add column if not exists reparto_documento numeric
  constraint conta_user_pref_reparto_documento_check check (reparto_documento is null or (reparto_documento > 0 and reparto_documento <= 1));
comment on column public.conta_user_pref.reparto_documento is
  'K12 · La parte de la pantalla del documento (0–1) que dejó esta persona al mover el separador; 1 = el formulario plegado con «‹». Vacío: el de siempre.';

-- 3 · El historial de cada cambio ---------------------------------------------------------------------------------------
create table if not exists public.conta_asiento_modificado (
  id               uuid primary key default gen_random_uuid(),
  -- Sin claves ajenas a propósito: crearla o quitarla no bloquea accounts ni company (en staging, con la e2e viva, la
  -- prueba en una sola transacción se interbloqueó así: run 45011139706). La lee solo su cuenta (la política de abajo).
  account_id       uuid not null,
  company_id       uuid not null,
  entry_id         uuid not null,
  numero           integer,
  cabecera_antes   jsonb not null,
  cabecera_despues jsonb not null,
  lineas_antes     jsonb not null,
  lineas_despues   jsonb not null,
  cadena_antes     jsonb not null,
  quien            text not null,
  at               timestamptz not null default now()
);
comment on table public.conta_asiento_modificado is
  'K12 · Cada cambio de un asiento manual validado: la cabecera y las líneas antes y después, y la cadena de huellas de antes de cada asiento que se volvió a encadenar (para saber qué era y poder volver).';
create index if not exists idx_conta_asiento_modificado_asiento on public.conta_asiento_modificado (entry_id, at desc);
alter table public.conta_asiento_modificado enable row level security;
drop policy if exists conta_asiento_modificado_leer on public.conta_asiento_modificado;
create policy conta_asiento_modificado_leer on public.conta_asiento_modificado for select to authenticated using (public.belongs_to_account(account_id));
revoke all on table public.conta_asiento_modificado from anon, authenticated;
grant select on table public.conta_asiento_modificado to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'conta_lectura') then
    grant select on table public.conta_asiento_modificado to conta_lectura;
  end if;
end $$;

-- 4a · ¿Se puede cambiar? ---------------------------------------------------------------------------------------------
create or replace function public.conta_asiento_se_puede_modificar(p_entry uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare
  e public.journal_entry; y public.fiscal_year; v_p jsonb; v_no text;
begin
  select * into e from public.journal_entry where id = p_entry;
  if e.id is null or not public.belongs_to_account(e.account_id) then
    return jsonb_build_object('puede', false, 'porque', 'Ese asiento no está.');
  end if;
  if e.status <> 'validado' then
    return jsonb_build_object('puede', false, 'porque', format('El asiento está %s: no se cambia aquí.', e.status));
  end if;
  if e.source_type <> 'manual' then
    return jsonb_build_object('puede', false, 'porque', 'No es un asiento a mano: se cambia en su ficha.');
  end if;
  if not public.current_user_is_admin_or_manager_of(e.account_id) then
    v_no := 'Solo un administrador o un encargado de la cuenta cambia un asiento validado.';
  end if;
  if v_no is null then
    v_p := public.conta_iva_presentado(e.company_id, e.entry_date);
    if v_p is not null then
      v_no := format('El IVA del %s ya está presentado: este asiento no se cambia.',
                     case when v_p->>'periodo' ~ 'T$' then v_p->>'periodo' else 'mes ' || (v_p->>'periodo') end);
    end if;
  end if;
  if v_no is null then
    select * into y from public.fiscal_year where id = e.fiscal_year_id;
    if y.status is distinct from 'open' then v_no := format('El ejercicio %s está cerrado: este asiento no se cambia.', coalesce(y.code, '')); end if;
  end if;
  if v_no is null and public.conta_mes_cerrado(e.company_id, e.entry_date) then
    v_no := format('El mes de %s está cerrado: reábrelo antes de cambiar este asiento.', to_char(e.entry_date, 'MM/YYYY'));
  end if;
  if v_no is null and exists (select 1 from public.external_send x where x.entry_id = e.id and x.status in ('enviado', 'enlazado')) then
    v_no := 'Este asiento ya salió a Diez o a ERP10: se cambia allí, no aquí.';
  end if;
  if v_no is null and exists (select 1 from public.journal_line l where l.entry_id = e.id
                                and (l.tax_rate_id is not null or l.vat_book is not null or l.withholding_rate_id is not null)) then
    v_no := 'Este asiento lleva IVA o retención: se anula y se hace de nuevo.';
  end if;
  if v_no is null and public._conta_cadena_rota(e.company_id) <> 0 then
    v_no := 'La cadena de huellas de la empresa ya estaba rota: no se cambia nada hasta arreglarla.';
  end if;
  return jsonb_build_object('puede', v_no is null, 'porque', v_no, 'numero', e.number, 'serie', e.series, 'asiento', e.id);
end $function$;
comment on function public.conta_asiento_se_puede_modificar(uuid) is
  'K12 · Si un asiento manual validado se puede cambiar y, si no, por qué (no es manual, IVA presentado, ejercicio o mes cerrado, ya en Diez o ERP10, lleva IVA, cadena rota, sin permiso).';
revoke all on function public.conta_asiento_se_puede_modificar(uuid) from public, anon;
grant execute on function public.conta_asiento_se_puede_modificar(uuid) to authenticated, service_role;

-- 4b · Cambiar: la cabecera y las líneas, en el mismo asiento -------------------------------------------------------------
create or replace function public.conta_asiento_modificar(p_entry uuid, p_cabecera jsonb, p_lineas jsonb, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  e public.journal_entry; d public.journal_entry; y public.fiscal_year; v_se jsonb; v_quien text; x jsonb;
  v_cta public.company_account; v_debe numeric; v_haber numeric; v_sd numeric := 0; v_sh numeric := 0; v_pos int := 0;
  v_fecha date; v_concepto text; v_local uuid; v_comun boolean; v_marca uuid; v_canal uuid; v_p jsonb; v_mal text;
  v_antes jsonb; v_despues jsonb; v_cab_antes jsonb; v_cab_despues jsonb; v_cadena jsonb; v_prev text; r record;
  v_canon_antes text; v_canon_despues text; v_nota_antes text; v_reg uuid;
  c_cab constant text[] := array['entry_date', 'concept', 'notes', 'party_id', 'document_ref', 'document_date'];
begin
  select * into e from public.journal_entry where id = p_entry for update;
  v_se := public.conta_asiento_se_puede_modificar(p_entry);
  if not coalesce((v_se->>'puede')::boolean, false) then raise exception '%', v_se->>'porque' using errcode = '23514'; end if;
  v_quien := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || e.company_id, 0));

  -- La cabecera, comprobada antes de tocar nada.
  p_cabecera := coalesce(p_cabecera, '{}');
  v_fecha := coalesce(nullif(p_cabecera->>'fecha', '')::date, e.entry_date);
  v_concepto := coalesce(nullif(btrim(p_cabecera->>'concepto'), ''), case when p_cabecera ? 'concepto' then null else e.concept end);
  if v_concepto is null then raise exception 'El asiento lleva su concepto.' using errcode = '22023'; end if;
  select * into y from public.fiscal_year where id = e.fiscal_year_id;
  if v_fecha not between y.starts_on and y.ends_on then
    raise exception 'El % no es del ejercicio %: el asiento no cambia de ejercicio.', to_char(v_fecha, 'DD/MM/YYYY'), y.code using errcode = '22023';
  end if;
  if v_fecha <> e.entry_date then
    v_p := public.conta_iva_presentado(e.company_id, v_fecha);
    if v_p is not null then raise exception 'El IVA del % ya está presentado: el asiento no va a esa fecha.', v_p->>'periodo' using errcode = '23514'; end if;
    if public.conta_mes_cerrado(e.company_id, v_fecha) then
      raise exception 'El mes de % está cerrado: el asiento no va a esa fecha.', to_char(v_fecha, 'MM/YYYY') using errcode = '23514';
    end if;
  end if;

  -- Las líneas, comprobadas antes de tocar nada: dos o más, cada una a un lado, cuentas de la empresa, y cuadra.
  if jsonb_typeof(coalesce(p_lineas, 'null')) <> 'array' or jsonb_array_length(p_lineas) < 2 then
    raise exception 'Un asiento lleva al menos dos apuntes.' using errcode = '22023';
  end if;
  for x in select * from jsonb_array_elements(p_lineas) loop
    v_pos := v_pos + 1;
    select * into v_cta from public.company_account
     where company_id = e.company_id and account_id = e.account_id and code = btrim(coalesce(x->>'cuenta', ''));
    if v_cta.id is null then raise exception 'Línea %: la cuenta % no está en el plan de la empresa.', v_pos, coalesce(nullif(btrim(x->>'cuenta'), ''), '(vacía)') using errcode = '22023'; end if;
    if v_cta.status = 'cerrada' then raise exception 'Línea %: la % está cerrada.', v_pos, v_cta.code using errcode = '22023'; end if;
    if exists (select 1 from public.company_account h where h.company_id = e.company_id and h.account_id = e.account_id
                 and length(h.code) > length(v_cta.code) and left(h.code, length(v_cta.code)) = v_cta.code) then
      raise exception 'Línea %: la % tiene subcuentas; se apunta en una de ellas.', v_pos, v_cta.code using errcode = '22023';
    end if;
    v_debe := round(coalesce(nullif(x->>'debe', '')::numeric, 0), 2);
    v_haber := round(coalesce(nullif(x->>'haber', '')::numeric, 0), 2);
    if v_debe < 0 or v_haber < 0 or (v_debe = 0) = (v_haber = 0) then
      raise exception 'Línea %: un importe, al debe o al haber.', v_pos using errcode = '22023';
    end if;
    v_sd := v_sd + v_debe; v_sh := v_sh + v_haber;
  end loop;
  if v_sd <> v_sh then raise exception 'No cuadra: debe % y haber %, descuadre %.', v_sd, v_sh, v_sd - v_sh using errcode = '23514'; end if;

  -- Lo de antes: la cabecera, las líneas, la huella y la cadena de este asiento y de todos los de detrás.
  v_cab_antes := jsonb_build_object('fecha', e.entry_date, 'concepto', e.concept, 'notas', e.notes, 'tercero', e.party_id,
                                    'documento', e.document_ref, 'fecha_documento', e.document_date);
  select coalesce(jsonb_agg(to_jsonb(j) order by j.position), '[]') into v_antes from public.journal_line j where j.entry_id = e.id;
  select coalesce(jsonb_agg(jsonb_build_object('entry_id', o.id, 'chain_seq', o.chain_seq, 'prev_hash', o.prev_hash, 'hash', o.hash) order by o.chain_seq), '[]')
    into v_cadena from public.journal_entry o where o.company_id = e.company_id and o.chain_seq >= e.chain_seq;
  v_canon_antes := public.journal_entry_canonico(e.id);
  v_nota_antes := e.notes;

  -- Solo en esta transacción: sin los dos candados de «inalterable» (como el X26 y el «Borrar» del S01q).
  set constraints public.trg_journal_entry_valida_con_pdf immediate;
  alter table public.journal_entry disable trigger trg_journal_entry_inalterable;
  alter table public.journal_line disable trigger trg_journal_line_inalterable;

  update public.journal_entry set
    entry_date = v_fecha, concept = v_concepto,
    notes = case when p_cabecera ? 'notas' then nullif(btrim(p_cabecera->>'notas'), '') else notes end,
    party_id = case when p_cabecera ? 'tercero' then nullif(p_cabecera->>'tercero', '')::uuid else party_id end,
    document_ref = case when p_cabecera ? 'documento' then nullif(btrim(p_cabecera->>'documento'), '') else document_ref end,
    document_date = case when p_cabecera ? 'fecha_documento' then nullif(p_cabecera->>'fecha_documento', '')::date else document_date end,
    updated_at = now()
   where id = e.id;

  delete from public.journal_line where entry_id = e.id;
  v_pos := 0;
  for x in select * from jsonb_array_elements(p_lineas) loop
    v_pos := v_pos + 1;
    select * into v_cta from public.company_account where company_id = e.company_id and account_id = e.account_id and code = btrim(x->>'cuenta');
    v_comun := coalesce(x->>'local', '') = 'comun';
    v_local := case when coalesce(x->>'local', '') ~ '^[0-9a-f-]{36}$' then (x->>'local')::uuid end;
    v_marca := case when coalesce(x->>'marca', '') ~ '^[0-9a-f-]{36}$' then (x->>'marca')::uuid end;
    v_canal := case when coalesce(x->>'plataforma', '') ~ '^[0-9a-f-]{36}$' then (x->>'plataforma')::uuid end;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                     location_id, is_common, brand_id, channel_id)
    values (e.account_id, e.company_id, e.id, v_pos, v_cta.id,
            round(coalesce(nullif(x->>'debe', '')::numeric, 0), 2), round(coalesce(nullif(x->>'haber', '')::numeric, 0), 2),
            nullif(btrim(coalesce(x->>'concepto', '')), ''), v_local, v_comun, v_marca, v_canal);
  end loop;

  -- Las reglas de validar, sobre el asiento cambiado (el local con el eje encendido, la fecha abierta…).
  select m.motivo into v_mal from public.conta_motivos_para_validar(e.id) m order by m.orden limit 1;
  if v_mal is not null then raise exception '%', v_mal using errcode = '23514'; end if;

  select * into d from public.journal_entry where id = e.id;
  v_canon_despues := public.journal_entry_canonico(e.id);
  if v_canon_despues is distinct from v_canon_antes then
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

  select coalesce(jsonb_agg(to_jsonb(j) order by j.position), '[]') into v_despues from public.journal_line j where j.entry_id = e.id;
  v_cab_despues := jsonb_build_object('fecha', d.entry_date, 'concepto', d.concept, 'notas', d.notes, 'tercero', d.party_id,
                                      'documento', d.document_ref, 'fecha_documento', d.document_date);
  if v_canon_despues is not distinct from v_canon_antes and d.notes is not distinct from v_nota_antes
     and (select coalesce(jsonb_agg(jsonb_build_object('c', j->'concept', 'p', j->'channel_id') order by (j->>'position')::int), '[]') from jsonb_array_elements(v_antes) j)
       = (select coalesce(jsonb_agg(jsonb_build_object('c', j->'concept', 'p', j->'channel_id') order by (j->>'position')::int), '[]') from jsonb_array_elements(v_despues) j) then
    -- Nada distinto: se deshace lo escrito (las mismas líneas con otros id) para no dejar historial de un no-cambio.
    raise exception using errcode = 'P0001', message = 'k12:sin-cambios';
  end if;
  if public._conta_cadena_rota(e.company_id) <> 0 then
    raise exception 'No se cambia nada: después de cambiarlo, la cadena de huellas no cuadra.' using errcode = '23514';
  end if;

  insert into public.conta_asiento_modificado (account_id, company_id, entry_id, numero, cabecera_antes, cabecera_despues, lineas_antes, lineas_despues, cadena_antes, quien)
  values (e.account_id, e.company_id, e.id, e.number, v_cab_antes, v_cab_despues, v_antes, v_despues, v_cadena, v_quien) returning id into v_reg;
  return jsonb_build_object('texto', format('Cambiado: el asiento %s sigue siendo el %s, con %s apuntes y %s al debe y al haber.',
                                            e.number, e.number, v_pos, to_char(v_sd, 'FM999G999G990D00')),
                            'numero', e.number, 'serie', e.series, 'apuntes', v_pos, 'registro', v_reg);
exception when sqlstate 'P0001' then
  if sqlerrm = 'k12:sin-cambios' then
    return jsonb_build_object('texto', 'No había nada distinto: el asiento se queda como estaba.', 'numero', e.number, 'serie', e.series, 'apuntes', 0);
  end if;
  raise;
end $function$;
comment on function public.conta_asiento_modificar(uuid, jsonb, jsonb, text) is
  'K12 · Cambiar un asiento manual validado (el asiento general), en el mismo asiento y con el mismo número: cabecera {fecha, concepto, notas, tercero, documento, fecha_documento} y líneas [{cuenta, concepto, debe, haber, local?: uuid | ''comun'', marca?, plataforma?}]. Respaldo, candados quitados solo en la transacción, las reglas de validar, cadena vuelta a encadenar y comprobada.';
revoke all on function public.conta_asiento_modificar(uuid, jsonb, jsonb, text) from public, anon;
grant execute on function public.conta_asiento_modificar(uuid, jsonb, jsonb, text) to authenticated, service_role;
