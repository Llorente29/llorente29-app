-- S01d · Préstamos y aplazamientos (tablero 3; respuesta 1 de Julio, 30/10).
-- cambia: recurring_contract · prueba: supabase/staging/sql/20261030_s01d_bancos_retenciones_prueba.sql
--
-- El contrato con cuota crece para los aplazamientos (Seguridad Social,
-- Hacienda) y la póliza de crédito: el capital a largo (170/171) y a corto
-- (520/521) por separado, el banco donde se carga, el importe y el número de
-- cuotas, el documento que se leyó y lo que queda por pagar en cada fila del
-- cuadro. Y una función para darlo de alta desde «Subir el cuadro»: no se
-- guarda nada hasta que la persona confirma, y no se guarda un cuadro cuyo
-- capital no sume lo aplazado.
--
-- Lo que NO hace (fuera del encargo): reclasificar de largo a corto al
-- cerrar el año (170 → 520). Va con el cierre de 2026.

-- ── 1 · Columnas nuevas (todas admiten nulos) ──────────────────────────────
alter table public.recurring_contract
  add column if not exists long_capital_account  text,
  add column if not exists short_capital_account text,
  add column if not exists treasury_account_id   uuid references public.treasury_account(id) on delete set null,
  add column if not exists principal             numeric(14,2) check (principal is null or principal > 0),
  add column if not exists installments          integer check (installments is null or installments > 0),
  add column if not exists document_name         text,
  add column if not exists document_kind         text check (document_kind is null or document_kind in ('excel', 'pdf', 'a_mano'));

comment on column public.recurring_contract.long_capital_account is 'S01d. El capital a más de un año (170/171). Pasarlo a corto al cerrar el año va con el cierre, no aquí.';
comment on column public.recurring_contract.short_capital_account is 'S01d. El capital a menos de un año (520/521): ahí va el capital de cada cuota.';
comment on column public.recurring_contract.treasury_account_id is 'S01d. El banco donde se carga la cuota.';
comment on column public.recurring_contract.principal is 'S01d. El importe prestado o aplazado: el capital del cuadro tiene que sumarlo.';
comment on column public.recurring_contract.document_name is 'S01d. El cuadro o la resolución que se leyó (nombre del fichero).';

-- ── 2 · Los tipos: también aplazamiento y póliza ───────────────────────────
-- Solo amplía: lo que valía antes sigue valiendo.
alter table public.recurring_contract drop constraint if exists recurring_contract_kind_check;
alter table public.recurring_contract add constraint recurring_contract_kind_check
  check (kind in ('prestamo', 'alquiler', 'otro', 'aplazamiento', 'poliza'));

-- La póliza no tiene cuota fija: su importe puede faltar (los demás lo siguen llevando).
alter table public.recurring_contract alter column amount drop not null;
alter table public.recurring_contract drop constraint if exists recurring_contract_importe;
alter table public.recurring_contract add constraint recurring_contract_importe
  check (kind = 'poliza' or amount is not null);

-- El préstamo, el aplazamiento y la póliza, con capital e intereses; lo demás, con su gasto.
alter table public.recurring_contract drop constraint if exists recurring_contract_cuentas;
alter table public.recurring_contract add constraint recurring_contract_cuentas check (
  (kind in ('prestamo', 'aplazamiento', 'poliza') and capital_account is not null and interest_account is not null)
  or (kind not in ('prestamo', 'aplazamiento', 'poliza') and expense_account is not null));

-- ── 3 · Lo que queda por pagar después de cada fila ────────────────────────
create or replace function public.conta_cuadro_con_pendiente(p_cuadro jsonb, p_importe numeric)
returns jsonb language sql immutable set search_path = public as $$
  select coalesce(jsonb_agg(a.fila || jsonb_build_object('pendiente', round(p_importe - a.acumulado, 2)) order by a.n), '[]'::jsonb)
    from (select f.fila, f.n, sum((f.fila->>'capital')::numeric) over (order by f.n) as acumulado
            from jsonb_array_elements(p_cuadro) with ordinality as f(fila, n)) a
$$;
comment on function public.conta_cuadro_con_pendiente(jsonb, numeric) is
  'S01d. El cuadro de un contrato con lo que queda por pagar después de cada fila (importe menos el capital acumulado).';

-- ── 4 · Dar de alta un contrato desde «Subir el cuadro» ────────────────────
create or replace function public.bank_contrato_guardar(p_company uuid, p_datos jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_account uuid; v_id uuid; v_kind text := p_datos->>'tipo'; v_cuadro jsonb := p_datos->'cuadro';
  v_importe numeric := nullif(p_datos->>'importe', '')::numeric; v_suma numeric; v_cuotas int;
  v_banco uuid := nullif(p_datos->>'banco', '')::uuid; v_corto text := nullif(p_datos->>'capital_corto', '');
  v_largo text := nullif(p_datos->>'capital_largo', ''); v_int text := nullif(p_datos->>'intereses', '');
begin
  select account_id into v_account from public.company where id = p_company;
  if v_account is null or not public.current_user_is_admin_or_manager_of(v_account) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
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
  if exists (select 1 from unnest(array[v_corto, v_largo, v_int]) c(code)
              where c.code is not null and not exists (select 1 from public.company_account a where a.company_id = p_company and a.code = c.code)) then
    raise exception 'Alguna de las cuentas no está en el plan de la empresa.' using errcode = '22023';
  end if;

  if v_kind <> 'poliza' then
    if v_cuadro is null or jsonb_typeof(v_cuadro) <> 'array' or jsonb_array_length(v_cuadro) = 0 then
      raise exception 'Falta el cuadro: las fechas, las cuotas, el capital y los intereses.' using errcode = '22023';
    end if;
    if v_importe is null then raise exception 'Falta el importe prestado o aplazado.' using errcode = '22023'; end if;
    select round(sum((f->>'capital')::numeric), 2), count(*) into v_suma, v_cuotas from jsonb_array_elements(v_cuadro) f;
    if v_suma <> round(v_importe, 2) then
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
    else format('Guardado «%s»: %s cuotas, %s aplazados. Cada cuota se casará sola con su fila del cuadro.',
      trim(p_datos->>'nombre'), v_cuotas, public.conta_impuesto_euros(v_importe)) end);
end $$;
revoke all on function public.bank_contrato_guardar(uuid, jsonb) from public, anon;
grant execute on function public.bank_contrato_guardar(uuid, jsonb) to authenticated;
comment on function public.bank_contrato_guardar(uuid, jsonb) is
  'S01d. Alta de un préstamo, aplazamiento o póliza desde «Subir el cuadro» (tablero 3). No guarda un cuadro cuyo capital no sume lo aplazado.';
