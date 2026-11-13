-- supabase/migrations/20261113T1822_s01p_liquidacion_repetida.sql
--
-- S01p·21 · Una liquidación de IVA apuntada dos veces en un trimestre presentado (Julio, 13/11).
-- En Foodint, la del 1T de 2026 está en 4/1016 y en 9/2, y la del 2T en 4/1194 y en 9/3: las
-- cuatro traídas de Diez, cada pareja con los mismos apuntes. Anular la que sobra no se puede:
--   · lo traído de Diez no se anula en Sumied (_tg_s01p_traido_no_se_anula, de la 0830), y
--   · su contraasiento lleva 472 y 477 sin tipo ni libro, y la regla 5 lo para.
-- Y conta_impuesto_303_contabilizar, con el 303 sin su liquidación enlazada, haría una tercera.
--
-- El camino (la pista de D): «Dejar solo esta», en Impuestos › Trimestre.
--   1. El 303 del trimestre queda enlazado con la buena (tax_return.liquidation_entry_id): así
--      conta_impuesto_303_contabilizar dice «ya estaba» y no hace otra.
--   2. La que sobra queda registrada como repetida de la buena (conta_liquidacion_repetida).
--   3. Su contraasiento, en el primer día abierto después del trimestre (en Foodint, el 01/10):
--      un asiento NUEVO de Sumied que la deja sin efecto, sin tocar la traída (sigue como la
--      trajo Diez). Es un cierre de cuentas repetido: sus apuntes van sin tipo ni libro, como
--      los de la liquidación, y no toca ningún libro de IVA.
--   4. La regla 5 admite ese contraasiento, y SOLO ese: el que anula una liquidación registrada
--      como repetida (igual que ya admite el de una liquidación del 303, v_liquidacion de la 0180).
--   5. Ese contraasiento no cuenta como IVA del periodo en que cae: ni en el cálculo del 303, ni
--      al contabilizarlo, ni en el bloque de IVA del cierre del mes (como ya no cuentan las
--      liquidaciones).
--
-- AÑADE: conta_liquidacion_repetida (tabla), conta_liquidaciones_repetidas (lo que enseña la
-- pantalla) y conta_liquidacion_dejar_esta (el botón).
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261113_s01p_liquidacion_repetida_prueba.sql
-- cambia: public.conta_impuesto_303_calcular · prueba: supabase/staging/sql/20261113_s01p_liquidacion_repetida_prueba.sql
-- cambia: public.conta_impuesto_303_contabilizar · prueba: supabase/staging/sql/20261113_s01p_liquidacion_repetida_prueba.sql
-- cambia: public.conta_cierre_bloque_iva · prueba: supabase/staging/sql/20261113_s01p_liquidacion_repetida_prueba.sql
--   Las cuatro, con la MISMA firma y el cuerpo vigente con un solo trozo cambiado (reemplazo
--   exacto: si el trozo no está una sola vez, no se toca nada). Respaldo antes, para la vuelta atrás.
--
-- Nada en el camino del pedido.

create table if not exists public.conta_liquidacion_repetida (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  company_id uuid not null references public.company(id) on delete cascade,
  tax_return_id uuid not null references public.tax_return(id) on delete cascade,
  buena_entry_id uuid not null references public.journal_entry(id),
  repetida_entry_id uuid not null references public.journal_entry(id),
  contraasiento_id uuid references public.journal_entry(id),
  created_at timestamptz not null default now(),
  created_by uuid,
  created_by_name text,
  check (buena_entry_id <> repetida_entry_id)
);
create unique index if not exists conta_liquidacion_repetida_uq on public.conta_liquidacion_repetida (repetida_entry_id);
alter table public.conta_liquidacion_repetida enable row level security;
drop policy if exists conta_liquidacion_repetida_leer on public.conta_liquidacion_repetida;
create policy conta_liquidacion_repetida_leer on public.conta_liquidacion_repetida for select to authenticated
  using (public.belongs_to_account(account_id));
comment on table public.conta_liquidacion_repetida is
  'S01p·21. Una liquidación de IVA apuntada dos veces: cuál es la repetida, cuál la buena y el contraasiento que la deja sin efecto.';

select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261113T1822_s01p_liquidacion_repetida');
select public._respaldar_funcion('public.conta_impuesto_303_calcular(uuid,integer,text)', '20261113T1822_s01p_liquidacion_repetida');
select public._respaldar_funcion('public.conta_impuesto_303_contabilizar(uuid)', '20261113T1822_s01p_liquidacion_repetida');
select public._respaldar_funcion('public.conta_cierre_bloque_iva(uuid,date)', '20261113T1822_s01p_liquidacion_repetida');

-- La regla 5 (y la 10): el contraasiento de una liquidación registrada como repetida se libra
-- de las reglas de IVA, como el de la liquidación de un 303.
do $do$
declare
  v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure);
  v_viejo text := $viejo$         and o.source_type = 'vat_settlement'
         and t.form_code = '303');
$viejo$;
  v_nuevo text := $nuevo$         and o.source_type = 'vat_settlement'
         and t.form_code = '303')
      -- S01p·21: o el contraasiento de una liquidación apuntada dos veces, registrada como repetida.
      or (v_e.source_type = 'reversal' and exists (
            select 1 from public.conta_liquidacion_repetida rr
             where rr.repetida_entry_id = v_e.reverses_entry_id and rr.company_id = v_e.company_id));
$nuevo$;
begin
  if strpos(v_def, 'public.conta_liquidacion_repetida rr') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'S01p·21: conta_motivos_para_validar no es la medida (el trozo de v_liquidacion no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

-- El cálculo y la contabilización del 303: ese contraasiento no es IVA del periodo en que cae.
do $do$
declare
  v_firma text; v_def text;
  v_viejo text := $viejo$and je.source_type not in ('vat_settlement', 'opening', 'closing')$viejo$;
  v_nuevo text := $nuevo$and je.source_type not in ('vat_settlement', 'opening', 'closing') and not exists (select 1 from public.conta_liquidacion_repetida rr where rr.repetida_entry_id = je.reverses_entry_id)$nuevo$;
begin
  foreach v_firma in array array['public.conta_impuesto_303_calcular(uuid,integer,text)', 'public.conta_impuesto_303_contabilizar(uuid)'] loop
    v_def := pg_get_functiondef(v_firma::regprocedure);
    if strpos(v_def, 'public.conta_liquidacion_repetida rr') > 0 then continue; end if;   -- ya pasada
    if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
      raise exception 'S01p·21: % no es la medida (el filtro de las liquidaciones no está una sola vez): no se toca.', v_firma;
    end if;
    execute replace(v_def, v_viejo, v_nuevo);
  end loop;
end $do$;

-- El bloque de IVA del cierre del mes: lo mismo.
do $do$
declare
  v_def text := pg_get_functiondef('public.conta_cierre_bloque_iva(uuid,date)'::regprocedure);
  v_viejo text := $viejo$and e.source_type <> 'vat_settlement'$viejo$;
  v_nuevo text := $nuevo$and e.source_type <> 'vat_settlement' and not exists (select 1 from public.conta_liquidacion_repetida rr where rr.repetida_entry_id = e.reverses_entry_id)$nuevo$;
begin
  if strpos(v_def, 'public.conta_liquidacion_repetida rr') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo) <> 1 then
    raise exception 'S01p·21: conta_cierre_bloque_iva no es la medida (el filtro de las liquidaciones no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $do$;

-- Lo que enseña la pantalla: las liquidaciones del trimestre de un 303 apuntadas más de una vez
-- (validadas, en el último día del trimestre, solo con 472/477/4700/4750, con los mismos apuntes),
-- cuál es la enlazada, cuál quedó como repetida y su contraasiento. Vacío si no hay ninguna repetida.
create or replace function public.conta_liquidaciones_repetidas(p_return uuid)
returns table (asiento uuid, serie int, numero int, fecha date, concepto text, importe numeric, traida boolean,
               enlazada boolean, repetida boolean, contraasiento uuid, contra_serie int, contra_numero int, contra_fecha date)
language plpgsql stable security definer set search_path = public as $$
declare r public.tax_return; v_desde date; v_hasta date;
begin
  select * into r from public.tax_return where id = p_return;
  if r.id is null or not public.belongs_to_account(r.account_id) then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if r.form_code <> '303' then return; end if;
  select x.desde, x.hasta into v_desde, v_hasta from public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period) x;
  return query
  with liq as (
    select e.id, e.series, e.number, e.entry_date, e.concept, e.source_type,
           md5(string_agg(ca.code || ':' || l.debit || ':' || l.credit, '|' order by ca.code, l.debit, l.credit)) huella,
           sum(l.debit) filter (where ca.template_code like '477%') i477,
           bool_and(ca.template_code like '472%' or ca.template_code like '477%' or ca.template_code in ('4700', '4750')) solo_iva,
           bool_or(ca.template_code like '472%') hay472, bool_or(ca.template_code like '477%') hay477
      from public.journal_entry e
      join public.journal_line l on l.entry_id = e.id
      join public.company_account ca on ca.id = l.company_account_id
     where e.account_id = r.account_id and e.company_id = r.company_id and e.status = 'validado'
       and e.entry_date = v_hasta and e.source_type <> 'reversal'
     group by e.id),
  rep as (select huella from liq where solo_iva and hay472 and hay477 group by huella having count(*) > 1)
  select liq.id, liq.series::int, liq.number::int, liq.entry_date, liq.concept, coalesce(liq.i477, 0)::numeric, liq.source_type = 'migrated',
         liq.id = r.liquidation_entry_id, rr.id is not null, c.id, c.series::int, c.number::int, c.entry_date
    from liq join rep on rep.huella = liq.huella
    left join public.conta_liquidacion_repetida rr on rr.repetida_entry_id = liq.id
    left join public.journal_entry c on c.id = rr.contraasiento_id
   order by liq.series, liq.number;
end $$;
revoke all on function public.conta_liquidaciones_repetidas(uuid) from public, anon;
grant execute on function public.conta_liquidaciones_repetidas(uuid) to authenticated;
comment on function public.conta_liquidaciones_repetidas(uuid) is
  'S01p·21. Las liquidaciones del trimestre de un 303 apuntadas más de una vez, con cuál es la enlazada y el contraasiento de la repetida.';

-- «Dejar solo esta»: el 303 queda enlazado con ESTA, y cada otra con sus mismos apuntes queda
-- registrada como repetida y sin efecto con su contraasiento, en el primer día abierto después
-- del trimestre. Dice qué asiento ha creado y con qué fecha.
create or replace function public.conta_liquidacion_dejar_esta(p_return uuid, p_buena uuid, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.tax_return; v_hasta date; v_fecha date; v_y uuid; v_quien text; v_buena public.journal_entry; v_e public.journal_entry;
  v_nuevo uuid; v_val jsonb; v_hechos text[] := '{}'; v_estado text; v_trim text;
begin
  select * into r from public.tax_return where id = p_return for update;
  if r.id is null then raise exception 'Esa declaración no está.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_of(r.account_id) then
    raise exception 'Solo un administrador de la cuenta deja sin efecto una liquidación.' using errcode = '42501';
  end if;
  if r.form_code <> '303' then raise exception 'Esto es para la liquidación de un 303.' using errcode = '22023'; end if;
  if r.status not in ('filed', 'booked', 'offset', 'paid', 'refunded') then
    raise exception 'Este 303 está «%»: primero se presenta.', public.conta_impuesto_estado_texto(r.status) using errcode = '22023';
  end if;
  if not exists (select 1 from public.conta_liquidaciones_repetidas(p_return) x where x.asiento = p_buena) then
    raise exception 'Ese asiento no es una de las liquidaciones repetidas de este trimestre.' using errcode = '22023';
  end if;
  if r.liquidation_entry_id is not null and r.liquidation_entry_id <> p_buena
     and exists (select 1 from public.journal_entry e where e.id = r.liquidation_entry_id and e.status = 'validado') then
    raise exception 'Este 303 ya está enlazado con otra liquidación: no lo cambio.' using errcode = '23514';
  end if;
  select * into v_buena from public.journal_entry where id = p_buena;
  v_quien := coalesce(p_quien_nombre, public.conta_nombre_actor());
  v_trim := 'del ' || r.period || ' de ' || r.fiscal_year;
  select x.hasta into v_hasta from public.conta_impuesto_periodo_fechas(r.fiscal_year, r.period) x;
  v_fecha := public.conta_primer_dia_abierto(r.company_id, v_hasta + 1);
  if v_fecha is null then raise exception 'No hay ningún día abierto después del % para el contraasiento.', to_char(v_hasta, 'DD/MM/YYYY') using errcode = '23514'; end if;
  select id into v_y from public.fiscal_year where company_id = r.company_id and v_fecha between starts_on and ends_on;
  if v_y is null then raise exception 'No hay ejercicio para el %.', to_char(v_fecha, 'DD/MM/YYYY') using errcode = '23514'; end if;

  -- 1 · El 303 con su liquidación buena (como lo deja conta_impuesto_303_contabilizar).
  v_estado := case when r.status = 'filed' and r.result_kind = 'to_offset' then 'offset' when r.status = 'filed' then 'booked' else r.status end;
  update public.tax_return set status = v_estado, liquidation_entry_id = p_buena, updated_at = now() where id = r.id;

  -- 2 y 3 · Cada repetida (aún sin registrar): registrada, y su contraasiento.
  for v_e in
    select e.* from public.conta_liquidaciones_repetidas(p_return) x join public.journal_entry e on e.id = x.asiento
     where x.asiento <> p_buena and not x.repetida
  loop
    insert into public.conta_liquidacion_repetida (account_id, company_id, tax_return_id, buena_entry_id, repetida_entry_id, created_by, created_by_name)
    values (r.account_id, r.company_id, r.id, p_buena, v_e.id, auth.uid(), v_quien);
    insert into public.journal_entry (account_id, company_id, fiscal_year_id, series, entry_date, concept, source_type, source_id,
                                      status, party_id, document_ref, document_date, reverses_entry_id, created_by, created_by_name)
    values (v_e.account_id, v_e.company_id, v_y, v_e.series, v_fecha,
            format('Anula %s/%s: liquidación de IVA %s apuntada dos veces (se deja la %s/%s)', v_e.series, v_e.number, v_trim, v_buena.series, v_buena.number),
            'reversal', v_e.id, 'borrador', v_e.party_id, v_e.document_ref, v_e.document_date, v_e.id, auth.uid(), v_quien)
    returning id into v_nuevo;
    insert into public.journal_line (account_id, company_id, entry_id, position, company_account_id, debit, credit, concept,
                                     location_id, is_common, brand_id, party_id, document_ref, document_date,
                                     tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model)
    -- Los apuntes, al revés, como los copia journal_entry_anular (los de una liquidación no llevan tipo ni libro).
    select account_id, company_id, v_nuevo, position, company_account_id, credit, debit, concept,
           location_id, is_common, brand_id, party_id, document_ref, document_date,
           tax_rate_id, tax_base, vat_book, vat_deductible, tax_documents, withholding_rate_id, withholding_base, withholding_model
      from public.journal_line where entry_id = v_e.id;
    v_val := public.journal_entry_validar(v_nuevo, v_quien);
    update public.conta_liquidacion_repetida set contraasiento_id = v_nuevo where repetida_entry_id = v_e.id;
    v_hechos := v_hechos || format('la %s/%s queda sin efecto con el contraasiento %s/%s del %s', v_e.series, v_e.number,
                                   v_val->>'serie', v_val->>'numero', to_char(v_fecha, 'DD/MM/YYYY'));
  end loop;

  insert into public.tax_return_event (tax_return_id, account_id, company_id, by_user, by_name, kind, message, detail)
  values (r.id, r.account_id, r.company_id, auth.uid(), v_quien, 'note',
          format('Liquidación apuntada dos veces: se deja la %s/%s%s.', v_buena.series, v_buena.number,
                 case when cardinality(v_hechos) > 0 then '; ' || array_to_string(v_hechos, '; ') else '' end),
          jsonb_build_object('buena', p_buena, 'fecha', v_fecha));
  return jsonb_build_object('ok', true, 'buena', p_buena, 'fecha', v_fecha,
    'mensaje', format('Se deja la liquidación %s/%s%s. Ningún libro de IVA cambia.', v_buena.series, v_buena.number,
                      case when cardinality(v_hechos) > 0 then ': ' || array_to_string(v_hechos, '; ') else ' (las demás ya estaban sin efecto)' end));
end $$;
revoke all on function public.conta_liquidacion_dejar_esta(uuid, uuid, text) from public, anon;
grant execute on function public.conta_liquidacion_dejar_esta(uuid, uuid, text) to authenticated;
comment on function public.conta_liquidacion_dejar_esta(uuid, uuid, text) is
  'S01p·21. «Dejar solo esta»: el 303 enlazado con esta liquidación y cada repetida sin efecto con su contraasiento, en el primer día abierto después del trimestre.';
