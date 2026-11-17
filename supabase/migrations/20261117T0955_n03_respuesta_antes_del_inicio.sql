-- supabase/migrations/20261117T0955_n03_respuesta_antes_del_inicio.sql
--
-- N03 · Una factura de antes del día de inicio: Sumied para y pregunta (17/11). 1 de 2: LO QUE
-- AÑADE. No cambia ninguna fila ni ninguna función que exista; la 20261117T0956 es la que
-- hace que la pregunta pare de verdad.
--
--   1. La respuesta, en la propia factura: supplier_invoice.before_start_answer
--      («ya_estaba» o «es_nueva»), con quién y cuándo. Admite nulos: nula, no se ha
--      preguntado (o se ha deshecho). No hay hoy ninguna marca de «fuera de la contabilidad
--      de Sumied» que valga: «descartada» es «no era una factura», y supplier_invoice_auto
--      «ya_contabilizada» es la de la pasada automática, enlazada a un asiento traído.
--   2. _conta_programa_de_antes(p_company): el nombre del programa de antes para la pantalla
--      («ERP10», «Diez»), o nulo («el programa de antes»).
--   3. conta_recibida_antes_del_inicio(p_invoice): lo que la pantalla necesita para preguntar
--      (solo lee).
--   4. conta_recibida_responder_antes_del_inicio(p_invoice, p_respuesta, p_quien_nombre):
--      guarda «Sí, ya estaba» / «No, es nueva», o la deshace (nulo: «No estaba
--      contabilizada»). Confirma con contenido (regla 8).

alter table public.supplier_invoice
  add column if not exists before_start_answer text
    constraint supplier_invoice_before_start_answer_check check (before_start_answer is null or before_start_answer in ('ya_estaba', 'es_nueva')),
  add column if not exists before_start_answered_at timestamptz,
  add column if not exists before_start_answered_by_name text;

comment on column public.supplier_invoice.before_start_answer is
  'N03: la respuesta a «¿Ya estaba contabilizada en el programa de antes?» de una factura con fecha anterior al día en que la empresa empezó en Sumied (conta_dia_de_inicio). ya_estaba: no se contabiliza en Sumied. es_nueva: se contabiliza el primer día abierto, con su fecha de factura intacta. Nula: no se ha contestado.';

-- 2 · El programa de antes, en palabras de la pantalla ---------------------------------------
create or replace function public._conta_programa_de_antes(p_company uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case lower(coalesce(
           (select y.origin_program from public.fiscal_year y
             where y.company_id = p_company and y.origin in ('migrated', 'mixed') and y.origin_program is not null
             order by y.ends_on desc limit 1),
           (select r.program from public.import_run r where r.company_id = p_company order by r.started_at desc limit 1)))
           when 'erp10' then 'ERP10'
           when 'diez' then 'Diez'
         end
$$;

comment on function public._conta_programa_de_antes(uuid) is
  'N03: el nombre del programa de antes de la empresa, para la pantalla: ERP10, Diez, o nulo (otro programa o ninguno: «el programa de antes»).';

revoke all on function public._conta_programa_de_antes(uuid) from public, anon, authenticated;
grant execute on function public._conta_programa_de_antes(uuid) to service_role;

-- 3 · Lo que la pantalla necesita para preguntar (solo lee) ------------------------------------
create or replace function public.conta_recibida_antes_del_inicio(p_invoice uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v public.supplier_invoice; v_inicio date; v_traida record; v_nif text; v_num text; v_asiento boolean;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or not public.belongs_to_account(v.account_id) then
    raise exception 'Esa factura no es tuya.' using errcode = '42501';
  end if;
  if v.company_id is null or v.invoice_date is null then
    return jsonb_build_object('preguntar', false);
  end if;
  v_inicio := public.conta_dia_de_inicio(v.company_id);
  if v_inicio is null or v.invoice_date >= v_inicio then
    return jsonb_build_object('preguntar', false, 'dia_inicio', v_inicio);
  end if;

  -- ¿Ya vino con lo traído? Mismo NIF del proveedor y mismo número, en la misma empresa.
  v_nif := public._conta_nif_clave(coalesce((select s.tax_id from public.supplier s where s.id = v.supplier_id),
                                            v.issuer_tax_id, v.reading->'factura'->'proveedor'->>'nif'));
  v_num := public.conta_clave_numero(v.invoice_number);
  if v_nif is not null and v_num is not null then
    select t.id, t.invoice_number, t.invoice_date into v_traida
      from public.supplier_invoice t
      left join public.supplier s on s.id = t.supplier_id
     where t.account_id = v.account_id and t.company_id = v.company_id and t.id <> v.id
       and t.source = 'traida' and t.status not in ('anulada', 'descartada')
       and public.conta_clave_numero(t.invoice_number) = v_num
       and public._conta_nif_clave(coalesce(s.tax_id, t.issuer_tax_id, t.reading->'factura'->'proveedor'->>'nif')) = v_nif
     order by t.created_at limit 1;
  end if;

  v_asiento := exists (select 1 from public.journal_entry e
                        where e.account_id = v.account_id and e.source_type = 'supplier_invoice' and e.source_id = v.id
                          and e.status in ('propuesto', 'borrador', 'validado'));

  return jsonb_build_object(
    'preguntar', v.before_start_answer is null and v_traida.id is null and not v_asiento,
    'fecha', v.invoice_date,
    'dia_inicio', v_inicio,
    'programa', public._conta_programa_de_antes(v.company_id),
    'respuesta', v.before_start_answer,
    'respondida_por', v.before_start_answered_by_name,
    'respondida_el', v.before_start_answered_at,
    'tiene_asiento', v_asiento,
    'traida', case when v_traida.id is not null then jsonb_build_object('id', v_traida.id, 'numero', v_traida.invoice_number, 'fecha', v_traida.invoice_date) end);
end $$;

comment on function public.conta_recibida_antes_del_inicio(uuid) is
  'N03: para una recibida con fecha anterior al día de inicio de su empresa, si hay que preguntar «¿Ya estaba contabilizada?», con las fechas, el programa de antes, la respuesta que haya y, si ya vino con lo traído (mismo NIF y número, source = traida), cuál. Solo lee.';

revoke all on function public.conta_recibida_antes_del_inicio(uuid) from public, anon;
grant execute on function public.conta_recibida_antes_del_inicio(uuid) to authenticated, service_role;

-- 4 · Guardar la respuesta, o deshacerla --------------------------------------------------------
create or replace function public.conta_recibida_responder_antes_del_inicio(p_invoice uuid, p_respuesta text, p_quien_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.supplier_invoice; v_inicio date; v_prog text; v_en text; v_quien text;
begin
  select * into v from public.supplier_invoice where id = p_invoice for update;
  if v.id is null or not public.belongs_to_account(v.account_id) then
    raise exception 'Esa factura no es tuya.' using errcode = '42501';
  end if;
  if not public.current_user_is_admin_or_manager_of(v.account_id) then
    raise exception 'Esto lo decide un encargado o un administrador.' using errcode = '42501';
  end if;
  if p_respuesta is not null and p_respuesta not in ('ya_estaba', 'es_nueva') then
    raise exception 'La respuesta es «ya_estaba», «es_nueva» o ninguna.' using errcode = '22023';
  end if;
  v_prog := public._conta_programa_de_antes(v.company_id);
  v_en := coalesce('en ' || v_prog, 'en el programa de antes');
  v_quien := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor());

  if p_respuesta is null then
    -- «No estaba contabilizada»: vuelve a como estaba, sin respuesta.
    update public.supplier_invoice set before_start_answer = null, before_start_answered_at = null,
           before_start_answered_by_name = null, updated_at = now()
     where id = v.id;
    return jsonb_build_object('respuesta', null,
      'texto', 'Hecho. Vuelve a estar sin contabilizar: al contabilizarla, Sumied te lo volverá a preguntar.');
  end if;

  v_inicio := public.conta_dia_de_inicio(v.company_id);
  if v_inicio is null or v.invoice_date is null or v.invoice_date >= v_inicio then
    raise exception 'Esta factura no es de antes de que la empresa empezara en Sumied: no hay nada que preguntar.' using errcode = '22023';
  end if;
  if p_respuesta = 'ya_estaba' and exists (
       select 1 from public.journal_entry e where e.account_id = v.account_id and e.source_type = 'supplier_invoice'
          and e.source_id = v.id and e.status in ('propuesto', 'borrador', 'validado')) then
    raise exception 'Esta factura ya tiene su asiento en Sumied: anúlalo antes de decir que ya estaba %.', v_en using errcode = '23514';
  end if;

  update public.supplier_invoice set before_start_answer = p_respuesta, before_start_answered_at = now(),
         before_start_answered_by_name = v_quien, updated_at = now()
   where id = v.id;
  return jsonb_build_object('respuesta', p_respuesta, 'programa', v_prog,
    'texto', case when p_respuesta = 'ya_estaba'
                  then format('Hecho. No se contabiliza: ya estaba %s.', v_en)
                  else 'Anotado: es nueva. Se contabiliza en el primer día abierto, con su fecha de factura.' end);
end $$;

comment on function public.conta_recibida_responder_antes_del_inicio(uuid, text, text) is
  'N03: guarda la respuesta a «¿Ya estaba contabilizada en el programa de antes?» (ya_estaba / es_nueva) de una recibida anterior al día de inicio, o la deshace (nulo). Encargado o administrador. Devuelve el texto para la pantalla.';

revoke all on function public.conta_recibida_responder_antes_del_inicio(uuid, text, text) from public, anon;
grant execute on function public.conta_recibida_responder_antes_del_inicio(uuid, text, text) to authenticated, service_role;

-- 5 · Lo que para de verdad (la llama _conta_recibida_no_antes_de_entrar desde la 0956) --------
-- Una recibida con fecha anterior al día de inicio de su empresa: sin respuesta, no se
-- contabiliza y se dice que hay que preguntar; con «ya_estaba», no se contabiliza nunca; con
-- «es_nueva», devuelve el día de inicio: su asiento va al primer día abierto desde ese día
-- (con su fecha de factura intacta). Nulo: no le toca (sin día de inicio, o no es de antes).
create or replace function public._conta_recibida_antes_del_inicio_para(p_company uuid, p_invoice uuid)
returns date
language plpgsql
stable
security definer
set search_path = public
as $$
declare v public.supplier_invoice; v_inicio date; v_en text;
begin
  select * into v from public.supplier_invoice where id = p_invoice;
  if v.id is null or v.invoice_date is null then return null; end if;
  v_inicio := public.conta_dia_de_inicio(p_company);
  if v_inicio is null or v.invoice_date >= v_inicio then return null; end if;
  if v.before_start_answer = 'es_nueva' then return v_inicio; end if;
  v_en := coalesce('en ' || public._conta_programa_de_antes(p_company), 'en el programa de antes');
  if v.before_start_answer = 'ya_estaba' then
    raise exception 'No se contabiliza: esta factura ya estaba contabilizada %.', v_en
      using errcode = '23514', hint = 'antes_del_inicio_ya_estaba';
  end if;
  raise exception 'Esta factura es del %, y esta empresa empezó en Sumied el %. Antes de contabilizarla, di si ya estaba contabilizada %.',
    to_char(v.invoice_date, 'DD/MM/YYYY'), to_char(v_inicio, 'DD/MM/YYYY'), v_en
    using errcode = '23514', hint = 'antes_del_inicio';
end $$;

comment on function public._conta_recibida_antes_del_inicio_para(uuid, uuid) is
  'N03: para una recibida anterior al día de inicio sin respuesta (hint antes_del_inicio) o con «ya estaba» (hint antes_del_inicio_ya_estaba); con «es nueva», devuelve el día de inicio. La llama _conta_recibida_no_antes_de_entrar al proponer su asiento: vale para cualquier puerta.';

revoke all on function public._conta_recibida_antes_del_inicio_para(uuid, uuid) from public, anon, authenticated;
grant execute on function public._conta_recibida_antes_del_inicio_para(uuid, uuid) to service_role;
