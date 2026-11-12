-- supabase/migrations/20261112T1755_s01p_linea_socio.sql
--
-- S01p·18 · punto 1 · Una línea que la liquidación del socio no conoce ya no
-- bloquea para siempre (Julio, 12/11). El «Resumen de Transacción» de octubre de
-- Alcalá (AF-02979 / FV-02979) trae «Financiación inventario pendiente por
-- pagar», 770,00 €: género del mes que el socio aún no ha facturado y cobrará en
-- la factura del mes siguiente. El lector la mandaba a «bloqueos» y el guardado
-- se quedaba gris.
--
-- Ahora la liquidación PREGUNTA «¿Qué es esta línea?» y apunta lo que se dice
-- (Respuesta S01p·18.1, 12/11 17:35):
--   · «Género que te cobrará el mes que viene» (pendiente_facturar): Debe su
--     430 / Haber 4009 «Proveedores, facturas pendientes de recibir o de
--     formalizar», en el local. Es el asiento 3392 que Julio hizo a mano para
--     octubre de Alcalá. Asiento propio (origen purchase_accrual, la liquidación).
--   · «Género del mes pasado que ya te cobra» (cancela_pendiente): el contrario,
--     Debe 4009 / Haber su 430 (origen purchase_accrual_reversal). Nunca por más
--     de lo pendiente con ese socio en ese local: no se fuerza el cuadre.
--   · «Otra cosa: la apunto yo a mano» (a_mano): sin asiento; la factura que le
--     haces lo dice en «Mira esto».
-- La cancelación sola (la transacción del mes siguiente trae la línea en
-- negativo por lo pendiente, o su saldo cuadra restando lo pendiente) la decide
-- el lector, que pregunta lo pendiente a compras_socio_pendiente.
--
-- Lo que se contesta se recuerda por socio y concepto (socio_linea_regla), y se
-- cambia en la pregunta y en la ficha del socio.
--
--   · socio_linea_regla y sus RPC (compras_socio_reglas, compras_socio_regla_guardar).
--   · _conta_socio_pendiente / compras_socio_pendiente: lo pendiente de facturar
--     con un socio en un local (la 4009 de los asientos que tocan su 430).
--   · conta_propuestas_socio, fórmula «documentos»: el saldo cuadra con las dos
--     facturas MÁS las líneas contestadas, y propone el asiento de la 4009.
--     Tres reemplazos exactos, con respaldo.
--
-- cambia: public.conta_propuestas_socio · prueba: supabase/staging/sql/20261112_s01p_linea_socio_prueba.sql
--
-- Nada en el camino del pedido.

create table if not exists public.socio_linea_regla (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  supplier_id uuid not null references public.supplier(id) on delete cascade,
  concepto text not null,
  clave text not null,
  que_es text not null check (que_es in ('pendiente_facturar', 'cancela_pendiente', 'a_mano')),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  updated_at timestamptz not null default now(),
  updated_by_name text,
  unique (company_id, supplier_id, clave)
);
comment on table public.socio_linea_regla is 'S01p·18 · Lo que es cada línea de la transacción del socio de marca que no es ninguna de las dos facturas, contestado una vez y recordado por socio y concepto.';
alter table public.socio_linea_regla enable row level security;
drop policy if exists socio_linea_regla_read on public.socio_linea_regla;
create policy socio_linea_regla_read on public.socio_linea_regla for select using (account_id = any (public.current_user_account_ids()));

-- La clave de un concepto: en minúsculas y con un solo espacio (el lector hace lo mismo).
create or replace function public._socio_linea_clave(p_concepto text)
returns text language sql immutable set search_path = public as $$
  select lower(regexp_replace(btrim(coalesce(p_concepto, '')), '\s+', ' ', 'g'))
$$;

create or replace function public.compras_socio_reglas(p_empresa uuid, p_proveedor uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid;
begin
  select account_id into v_cuenta from public.company where id = p_empresa;
  if v_cuenta is null or not (v_cuenta = any (public.current_user_account_ids())) then
    raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('concepto', r.concepto, 'clave', r.clave, 'queEs', r.que_es,
                                                       'fecha', r.updated_at, 'quien', coalesce(r.updated_by_name, r.created_by_name)) order by r.concepto)
                     from public.socio_linea_regla r where r.company_id = p_empresa and r.supplier_id = p_proveedor and r.account_id = v_cuenta), '[]'::jsonb);
end $$;

-- p_que_es null: se olvida (la próxima vez pregunta).
create or replace function public.compras_socio_regla_guardar(p_empresa uuid, p_proveedor uuid, p_concepto text, p_que_es text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_cuenta uuid; v_clave text := public._socio_linea_clave(p_concepto); v_nombre text := public.conta_nombre_actor(); r public.socio_linea_regla;
begin
  select account_id into v_cuenta from public.company where id = p_empresa;
  if v_cuenta is null or not public.current_user_is_admin_or_manager_of(v_cuenta) then
    raise exception 'No puedes cambiar lo que sé de este socio.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.supplier where id = p_proveedor and account_id = v_cuenta) then
    raise exception 'Ese proveedor no es de esta cuenta.' using errcode = '42501';
  end if;
  if v_clave = '' then raise exception 'La línea no tiene concepto.' using errcode = '22023'; end if;
  if p_que_es is null then
    delete from public.socio_linea_regla where company_id = p_empresa and supplier_id = p_proveedor and clave = v_clave;
    return null;
  end if;
  if p_que_es not in ('pendiente_facturar', 'cancela_pendiente', 'a_mano') then
    raise exception 'No sé qué es «%».', p_que_es using errcode = '22023';
  end if;
  insert into public.socio_linea_regla (account_id, company_id, supplier_id, concepto, clave, que_es, created_by, created_by_name, updated_by_name)
  values (v_cuenta, p_empresa, p_proveedor, btrim(p_concepto), v_clave, p_que_es, auth.uid(), v_nombre, v_nombre)
  on conflict (company_id, supplier_id, clave) do update set que_es = excluded.que_es, concepto = excluded.concepto, updated_at = now(), updated_by_name = v_nombre
  returning * into r;
  return jsonb_build_object('concepto', r.concepto, 'clave', r.clave, 'queEs', r.que_es, 'fecha', r.updated_at, 'quien', r.updated_by_name);
end $$;

-- Lo pendiente de facturar con un socio en un local: el Haber menos el Debe de la
-- 4009 en los asientos que tocan su 430 (también los anulados: su contrario lo
-- deja a cero). p_excluir: los de esa liquidación, para no contarse a sí misma.
create or replace function public._conta_socio_pendiente(p_company uuid, p_party uuid, p_local uuid, p_excluir uuid default null)
returns numeric language sql stable security definer set search_path = public as $$
  with c as (select public._conta_enlace(p_company, 'customer', p_party::text, 'principal') as cli, public._conta_hoja(p_company, '4009') as pend)
  select coalesce(sum(jl.credit - jl.debit), 0)
    from c
    join public.company_account ca on ca.company_id = p_company and ca.code = c.pend
    join public.journal_line jl on jl.company_account_id = ca.id
    join public.journal_entry e on e.id = jl.entry_id
   where e.company_id = p_company and e.status in ('propuesto', 'borrador', 'validado', 'anulado')
     and jl.location_id is not distinct from p_local
     and (p_excluir is null or e.source_id is distinct from p_excluir)
     and exists (select 1 from public.journal_line j2 join public.company_account c2 on c2.id = j2.company_account_id
                  where j2.entry_id = e.id and c2.company_id = p_company and c2.code = c.cli)
$$;

create or replace function public.compras_socio_pendiente(p_empresa uuid, p_proveedor uuid, p_local uuid)
returns numeric language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v_party uuid;
begin
  select account_id into v_cuenta from public.company where id = p_empresa;
  if v_cuenta is null or not (v_cuenta = any (public.current_user_account_ids())) then
    raise exception 'Esa empresa no es de tu cuenta.' using errcode = '42501';
  end if;
  select pr.party_id into v_party from public.party_role pr join public.supplier s on s.id = pr.supplier_id
   where pr.supplier_id = p_proveedor and s.account_id = v_cuenta limit 1;
  if v_party is null then return 0; end if;
  return public._conta_socio_pendiente(p_empresa, v_party, p_local, null);
end $$;

revoke all on function public._socio_linea_clave(text) from public, anon;
revoke all on function public.compras_socio_reglas(uuid, uuid) from public, anon;
revoke all on function public.compras_socio_regla_guardar(uuid, uuid, text, text) from public, anon;
revoke all on function public._conta_socio_pendiente(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.compras_socio_pendiente(uuid, uuid, uuid) from public, anon;
grant execute on function public._socio_linea_clave(text) to authenticated, service_role;
grant execute on function public.compras_socio_reglas(uuid, uuid) to authenticated, service_role;
grant execute on function public.compras_socio_regla_guardar(uuid, uuid, text, text) to authenticated, service_role;
grant execute on function public._conta_socio_pendiente(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.compras_socio_pendiente(uuid, uuid, uuid) to authenticated, service_role;

select public._respaldar_funcion('public.conta_propuestas_socio(uuid,uuid)', '20261112T1755_s01p_linea_socio');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_propuestas_socio(uuid,uuid)'::regprocedure);
  -- 1 · Las variables nuevas.
  v_viejo1 constant text := '  v_meses text[] := array[';
  v_nuevo1 constant text := '  v_extra jsonb := ''[]''::jsonb; v_aj jsonb; v_pend numeric; v_pendfac numeric := 0; v_cancela numeric := 0; v_amano numeric := 0; c_4009 text; v_conc text;
  v_meses text[] := array[';
  -- 2 · El saldo: las dos facturas MÁS las líneas de la transacción que se han contestado.
  v_viejo2 constant text := '    if v_saldo_doc is not null and round(v_saldo_doc * 100) <> round(v_saldo * 100) then
      return jsonb_build_object(''que'', v_que, ''sin_propuesta'', ''La transacción dice '' || public.conta_euros_exactos(v_saldo_doc) || '' de saldo y las dos facturas dan '' || public.conta_euros_exactos(v_saldo) || ''.'');
    end if;';
  v_nuevo2 constant text := '    -- S01p·18 · Las líneas de la transacción que no son ninguna de las dos facturas: lo que se ha dicho que son.
    v_aj := case when jsonb_typeof(d->''lineasSocio'') = ''array'' then d->''lineasSocio'' else ''[]''::jsonb end;
    select string_agg(''«'' || coalesce(x->>''concepto'', ''?'') || ''»'', '', '') into v_conc from jsonb_array_elements(v_aj) x
     where coalesce(x->>''queEs'', '''') not in (''pendiente_facturar'', ''cancela_pendiente'', ''a_mano'');
    if v_conc is not null then
      return jsonb_build_object(''que'', v_que, ''sin_propuesta'', ''La transacción trae '' || v_conc || '' y aún no me has dicho qué es: contéstalo en la liquidación.'');
    end if;
    select coalesce(sum((x->>''importe'')::numeric) filter (where x->>''queEs'' = ''pendiente_facturar''), 0),
           coalesce(sum((x->>''importe'')::numeric) filter (where x->>''queEs'' = ''cancela_pendiente''), 0),
           coalesce(sum((x->>''importe'')::numeric) filter (where x->>''queEs'' = ''a_mano''), 0)
      into v_pendfac, v_cancela, v_amano from jsonb_array_elements(v_aj) x;
    if round(v_pendfac * 100) < 0 then
      return jsonb_build_object(''que'', v_que, ''sin_propuesta'', ''El género que te cobrará el mes que viene viene en negativo ('' || public.conta_euros_exactos(v_pendfac) || ''): ¿no será el del mes pasado?'');
    end if;
    if round(v_cancela * 100) > 0 then
      return jsonb_build_object(''que'', v_que, ''sin_propuesta'', ''El género del mes pasado que ya te cobra viene en positivo ('' || public.conta_euros_exactos(v_cancela) || ''): ¿no será el de este mes?'');
    end if;
    if round(v_pendfac * 100) <> 0 or round(v_cancela * 100) <> 0 then
      c_4009 := public._conta_hoja(p_company, ''4009'');
      if c_4009 is null then return jsonb_build_object(''que'', v_que, ''sin_propuesta'', ''Falta en tu plan la cuenta de facturas pendientes de recibir (4009).''); end if;
    end if;
    if round(v_cancela * 100) <> 0 then
      v_pend := public._conta_socio_pendiente(p_company, l.party_id, loc, l.id);
      if round(-v_cancela * 100) > round(v_pend * 100) then
        return jsonb_build_object(''que'', v_que, ''sin_propuesta'', ''Cancela '' || public.conta_euros_exactos(-v_cancela) || '' de género pendiente y con '' || v_socio || '' en '' || v_local
                 || '' solo queda '' || public.conta_euros_exactos(v_pend) || '' pendiente de facturar: dime qué es esa línea.'');
      end if;
    end if;
    if v_saldo_doc is not null and round(v_saldo_doc * 100) <> round(v_saldo * 100) + round((v_pendfac + v_cancela + v_amano) * 100) then
      return jsonb_build_object(''que'', v_que, ''sin_propuesta'', ''La transacción dice '' || public.conta_euros_exactos(v_saldo_doc) || '' de saldo y las dos facturas dan '' || public.conta_euros_exactos(v_saldo)
               || case when jsonb_array_length(v_aj) > 0 then '' más sus otras líneas, '' || public.conta_euros_exactos(v_pendfac + v_cancela + v_amano) else '''' end || ''.'');
    end if;';
  -- 3 · Los asientos de la 4009, y lo que se apunta a mano, antes de la compensación.
  v_viejo3 constant text := '    -- 3 · La compensación: su factura se paga con lo que te debe.';
  v_nuevo3 constant text := '    -- S01p·18 · El género que te cobrará el mes que viene, y su contrario: entre su 430 y la 4009, en el local.
    if round(v_pendfac * 100) <> 0 then
      select string_agg(''«'' || (x->>''concepto'') || ''»'', '', '') into v_conc from jsonb_array_elements(v_aj) x where x->>''queEs'' = ''pendiente_facturar'';
      v_extra := v_extra || jsonb_build_array(jsonb_build_object(
        ''entrada'', jsonb_build_object(''series'', 4, ''fecha'', em->>''fecha'',
          ''concepto'', v_socio || '' · '' || coalesce(em->>''numero'', '''') || '' · género que te facturará el mes que viene'',
          ''source_type'', ''purchase_accrual'', ''source_id'', l.id, ''confianza'', ''seguro'',
          ''porque'', ''Te paga '' || public.conta_euros_exactos(v_pendfac) || '' más por género que aún no te ha facturado: es deuda con él hasta que llegue su factura, y se cancela con la liquidación siguiente.'',
          ''razones'', jsonb_build_array(jsonb_build_object(''decision'', ''A facturas pendientes de recibir (4009)'', ''porque'', ''lo dijiste tú: '' || v_conc || '' es género que te cobrará el mes que viene'')),
          ''party_id'', l.party_id, ''documento'', null),
        ''lineas'', jsonb_build_array(
          jsonb_build_object(''cuenta'', c_cliente, ''debe'', v_pendfac, ''haber'', 0, ''concepto'', null, ''local_id'', loc, ''comun'', comun,
            ''marca_id'', null, ''tercero_id'', l.party_id, ''documento'', null, ''iva'', null, ''retencion'', null),
          jsonb_build_object(''cuenta'', c_4009, ''debe'', 0, ''haber'', v_pendfac, ''concepto'', null, ''local_id'', loc, ''comun'', comun,
            ''marca_id'', null, ''tercero_id'', l.party_id, ''documento'', null, ''iva'', null, ''retencion'', null))));
    end if;
    if round(v_cancela * 100) <> 0 then
      select string_agg(''«'' || (x->>''concepto'') || ''»'', '', '') into v_conc from jsonb_array_elements(v_aj) x where x->>''queEs'' = ''cancela_pendiente'';
      v_extra := v_extra || jsonb_build_array(jsonb_build_object(
        ''entrada'', jsonb_build_object(''series'', 4, ''fecha'', em->>''fecha'',
          ''concepto'', v_socio || '' · '' || coalesce(em->>''numero'', '''') || '' · se cancela el género pendiente del mes pasado'',
          ''source_type'', ''purchase_accrual_reversal'', ''source_id'', l.id, ''confianza'', ''seguro'',
          ''porque'', ''Ya te cobra '' || public.conta_euros_exactos(-v_cancela) || '' del género que quedó pendiente de facturar: la deuda con él baja y lo que te paga, también.'',
          ''razones'', jsonb_build_array(jsonb_build_object(''decision'', ''Se cancela lo pendiente en facturas pendientes de recibir (4009)'', ''porque'', v_conc || '' es el género del mes pasado que ya te cobra'')),
          ''party_id'', l.party_id, ''documento'', null),
        ''lineas'', jsonb_build_array(
          jsonb_build_object(''cuenta'', c_4009, ''debe'', -v_cancela, ''haber'', 0, ''concepto'', null, ''local_id'', loc, ''comun'', comun,
            ''marca_id'', null, ''tercero_id'', l.party_id, ''documento'', null, ''iva'', null, ''retencion'', null),
          jsonb_build_object(''cuenta'', c_cliente, ''debe'', 0, ''haber'', -v_cancela, ''concepto'', null, ''local_id'', loc, ''comun'', comun,
            ''marca_id'', null, ''tercero_id'', l.party_id, ''documento'', null, ''iva'', null, ''retencion'', null))));
    end if;
    for v_conc in select ''«'' || (x->>''concepto'') || ''» ('' || public.conta_euros_exactos((x->>''importe'')::numeric) || '')'' from jsonb_array_elements(v_aj) x where x->>''queEs'' = ''a_mano'' loop
      ae := ae || to_jsonb(''La transacción trae '' || v_conc || '' y dijiste que la apuntas tú a mano: no va en ningún asiento.'');
    end loop;

    -- 3 · La compensación: su factura se paga con lo que te debe.';
  -- 4 · Los asientos de la 4009 van después de los tres de siempre.
  v_viejo4 constant text := '''documento'', em->>''numero'', ''iva'', null, ''retencion'', null)))));';
  v_nuevo4 constant text := '''documento'', em->>''numero'', ''iva'', null, ''retencion'', null)))) || v_extra);';
  v_v text[] := array[v_viejo1, v_viejo2, v_viejo3, v_viejo4];
  i int;
begin
  if strpos(v_def, 'lineasSocio') > 0 then return; end if;   -- ya pasada
  for i in 1 .. 4 loop
    if (length(v_def) - length(replace(v_def, v_v[i], ''))) / length(v_v[i]) <> 1 then
      raise exception 'S01p·18: conta_propuestas_socio no es la medida (el trozo % no está una sola vez): no se toca.', i;
    end if;
  end loop;
  v_def := replace(v_def, v_viejo1, v_nuevo1);
  v_def := replace(v_def, v_viejo2, v_nuevo2);
  v_def := replace(v_def, v_viejo3, v_nuevo3);
  v_def := replace(v_def, v_viejo4, v_nuevo4);
  execute v_def;
end $do$;
