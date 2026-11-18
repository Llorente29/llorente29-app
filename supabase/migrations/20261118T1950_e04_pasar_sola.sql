-- supabase/migrations/20261118T1950_e04_pasar_sola.sql
--
-- E04 · La factura de otra sociedad del grupo se pasa sola (respuesta E03 · 1,
-- 18/11). 1 de 3: lo que SOLO AÑADE (va de verdad a staging desde la rama, W05,
-- para que su e2e lo use). El disparador que la pasa al leerla y «Pasarla» del
-- E03 sobre lo común van en la 1951; las que hoy esperan la pregunta se pasan en
-- la 1952 (con «autorizo»).
--
--   1. _conta_recibida_trabas(factura): lo que ya se hizo con ella en su sociedad
--      y no se mueve solo (pagos, banco, impuesto, liquidación, recepción), o null.
--   2. _conta_recibida_mover(factura, sociedad, quien, sola, porque): lo de
--      «Pasarla» del E03 (la factura, su llegada, su actividad y su apunte de
--      «apunta sola»; sin asiento), apuntado en supplier_invoice_change con
--      «sola» y «porque». Interna: quien la llama mira la cuenta.
--   3. _conta_pasar_sola(factura): si va a nombre de OTRA sociedad de la misma
--      cuenta (_conta_de_quien, caso otra_sociedad), sin asiento validado, sin
--      respuesta de una persona y sin trabas, la pasa; si no, nada (se queda la
--      pregunta del E03). Por qué: «va a nombre de <sociedad> (<NIF>)».
--   4. conta_recibida_devolver(factura, quien): «Deshacer»: la devuelve a la
--      sociedad de la que vino y apunta «Es de esta sociedad» (no se mueve más).
--   5. conta_pasada_sola(factura): la línea verde de la ficha (de dónde vino y por qué).
--   6. conta_pasadas_solas(sociedad, desde): cuántas ha pasado sola a esta sociedad, y cuáles (Inicio).
-- Se puede pasar dos veces (create or replace).
-- sin hueco: al aplicarse no retira nada. Mover quita, al llamarlo, el asiento PROPUESTO
--   (o borrador) de esa factura, como «Pasarla» del E03: se vuelve a proponer en su sociedad.
-- Vuelta atrás: supabase/vuelta-atras/20261118T1950_e04_pasar_sola.down.sql

-- 1 · Lo que no se mueve solo --------------------------------------------------------------------
create or replace function public._conta_recibida_trabas(p_invoice uuid)
returns text language sql stable security definer set search_path = public as $function$
  select string_agg(x, ', ') from (
    select 'pagos' x where exists (select 1 from public.supplier_invoice_payment p where p.invoice_id = p_invoice)
                          or exists (select 1 from public.conta_pago_salida p where p.invoice_id = p_invoice)
                          or exists (select 1 from public.conta_pago_remesa_linea p where p.invoice_id = p_invoice)
    union all select 'una casación con el banco' where exists (select 1 from public.bank_match_item b where b.supplier_invoice_id = p_invoice)
    union all select 'un impuesto presentado' where exists (select 1 from public.tax_return_line t where t.supplier_invoice_id = p_invoice)
    union all select 'una liquidación' where exists (select 1 from public.licensed_settlement l where l.received_invoice_id = p_invoice)
                                          or exists (select 1 from public.channel_settlement_invoice l where l.supplier_invoice_id = p_invoice)
    union all select 'su recepción' where exists (select 1 from public.goods_receipt_path g where g.supplier_invoice_id = p_invoice)
  ) t
$function$;
comment on function public._conta_recibida_trabas(uuid) is 'E04: lo que ya se hizo con una recibida en su sociedad y no se mueve solo (pagos, banco, impuesto, liquidación, recepción), o null. Interna, solo lee.';
revoke all on function public._conta_recibida_trabas(uuid) from public, anon, authenticated;
grant execute on function public._conta_recibida_trabas(uuid) to service_role;

-- 2 · Mover: lo de «Pasarla», hecho por una persona o por Sumied ------------------------------------
create or replace function public._conta_recibida_mover(p_invoice uuid, p_company uuid, p_quien text, p_sola boolean default false, p_porque text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v public.supplier_invoice; d public.company; c public.company; v_traba text; v_quitados int := 0; v_llegadas int := 0;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null then raise exception 'Esa factura no está.' using errcode = 'P0002'; end if;
  -- Regla 9: la sociedad de destino, de LA MISMA cuenta.
  select * into d from public.company where id = p_company and account_id = v.account_id;
  if d.id is null then raise exception 'Esa sociedad no es de tu cuenta.' using errcode = '42501'; end if;
  if d.id = v.company_id then raise exception 'Ya está en %.', d.legal_name using errcode = '22023'; end if;
  select * into c from public.company where id = v.company_id;
  if v.status in ('anulada', 'descartada') then raise exception 'Está %: no se pasa.', v.status using errcode = '22023'; end if;
  if exists (select 1 from public.journal_entry e where e.account_id = v.account_id and e.source_type = 'supplier_invoice'
               and e.source_id = v.id and e.status = 'validado') then
    raise exception 'Tiene su asiento validado: anula el asiento antes de pasarla a %', d.legal_name || case when right(d.legal_name, 1) = '.' then '' else '.' end using errcode = '22023';
  end if;
  -- Lo que ya se hizo con ella en esta sociedad no se mueve solo: se deshace antes.
  v_traba := public._conta_recibida_trabas(v.id);
  if v_traba is not null then
    raise exception 'Ya tiene %: deshazlo antes de pasarla a %', v_traba, d.legal_name || case when right(d.legal_name, 1) = '.' then '' else '.' end using errcode = '22023';
  end if;
  delete from public.journal_entry e
   where e.account_id = v.account_id and e.source_type = 'supplier_invoice' and e.source_id = v.id and e.status in ('propuesto', 'borrador');
  get diagnostics v_quitados = row_count;
  update public.supplier_invoice
     set company_id = d.id,
         -- Su local, si es también de la otra sociedad; si no, sin local.
         location_id = case when exists (select 1 from public.location_company lc where lc.location_id = v.location_id and lc.company_id = d.id) then v.location_id end,
         vat_non_deductible = case when vat_non_deductible_reason = 'no_a_nombre' then false else vat_non_deductible end,
         vat_non_deductible_reason = case when vat_non_deductible_reason = 'no_a_nombre' then null else vat_non_deductible_reason end,
         recipient_answer = null, recipient_answered_at = null, recipient_answered_by_name = null,
         journal_entry_id = case when journal_entry_id is not null and not exists (select 1 from public.journal_entry e where e.id = v.journal_entry_id) then null else journal_entry_id end,
         updated_at = now()
   where id = v.id;
  update public.document_inbox set company_id = d.id, updated_at = now() where supplier_invoice_id = v.id and account_id = v.account_id;
  get diagnostics v_llegadas = row_count;
  update public.document_activity set company_id = d.id where supplier_invoice_id = v.id and account_id = v.account_id;
  update public.supplier_invoice_auto set company_id = d.id where invoice_id = v.id and account_id = v.account_id;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v.account_id, v.id, coalesce(nullif(btrim(p_quien), ''), 'una persona'), 'guardar', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('campo', 'sociedad',
          'antes', jsonb_build_object('id', c.id, 'nombre', c.legal_name), 'ahora', jsonb_build_object('id', d.id, 'nombre', d.legal_name),
          'sola', case when p_sola then true end, 'porque', p_porque))));
  return jsonb_build_object('sociedad_id', d.id, 'sociedad', d.legal_name, 'desde_id', c.id, 'desde', c.legal_name,
    'llegadas', v_llegadas, 'asiento_quitado', v_quitados > 0, 'sola', p_sola,
    'texto', format('Pasada a %s, con su PDF. Ya no está en esta lista.', d.legal_name));
end $function$;
comment on function public._conta_recibida_mover(uuid, uuid, text, boolean, text) is 'E04: pasa una recibida (con su llegada, su actividad y su apunte de «apunta sola») a otra sociedad de la misma cuenta, sin asiento; lo apunta en supplier_invoice_change, con «sola» si fue Sumied. Interna: quien la llama mira la cuenta.';
revoke all on function public._conta_recibida_mover(uuid, uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public._conta_recibida_mover(uuid, uuid, text, boolean, text) to service_role;

-- 3 · Pasarla sola ---------------------------------------------------------------------------------------
create or replace function public._conta_pasar_sola(p_invoice uuid)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare v public.supplier_invoice; q jsonb; o public.company;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or v.recipient_answer is not null then return null; end if;
  q := public._conta_de_quien(p_invoice);
  -- Solo la otra sociedad de la misma cuenta, y solo si la pregunta sigue en pie: sin asiento validado y sin respuesta.
  if coalesce(q->>'caso', '') <> 'otra_sociedad' or not coalesce((q->>'pregunta')::boolean, false) then return null; end if;
  -- Con lo que ya se hizo en su sociedad (un pago, el banco…), no se mueve: se queda la pregunta.
  if public._conta_recibida_trabas(p_invoice) is not null then return null; end if;
  select * into o from public.company where id = (q->>'sociedad_id')::uuid and account_id = v.account_id;
  if o.id is null then return null; end if;
  return public._conta_recibida_mover(p_invoice, o.id, 'Sumied', true,
    format('va a nombre de %s (%s)', o.legal_name, coalesce(nullif(btrim(o.tax_id), ''), q->>'nif')));
end $function$;
comment on function public._conta_pasar_sola(uuid) is 'E04: si una recibida va a nombre de otra sociedad de la misma cuenta, sin asiento validado, sin respuesta de una persona y sin trabas, la pasa a ella (lo apunta como Sumied, «sola»); si no, nada.';
revoke all on function public._conta_pasar_sola(uuid) from public, anon, authenticated;
grant execute on function public._conta_pasar_sola(uuid) to service_role;

-- 4 · «Deshacer» ------------------------------------------------------------------------------------------
create or replace function public.conta_recibida_devolver(p_invoice uuid, p_quien_nombre text default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $function$
declare
  v public.supplier_invoice; x jsonb; r jsonb; v_quien text := coalesce(nullif(btrim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v.account_id)) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  -- El último cambio de sociedad: tiene que ser el de Sumied, y la factura seguir donde la dejó.
  select c into x from public.supplier_invoice_change h cross join lateral jsonb_array_elements(h.cambios) c
   where h.supplier_invoice_id = v.id and h.account_id = v.account_id and c->>'campo' = 'sociedad'
   order by h.at desc limit 1;
  if x is null or not coalesce((x->>'sola')::boolean, false) or (x->'ahora'->>'id')::uuid is distinct from v.company_id then
    raise exception 'Esta factura no la pasé yo sola aquí: si no es de esta sociedad, pásala desde su ficha.' using errcode = '22023';
  end if;
  r := public._conta_recibida_mover(v.id, (x->'antes'->>'id')::uuid, v_quien, false, 'deshacer lo que hizo Sumied');
  -- Y no se vuelve a mover sola: es de esta sociedad, lo ha dicho una persona.
  update public.supplier_invoice set recipient_answer = 'es_de_esta', recipient_answered_at = now(), recipient_answered_by_name = v_quien
   where id = v.id;
  return jsonb_build_object('sociedad_id', r->>'sociedad_id', 'sociedad', r->>'sociedad',
    -- Sin doble punto cuando el nombre ya acaba en punto («…, S.L.»).
    'texto', format('Devuelta a %s%s Ya no se moverá sola.', r->>'sociedad', case when right(r->>'sociedad', 1) = '.' then '' else '.' end));
end $function$;
comment on function public.conta_recibida_devolver(uuid, text) is 'E04: «Deshacer»: devuelve una recibida que Sumied pasó sola a la sociedad de la que vino, con su llegada, y apunta «Es de esta sociedad» para que no se mueva más.';
revoke all on function public.conta_recibida_devolver(uuid, text) from public, anon;
grant execute on function public.conta_recibida_devolver(uuid, text) to authenticated, service_role;

-- 5 · La línea verde de la ficha ---------------------------------------------------------------------------
create or replace function public.conta_pasada_sola(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v public.supplier_invoice; x jsonb; v_at timestamptz; d public.company;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v.account_id)) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  select c, h.at into x, v_at from public.supplier_invoice_change h cross join lateral jsonb_array_elements(h.cambios) c
   where h.supplier_invoice_id = v.id and h.account_id = v.account_id and c->>'campo' = 'sociedad'
   order by h.at desc limit 1;
  if x is null or not coalesce((x->>'sola')::boolean, false) or (x->'ahora'->>'id')::uuid is distinct from v.company_id then return null; end if;
  select * into d from public.company where id = v.company_id;
  return jsonb_build_object('desde_id', x->'antes'->>'id', 'desde', x->'antes'->>'nombre', 'cuando', v_at,
    'a_nombre', d.legal_name, 'nif', d.tax_id,
    'texto', format('Pasada sola desde %s: va a nombre de %s', x->'antes'->>'nombre', d.legal_name)
             || case when nullif(btrim(d.tax_id), '') is not null then format(' (%s).', d.tax_id) else '.' end);
end $function$;
comment on function public.conta_pasada_sola(uuid) is 'E04: si Sumied pasó sola esta recibida a su sociedad (y sigue ahí), de dónde vino y por qué, para la línea verde de su ficha; si no, null. Solo lee.';
revoke all on function public.conta_pasada_sola(uuid) from public, anon;
grant execute on function public.conta_pasada_sola(uuid) to authenticated, service_role;

-- 6 · Las que ha pasado sola a una sociedad (Inicio) --------------------------------------------------------
create or replace function public.conta_pasadas_solas(p_company uuid, p_desde timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $function$
declare v_acc uuid; v_ids uuid[];
begin
  select account_id into v_acc from public.company where id = p_company;
  if v_acc is null or not (coalesce(auth.role(), '') = 'service_role' or public.belongs_to_account(v_acc)) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  -- Las que están hoy en esta sociedad y cuyo último cambio de sociedad, desde esa hora, lo hizo Sumied solo.
  select coalesce(array_agg(u.id order by u.at desc), '{}') into v_ids from (
    select distinct on (si.id) si.id, h.at, c as x
      from public.supplier_invoice si
      join public.supplier_invoice_change h on h.supplier_invoice_id = si.id and h.account_id = v_acc
      cross join lateral jsonb_array_elements(h.cambios) c
     where si.account_id = v_acc and si.company_id = p_company and c->>'campo' = 'sociedad'
     order by si.id, h.at desc) u
   where coalesce((u.x->>'sola')::boolean, false) and (u.x->'ahora'->>'id')::uuid = p_company and u.at >= p_desde;
  return jsonb_build_object('n', coalesce(array_length(v_ids, 1), 0), 'ids', to_jsonb(v_ids));
end $function$;
comment on function public.conta_pasadas_solas(uuid, timestamptz) is 'E04: cuántas recibidas ha pasado Sumied solo a esta sociedad desde esa hora (y siguen en ella), y cuáles. Solo lee.';
revoke all on function public.conta_pasadas_solas(uuid, timestamptz) from public, anon;
grant execute on function public.conta_pasadas_solas(uuid, timestamptz) to authenticated, service_role;
