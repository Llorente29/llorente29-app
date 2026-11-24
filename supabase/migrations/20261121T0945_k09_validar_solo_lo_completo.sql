-- supabase/migrations/20261121T0945_k09_validar_solo_lo_completo.sql
--
-- K09 · Nunca se valida una recibida incompleta ni repetida, y lo impide la base
-- (Julio, 21/11: «no debería nunca dejar validar si falta algún dato
-- obligatorio, o que exista ese número de factura, para evitar duplicar»).
--
-- Hasta hoy la base, al validar, miraba el asiento (dos apuntes, que cuadre,
-- ejercicio y mes abiertos, histórico traído, IVA y retención, permiso) y, desde
-- la S01q (02/11, tg_journal_entry_factura_una_vez), que su número no esté ya en
-- otro asiento vivo del mismo proveedor: con cualquier separador, pero no con
-- ceros a la izquierda («K09-001» y «K09-1»), y con «No es repetida» de salida
-- (not_duplicate_confirmed_at), sin motivo escrito. No miraba los datos de la
-- factura. Esta lo completa, sin tocar la S01q.
--
-- cambia: public.conta_motivos_para_validar · prueba: supabase/staging/sql/20261121_k09_validar_solo_lo_completo_prueba.sql
--   Con la MISMA firma y el cuerpo vigente con un solo trozo añadido, delante del
--   bloque C06b: en un asiento de una recibida, devuelve además los motivos de la
--   factura (conta_recibida_motivos). Respaldo antes, para la vuelta atrás.
-- cambia: public.supplier_invoice_change · prueba: supabase/staging/sql/20261121_k09_validar_solo_lo_completo_prueba.sql
--   Su CHECK de «what» solo AMPLÍA: además de guardar, papel y sin_papel, «no_es_la_misma».
--   La vuelta atrás lo devuelve como estaba solo si no hay ninguna fila con el valor nuevo.
--
-- Añade:
--   · _conta_numero_clave(n): el número sin mayúsculas, espacios, guiones, barras
--     ni puntos, y sin ceros a la izquierda de cada tramo (la misma regla que
--     normaNumero de la pantalla, documentos/paraValidar.ts);
--   · supplier_invoice_no_es_la_misma: «No es la misma: …», la confirmación
--     escrita de que una recibida no es la otra con su número (quién, cuándo y
--     por qué), y conta_recibida_no_es_la_misma, que la guarda y la deja en el
--     historial de la factura (supplier_invoice_change);
--   · conta_recibida_repetida(factura): la otra, ya contabilizada, del mismo
--     proveedor (o del mismo NIF) en la misma empresa y con el mismo número,
--     también con ceros a la izquierda; para que la pantalla la nombre y la abra.
--     Sin ella si ya se dijo «No es la misma» o «No es repetida»;
--   · conta_recibida_motivos(factura): lo que impide validarla, cada cosa con
--     su frase: el proveedor y su subcuenta, el número, la fecha, una base con
--     su tipo, la cuenta de gasto, que base + cuotas − retención sea el total, y
--     la repetida (salvo «No es la misma»).
--
-- No toca ninguna fila al aplicarse: las recibidas ya validadas se quedan como
-- están (las que incumplen se cuentan en el ensayo, para que Julio decida).
-- Nada en el camino del pedido: ningún pedido escribe recibidas ni las valida.
-- Vuelta atrás: supabase/vuelta-atras/20261121T0945_k09_validar_solo_lo_completo.down.sql

create or replace function public._conta_numero_clave(p text)
returns text language sql immutable as $$
  select nullif(string_agg(regexp_replace(t, '(^|[^0-9])0+([0-9])', '\1\2', 'g'), '' order by o), '')
    from regexp_split_to_table(upper(coalesce(p, '')), '[\s\-_./\\]+') with ordinality as x(t, o)
$$;
comment on function public._conta_numero_clave(text) is
  'K09 · El número de una factura para compararlo: sin mayúsculas, espacios, guiones, barras ni puntos, y sin ceros a la izquierda de cada tramo («F-0012/26» = «F1226»). La misma regla que normaNumero de la pantalla.';

create table if not exists public.supplier_invoice_no_es_la_misma (
  supplier_invoice_id uuid not null references public.supplier_invoice(id) on delete cascade,
  otra_id uuid not null references public.supplier_invoice(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  motivo text not null check (length(trim(motivo)) > 0),
  by_user uuid,
  by_name text,
  at timestamptz not null default now(),
  primary key (supplier_invoice_id, otra_id)
);
comment on table public.supplier_invoice_no_es_la_misma is
  'K09 · «No es la misma: …»: una persona dijo, por escrito, que esta recibida no es la otra con su número (un proveedor que repite número en otro ejercicio…). Con ella, se valida igual. Lo escribe conta_recibida_no_es_la_misma.';
alter table public.supplier_invoice_no_es_la_misma enable row level security;
revoke all on table public.supplier_invoice_no_es_la_misma from public, anon, authenticated;
grant select on table public.supplier_invoice_no_es_la_misma to authenticated;
drop policy if exists supplier_invoice_no_es_la_misma_leer on public.supplier_invoice_no_es_la_misma;
create policy supplier_invoice_no_es_la_misma_leer on public.supplier_invoice_no_es_la_misma for select
  using (account_id = any (public.current_user_account_ids()));

create or replace function public.conta_recibida_repetida(p_invoice uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_nif text;
  v_r record;
begin
  select * into v_f from public.supplier_invoice where id = p_invoice;
  if v_f.id is null or (auth.uid() is not null and not public.belongs_to_account(v_f.account_id)) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  if public._conta_numero_clave(v_f.invoice_number) is null then return null; end if;
  select public._conta_nif_clave(s.tax_id) into v_nif from public.supplier s where s.id = v_f.supplier_id and s.account_id = v_f.account_id;
  select o.id, o.invoice_number, coalesce(s.name, o.issuer_name, 'su proveedor') as proveedor, e.series, e.number
    into v_r
    from public.supplier_invoice o
    join public.journal_entry e on e.account_id = o.account_id and e.source_type = 'supplier_invoice' and e.source_id = o.id and e.status = 'validado'
    left join public.supplier s on s.id = o.supplier_id and s.account_id = o.account_id
   where o.account_id = v_f.account_id and o.company_id is not distinct from v_f.company_id and o.id <> v_f.id
     and o.status not in ('anulada', 'descartada')
     and public._conta_numero_clave(o.invoice_number) = public._conta_numero_clave(v_f.invoice_number)
     and ((v_f.supplier_id is not null and o.supplier_id = v_f.supplier_id)
          or (v_nif is not null and public._conta_nif_clave(s.tax_id) = v_nif))
     and not exists (select 1 from public.supplier_invoice_no_es_la_misma m where m.supplier_invoice_id = v_f.id and m.otra_id = o.id)
     -- La confirmación de siempre («No es repetida», C01b), la de antes de esta: también vale.
     and v_f.not_duplicate_confirmed_at is null
   order by e.validated_at nulls last, o.id
   limit 1;
  if v_r.id is null then return null; end if;
  return jsonb_build_object('id', v_r.id, 'numero', v_r.invoice_number, 'proveedor', v_r.proveedor,
    'asiento', v_r.series || '/' || coalesce(v_r.number::text, '—'),
    'texto', format('Ya está la %s de %s, asiento %s.', v_r.invoice_number, v_r.proveedor, v_r.series || '/' || coalesce(v_r.number::text, '—')));
end $$;
comment on function public.conta_recibida_repetida(uuid) is
  'K09 · La otra recibida, ya contabilizada, del mismo proveedor (o del mismo NIF) en la misma empresa y con el mismo número (_conta_numero_clave), salvo «No es la misma». Null si no la hay. Solo lee.';
revoke all on function public.conta_recibida_repetida(uuid) from public, anon;
grant execute on function public.conta_recibida_repetida(uuid) to authenticated, service_role;

alter table public.supplier_invoice_change drop constraint if exists supplier_invoice_change_what_check;
alter table public.supplier_invoice_change add constraint supplier_invoice_change_what_check
  check (what = any (array['guardar', 'papel', 'sin_papel', 'no_es_la_misma']));

create or replace function public.conta_recibida_no_es_la_misma(p_invoice uuid, p_otra uuid, p_motivo text, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_o public.supplier_invoice;
  v_quien text := coalesce(nullif(trim(p_quien_nombre), ''), public.conta_nombre_actor(), 'una persona');
  v_motivo text := nullif(trim(p_motivo), '');
begin
  select * into v_f from public.supplier_invoice where id = p_invoice for update;
  if v_f.id is null or not public.belongs_to_account(v_f.account_id) then
    raise exception 'Esa factura no es de tu cuenta.' using errcode = '42501';
  end if;
  select * into v_o from public.supplier_invoice where id = p_otra and account_id = v_f.account_id;
  if v_o.id is null then raise exception 'La otra factura no está.' using errcode = 'P0002'; end if;
  if v_motivo is null then raise exception 'Para decir que no es la misma, di por qué.' using errcode = '22023'; end if;
  insert into public.supplier_invoice_no_es_la_misma (supplier_invoice_id, otra_id, account_id, motivo, by_user, by_name)
  values (v_f.id, v_o.id, v_f.account_id, v_motivo, auth.uid(), v_quien)
  on conflict (supplier_invoice_id, otra_id) do update set motivo = excluded.motivo, by_user = excluded.by_user, by_name = excluded.by_name, at = now();
  -- Y la confirmación de siempre (C01b), para que la regla S01q (tg_journal_entry_factura_una_vez) la deje pasar.
  update public.supplier_invoice
     set not_duplicate_confirmed_at = now(), not_duplicate_confirmed_by = auth.uid(), not_duplicate_confirmed_by_name = v_quien
   where id = v_f.id;
  insert into public.supplier_invoice_change (account_id, supplier_invoice_id, by_name, what, cambios)
  values (v_f.account_id, v_f.id, v_quien, 'no_es_la_misma',
          jsonb_build_array(jsonb_build_object('campo', 'no_es_la_misma', 'otra', v_o.id, 'numero', v_o.invoice_number, 'motivo', v_motivo)));
  return jsonb_build_object('texto', format('Anotado: no es la misma que la %s («%s»). Ya se puede validar.', v_o.invoice_number, v_motivo));
end $$;
comment on function public.conta_recibida_no_es_la_misma(uuid, uuid, text, text) is
  'K09 · «No es la misma: …»: guarda por escrito que esta recibida no es la otra con su número, y lo deja en su historial. Con ella, conta_recibida_motivos no la para por repetida.';
revoke all on function public.conta_recibida_no_es_la_misma(uuid, uuid, text, text) from public, anon;
grant execute on function public.conta_recibida_no_es_la_misma(uuid, uuid, text, text) to authenticated;

create or replace function public.conta_recibida_motivos(p_invoice uuid, p_entry uuid default null)
returns table (orden int, codigo text, motivo text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_f public.supplier_invoice;
  v_bases int;
  v_gasto int;
  v_ret numeric;
  v_rep jsonb;
begin
  select * into v_f from public.supplier_invoice where id = p_invoice;
  if v_f.id is null then return; end if;
  if v_f.supplier_id is null then
    orden := 20; codigo := 'falta_proveedor'; motivo := 'Falta el proveedor.'; return next;
  elsif not exists (select 1 from public.company_account_link k
                     where k.account_id = v_f.account_id and k.company_id = v_f.company_id and k.entity = 'supplier'
                       and k.entity_id = v_f.supplier_id::text and k.role = 'principal') then
    orden := 20; codigo := 'falta_subcuenta'; motivo := 'Falta la cuenta del proveedor (su subcuenta).'; return next;
  end if;
  if nullif(trim(coalesce(v_f.invoice_number, '')), '') is null then
    orden := 21; codigo := 'falta_numero'; motivo := 'Falta el número de la factura.'; return next;
  end if;
  if v_f.invoice_date is null then
    orden := 22; codigo := 'falta_fecha'; motivo := 'Falta la fecha de la factura.'; return next;
  end if;
  -- Una base con su tipo: en el desglose de la factura, o en el asiento (sus apuntes de IVA llevan base y tipo).
  select count(*) into v_bases from public.supplier_invoice_tax t
   where t.supplier_invoice_id = v_f.id and t.base is not null and t.vat_pct is not null;
  if v_bases = 0 and p_entry is not null then
    select count(*) into v_bases from public.journal_line l where l.entry_id = p_entry and l.tax_rate_id is not null and l.tax_base is not null;
  end if;
  if v_bases = 0 then
    orden := 23; codigo := 'falta_base'; motivo := 'Falta la base con su tipo de IVA.'; return next;
  end if;
  -- La cuenta de gasto: en el asiento, un apunte que no sea del proveedor ni de impuestos (grupo 4).
  if p_entry is not null then
    select count(*) into v_gasto from public.journal_line l join public.company_account a on a.id = l.company_account_id
     where l.entry_id = p_entry and a.code !~ '^4';
    if v_gasto = 0 then
      orden := 24; codigo := 'falta_gasto'; motivo := 'Falta la cuenta de gasto.'; return next;
    end if;
  end if;
  -- Base + cuotas − retención = total (con o sin el recargo de equivalencia, según cómo vino).
  v_ret := coalesce(v_f.withholding_amount, 0);
  if v_f.grand_total is not null and v_f.tax_base_total is not null
     and abs(v_f.grand_total - (v_f.tax_base_total + coalesce(v_f.tax_total, 0) - v_ret)) > 0.01
     and abs(v_f.grand_total - (v_f.tax_base_total + coalesce(v_f.tax_total, 0) + coalesce(v_f.surcharge_total, 0) - v_ret)) > 0.01 then
    orden := 25; codigo := 'no_suma';
    motivo := format('No cuadra: base + cuotas − retención es %s y el total de la factura, %s.',
      public.conta_impuesto_euros(v_f.tax_base_total + coalesce(v_f.tax_total, 0) - v_ret), public.conta_impuesto_euros(v_f.grand_total)); return next;
  end if;
  v_rep := public.conta_recibida_repetida(v_f.id);
  if v_rep is not null then
    orden := 26; codigo := 'repetida';
    motivo := (v_rep->>'texto') || ' Si no es la misma, dilo en «No es la misma» y se valida.'; return next;
  end if;
end $$;
comment on function public.conta_recibida_motivos(uuid, uuid) is
  'K09 · Lo que impide validar una recibida, cada cosa con su frase: el proveedor y su subcuenta, el número, la fecha, una base con su tipo, la cuenta de gasto (en su asiento), que base + cuotas − retención sea el total y la repetida. Solo lee. La llama conta_motivos_para_validar.';
revoke all on function public.conta_recibida_motivos(uuid, uuid) from public, anon;
grant execute on function public.conta_recibida_motivos(uuid, uuid) to authenticated, service_role;

-- El trozo que se añade a conta_motivos_para_validar, delante del bloque C06b.
select public._respaldar_funcion('public.conta_motivos_para_validar(uuid)', '20261121T0945_k09_validar_solo_lo_completo');

do $do$
declare
  v_def text := pg_get_functiondef('public.conta_motivos_para_validar(uuid)'::regprocedure);
  v_ancla text := $ancla$  -- C06b (#210): un asiento de ventas del día con un envío por aclarar.$ancla$;
  v_nuevo text := $nuevo$  -- K09: una recibida, completa y no repetida (conta_recibida_motivos).
  if v_e.source_type = 'supplier_invoice' and v_e.source_id is not null then
    return query select m.orden, m.codigo, m.motivo from public.conta_recibida_motivos(v_e.source_id, v_e.id) m;
  end if;

$nuevo$;
begin
  if strpos(v_def, 'K09: una recibida, completa y no repetida') > 0 then return; end if;   -- ya pasada
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'K09: conta_motivos_para_validar no es la medida (el bloque C06b no está una sola vez): no se toca.';
  end if;
  execute replace(v_def, v_ancla, v_nuevo || v_ancla);
end $do$;
