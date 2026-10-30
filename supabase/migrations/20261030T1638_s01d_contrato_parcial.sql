-- cambia: public.bank_contrato_guardar · prueba: supabase/staging/sql/20261030_s01d_contrato_parcial_prueba.sql
--
-- S01d-b · El aplazamiento de la Seguridad Social no se podía guardar
-- (respuesta 3 de Julio, 30/10). La TGSS manda el cuadro del año en curso:
-- de 36 cuotas, el de 2026 trae 2 filas, y el de cada año siguiente llega
-- cuando fija su interés. Así que un cuadro puede ser PARCIAL:
--
--   · el número total de cuotas sale del texto (`cuotas`), y las filas
--     conocidas son las del cuadro;
--   · la comprobación ya no es «el capital suma lo aplazado», sino «lo
--     aplazado menos el capital de las filas leídas da la deuda pendiente del
--     cuadro» (`pendiente`);
--   · «Subir el cuadro» sobre un contrato que ya existe (`contrato`) le añade
--     las filas del año nuevo (solo las de después de la última que tiene),
--     sin crear otro, con la misma comprobación sobre todas sus filas.
--
-- Un cuadro completo sigue como antes (el capital suma lo aplazado).

select public._respaldar_funcion('public.bank_contrato_guardar(uuid,jsonb)', '20261030T1638_s01d_contrato_parcial');

create or replace function public.bank_contrato_guardar(p_company uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account uuid; v_id uuid; v_kind text := p_datos->>'tipo'; v_cuadro jsonb := p_datos->'cuadro';
  v_importe numeric := nullif(p_datos->>'importe', '')::numeric; v_suma numeric; v_filas int; v_cuotas int;
  v_total int := nullif(p_datos->>'cuotas', '')::int; v_pendiente numeric := nullif(p_datos->>'pendiente', '')::numeric;
  v_banco uuid := nullif(p_datos->>'banco', '')::uuid; v_corto text := nullif(p_datos->>'capital_corto', '');
  v_largo text := nullif(p_datos->>'capital_largo', ''); v_int text := nullif(p_datos->>'intereses', '');
  v_contrato uuid := nullif(p_datos->>'contrato', '')::uuid; c public.recurring_contract; v_ultima date; v_nuevas int;
  v_aviso text;
begin
  select account_id into v_account from public.company where id = p_company;
  if v_account is null or not public.current_user_is_admin_or_manager_of(v_account) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;

  -- ── Añadir las filas del año nuevo a un contrato que ya existe ──────────
  if v_contrato is not null then
    select * into c from public.recurring_contract where id = v_contrato and company_id = p_company;
    if c.id is null then raise exception 'Ese contrato no está.' using errcode = 'P0002'; end if;
    if c.kind = 'poliza' or c.principal is null then
      raise exception 'Una póliza no tiene cuadro: sus liquidaciones se reparten con la del banco.' using errcode = '22023';
    end if;
    if v_cuadro is null or jsonb_typeof(v_cuadro) <> 'array' or jsonb_array_length(v_cuadro) = 0 then
      raise exception 'Falta el cuadro: las fechas, las cuotas, el capital y los intereses.' using errcode = '22023';
    end if;
    select max((f->>'fecha')::date) into v_ultima from jsonb_array_elements(coalesce(c.schedule, '[]'::jsonb)) f;
    -- Solo las filas de después de la última que tiene: subir otra vez el mismo cuadro no duplica nada.
    select coalesce(jsonb_agg(f order by (f->>'fecha')::date), '[]'::jsonb), count(*) into v_cuadro, v_nuevas
      from jsonb_array_elements(v_cuadro) f where v_ultima is null or (f->>'fecha')::date > v_ultima;
    if v_nuevas = 0 then
      raise exception 'Ese cuadro no trae ninguna cuota después de la última que ya tiene «%» (%): no añado nada.',
        c.name, to_char(v_ultima, 'DD/MM/YYYY') using errcode = '22023';
    end if;
    v_cuadro := coalesce((select jsonb_agg(f - 'pendiente' order by (f->>'fecha')::date) from jsonb_array_elements(coalesce(c.schedule, '[]'::jsonb)) f), '[]'::jsonb) || v_cuadro;
    select round(sum((f->>'capital')::numeric), 2), count(*) into v_suma, v_filas from jsonb_array_elements(v_cuadro) f;
    v_cuotas := greatest(coalesce(c.installments, 0), v_filas);
    if v_filas < v_cuotas then
      if v_pendiente is null then
        raise exception 'Con las cuotas de este cuadro quedan % sin conocer: di la deuda pendiente que trae el cuadro, para comprobarlo.', v_cuotas - v_filas using errcode = '22023';
      end if;
      if round(c.principal - v_suma, 2) <> round(v_pendiente, 2) then
        raise exception 'Lo aplazado (%) menos el capital de las % cuotas conocidas (%) da %, y el cuadro dice que quedan %: no cuadra, no lo añado.',
          public.conta_impuesto_euros(c.principal), v_filas, public.conta_impuesto_euros(v_suma),
          public.conta_impuesto_euros(c.principal - v_suma), public.conta_impuesto_euros(v_pendiente) using errcode = '22023';
      end if;
    elsif v_suma <> round(c.principal, 2) then
      raise exception 'Con este cuadro están las % cuotas, y el capital suma % de los % aplazados: no cuadra, no lo añado.',
        v_filas, public.conta_impuesto_euros(v_suma), public.conta_impuesto_euros(c.principal) using errcode = '22023';
    end if;
    update public.recurring_contract set schedule = public.conta_cuadro_con_pendiente(v_cuadro, c.principal), installments = v_cuotas,
           document_name = coalesce(nullif(p_datos->>'documento', ''), document_name)
     where id = c.id;
    v_aviso := case when v_filas < v_cuotas then format(' Faltan las cuotas de %s: sube el cuadro de ese año cuando llegue.',
      extract(year from (select max((f->>'fecha')::date) from jsonb_array_elements(v_cuadro) f))::int + 1) else '' end;
    return jsonb_build_object('id', c.id, 'mensaje', format('Añadidas %s cuotas a «%s»: ya tiene %s de %s.%s', v_nuevas, c.name, v_filas, v_cuotas, v_aviso));
  end if;

  -- ── Un contrato nuevo ─────────────────────────────────────────────────────
  if v_kind is null or v_kind not in ('prestamo', 'aplazamiento', 'poliza') then
    raise exception 'Di qué es: un préstamo, un aplazamiento o una póliza.' using errcode = '22023';
  end if;
  if coalesce(trim(p_datos->>'nombre'), '') = '' then raise exception 'Ponle un nombre al contrato.' using errcode = '22023'; end if;
  if coalesce(trim(p_datos->>'contiene'), '') = '' then
    raise exception 'Di qué pone el banco en el concepto de la cuota.' using errcode = '22023';
  end if;
  if v_corto is null or v_int is null then
    raise exception 'Faltan las cuentas: el capital a corto y los intereses.' using errcode = '22023';
  end if;
  if v_banco is not null and not exists (select 1 from public.treasury_account t where t.id = v_banco and t.company_id = p_company) then
    raise exception 'Ese banco no es de esta empresa.' using errcode = '22023';
  end if;
  -- Las cuentas, del plan de esta empresa (regla 9: nunca por nombre ni de otra cuenta).
  if exists (select 1 from unnest(array[v_corto, v_largo, v_int]) cu(code)
              where cu.code is not null and not exists (select 1 from public.company_account a where a.company_id = p_company and a.code = cu.code)) then
    raise exception 'Alguna de las cuentas no está en el plan de la empresa.' using errcode = '22023';
  end if;

  if v_kind <> 'poliza' then
    if v_cuadro is null or jsonb_typeof(v_cuadro) <> 'array' or jsonb_array_length(v_cuadro) = 0 then
      raise exception 'Falta el cuadro: las fechas, las cuotas, el capital y los intereses.' using errcode = '22023';
    end if;
    if v_importe is null then raise exception 'Falta el importe prestado o aplazado.' using errcode = '22023'; end if;
    select round(sum((f->>'capital')::numeric), 2), count(*) into v_suma, v_filas from jsonb_array_elements(v_cuadro) f;
    v_cuotas := greatest(coalesce(v_total, 0), v_filas);
    if v_filas < v_cuotas then
      -- Cuadro parcial: lo aplazado menos el capital de las filas leídas es la deuda pendiente del cuadro.
      if v_pendiente is null then
        raise exception 'El cuadro trae % de % cuotas: di la deuda pendiente que trae, para comprobarlo.', v_filas, v_cuotas using errcode = '22023';
      end if;
      if round(v_importe - v_suma, 2) <> round(v_pendiente, 2) then
        raise exception 'Lo aplazado (%) menos el capital de las % cuotas del cuadro (%) da %, y el cuadro dice que quedan %: no cuadra, no lo guardo.',
          public.conta_impuesto_euros(v_importe), v_filas, public.conta_impuesto_euros(v_suma),
          public.conta_impuesto_euros(v_importe - v_suma), public.conta_impuesto_euros(v_pendiente) using errcode = '22023';
      end if;
      v_aviso := format(' Faltan las cuotas de %s: sube el cuadro de ese año cuando llegue.',
        extract(year from (select max((f->>'fecha')::date) from jsonb_array_elements(v_cuadro) f))::int + 1);
    elsif v_suma <> round(v_importe, 2) then
      raise exception 'La suma del capital da % y lo aplazado es %: el cuadro no cuadra, no lo guardo.',
        public.conta_impuesto_euros(v_suma), public.conta_impuesto_euros(v_importe) using errcode = '22023';
    end if;
    v_cuadro := public.conta_cuadro_con_pendiente(v_cuadro, v_importe);
  end if;

  insert into public.recurring_contract (account_id, company_id, kind, name, concept_contains, amount, schedule, capital_account, interest_account,
    long_capital_account, short_capital_account, treasury_account_id, principal, installments, document_name, document_kind, created_by, created_by_name)
  values (v_account, p_company, v_kind, trim(p_datos->>'nombre'), trim(p_datos->>'contiene'),
    case when v_kind = 'poliza' then null else (v_cuadro->0->>'cuota')::numeric end,
    case when v_kind = 'poliza' then null else v_cuadro end,
    v_corto, v_int, v_largo, v_corto, v_banco, v_importe, v_cuotas,
    nullif(p_datos->>'documento', ''), coalesce(nullif(p_datos->>'documento_tipo', ''), 'a_mano'), auth.uid(), public.conta_nombre_actor())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'mensaje', case when v_kind = 'poliza'
    then format('Guardada la póliza «%s»: sus liquidaciones se reparten con la del banco.', trim(p_datos->>'nombre'))
    else format('Guardado «%s»: %s cuotas, %s aplazados. Cada cuota se casará sola con su fila del cuadro.%s',
      trim(p_datos->>'nombre'), v_cuotas, public.conta_impuesto_euros(v_importe), coalesce(v_aviso, '')) end);
end $$;
revoke all on function public.bank_contrato_guardar(uuid, jsonb) from public, anon;
grant execute on function public.bank_contrato_guardar(uuid, jsonb) to authenticated;
comment on function public.bank_contrato_guardar(uuid, jsonb) is
  'S01d. Alta de un préstamo, aplazamiento o póliza desde «Subir el cuadro» (tablero 3). S01d-b: cuadro parcial (cuotas del texto y deuda pendiente) y añadir las filas del año nuevo a un contrato que ya existe.';
