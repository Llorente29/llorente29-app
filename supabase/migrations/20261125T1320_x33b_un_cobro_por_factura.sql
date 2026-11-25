-- supabase/migrations/20261125T1320_x33b_un_cobro_por_factura.sql
--
-- X33b · Una factura con cobro nunca lleva dos asientos de cobro (Julio, 25/11). Q emite en Sumied las facturas de
-- noviembre de QBO, una por cobro de GoCardless confirmado (Q10). Si el cobro ya lo apuntó Sumied en la factura (el
-- camino del G05 al emitir: customer_invoice_payment con su asiento), «Preparar» no escribe otro: señala el que hay.
-- Y si lo prepara él, deja el cobro apuntado en la factura (conta_venta_cobrar, «GoCardless»), con su asiento, para
-- que ningún otro camino vuelva a cobrarla.
--
-- cambia: public._conta_gc_asientos_plan(uuid,date) · prueba: supabase/staging/sql/20261125_x33b_un_cobro_por_factura_prueba.sql
-- cambia: public.conta_gc_asientos_preparar(uuid,date,text) · prueba: supabase/staging/sql/20261125_x33b_un_cobro_por_factura_prueba.sql
-- cambia: public.conta_gc_asientos_del_mes(uuid,date) · prueba: supabase/staging/sql/20261125_x33b_un_cobro_por_factura_prueba.sql
--
--   · La factura de un cobro es la emitida del mismo cliente, por el mismo importe y del MISMO MES que el cobro (antes:
--     de los dos meses de antes; una factura de octubre que trajo el X14 de ERP10 no puede llevarse el cobro de
--     noviembre). Si hay más de una, primero la que no está cobrada, y la más reciente.
--   · Preparar: si esa factura ya está cobrada en Sumied (lo cobrado más este cobro pasaría de su total), no hay asiento
--     nuevo: la fila apunta al asiento de su cobro (si lo tiene) y lo dice en «nota». Si no, el asiento de siempre
--     (propuesto) y el cobro apuntado en la factura con ese asiento.
--   · conta_gc_asiento lleva la factura (factura_id) y la nota; la pantalla las enseña.
--
-- Con la MISMA firma; respaldo antes, para la vuelta atrás. Añade dos columnas que admiten nulos y una función nueva.
-- Nada en el camino del pedido.

select public._respaldar_funcion('public._conta_gc_asientos_plan(uuid,date)', '20261125T1320_x33b_un_cobro_por_factura');
select public._respaldar_funcion('public.conta_gc_asientos_preparar(uuid,date,text)', '20261125T1320_x33b_un_cobro_por_factura');
select public._respaldar_funcion('public.conta_gc_asientos_del_mes(uuid,date)', '20261125T1320_x33b_un_cobro_por_factura');

alter table public.conta_gc_asiento add column if not exists factura_id uuid references public.customer_invoice(id) on delete set null;
alter table public.conta_gc_asiento add column if not exists nota text;
comment on column public.conta_gc_asiento.factura_id is 'X33b · La factura emitida que cobra este cobro (del mismo cliente, importe y mes).';
comment on column public.conta_gc_asiento.nota is 'X33b · Lo que se dice de la fila sin ser un pendiente (por ejemplo, que la factura ya estaba cobrada en Sumied).';

-- La factura de un cobro: la emitida del cliente, por ese importe, del mismo mes; primero la no cobrada, la más reciente.
create or replace function public._conta_gc_factura_de_cobro(p_company uuid, p_party uuid, p_importe numeric, p_fecha date)
returns table (id uuid, numero text, total numeric, cobrado numeric)
language sql stable security definer set search_path = public as $$
  select ci.id, coalesce(nullif(btrim(ci.number_text), ''), nullif(concat_ws('/', ci.series_code, ci.number::text), '')), ci.total,
         coalesce((select sum(p.amount) from public.customer_invoice_payment p where p.invoice_id = ci.id), 0)
    from public.customer_invoice ci
   where ci.company_id = p_company and ci.party_id = p_party and ci.total = p_importe and ci.status = 'emitida'
     and date_trunc('month', ci.issue_date) = date_trunc('month', p_fecha) and ci.issue_date <= p_fecha
   order by coalesce((select sum(p.amount) from public.customer_invoice_payment p where p.invoice_id = ci.id), 0) + p_importe > ci.total,
            ci.issue_date desc, ci.created_at desc
   limit 1
$$;
revoke all on function public._conta_gc_factura_de_cobro(uuid, uuid, numeric, date) from public, anon, authenticated;

-- El plan: lo mismo que antes, con la factura de cada cobro buscada así.
do $$
declare
  v_def text := pg_get_functiondef('public._conta_gc_asientos_plan(uuid,date)'::regprocedure);
  v_viejo constant text := 'public._conta_gc_factura_del_cobro(p_company, v_x.party_id, v_x.importe, v_x.fecha)';
  v_nuevo constant text := '(select f.numero from public._conta_gc_factura_de_cobro(p_company, v_x.party_id, v_x.importe, v_x.fecha) f)';
  v_n int;
begin
  if strpos(v_def, '_conta_gc_factura_de_cobro') > 0 then return; end if;   -- ya pasada
  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 1 then raise exception 'X33b: _conta_gc_asientos_plan no es la medida (% veces la búsqueda de la factura, y era 1): no se toca.', v_n; end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;

-- Preparar: un cobro por factura.
create or replace function public.conta_gc_asientos_preparar(p_company uuid, p_mes date, p_quien_nombre text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_c public.company;
  v_quien text;
  v_x record;
  v_f record;
  v_ya public.conta_gc_asiento;
  v_r jsonb;
  v_entry uuid;
  v_nota text;
  v_aj public.conta_gestoria_ajustes;
  v_pla text;
  v_preparados int := 0; v_seguian int := 0; v_pendientes int := 0;
begin
  select * into v_c from public.company where id = p_company;
  if v_c.id is null or not public.belongs_to_account(v_c.account_id) then
    raise exception 'Esa empresa no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_of(v_c.account_id) then
    raise exception 'Solo un administrador de la cuenta prepara los asientos de GoCardless.' using errcode = '42501';
  end if;
  if p_mes is null then raise exception 'Falta el mes.' using errcode = '22023'; end if;
  v_quien := nullif(btrim(coalesce(p_quien_nombre, public.conta_nombre_actor(), '')), '');
  select * into v_aj from public.conta_gestoria_ajustes a where a.company_id = v_c.id;
  v_pla := coalesce(nullif(v_aj.cuenta_plataforma, ''), '57200002');
  perform pg_advisory_xact_lock(hashtextextended('conta_gc_asientos:' || v_c.id::text || ':' || to_char(p_mes, 'YYYY-MM'), 0));

  for v_x in select * from public._conta_gc_asientos_plan(v_c.id, p_mes) loop
    select * into v_ya from public.conta_gc_asiento a where a.company_id = v_c.id and a.clase = v_x.clase and a.gc_id = v_x.gc_id for update;
    -- Ya tiene un asiento vivo: no se escribe otro (nada dos veces).
    if v_ya.entry_id is not null and exists (select 1 from public.journal_entry e where e.id = v_ya.entry_id and e.status in ('propuesto', 'borrador', 'validado')) then
      v_seguian := v_seguian + 1; continue;
    end if;
    v_entry := null; v_nota := null; v_f := null;
    if v_x.clase = 'cobro' and v_x.party_id is not null then
      select * into v_f from public._conta_gc_factura_de_cobro(v_c.id, v_x.party_id, v_x.importe, v_x.fecha);
    end if;
    if cardinality(v_x.pendiente) = 0 and v_f.id is not null and v_f.cobrado + v_x.importe > v_f.total then
      -- Una factura con cobro nunca lleva dos asientos de cobro: la fila señala el que ya tiene.
      select p.entry_id into v_entry from public.customer_invoice_payment p
       where p.invoice_id = v_f.id and p.entry_id is not null order by p.paid_on desc, p.created_at desc limit 1;
      v_nota := format('La factura %s ya está cobrada en Sumied: su cobro %s y no se escribe otro.', v_f.numero,
        case when v_entry is null then 'no lleva asiento aquí' else 'ya tiene su asiento' end);
      v_seguian := v_seguian + 1;
    elsif cardinality(v_x.pendiente) = 0 then
      perform public._conta_cobro_cuenta(v_c.id, v_pla, 'Plataforma GoCardless', v_quien);
      if v_x.clase = 'cobro' then perform public._conta_cobro_cuenta(v_c.id, v_x.cuenta, coalesce(v_x.nombre, 'Cliente'), v_quien); end if;
      if v_x.clase = 'ingreso' then perform public._conta_cobro_cuenta(v_c.id, v_x.cuenta, 'Banco', v_quien); end if;
      v_r := public._journal_entry_proponer(v_c.id,
        jsonb_build_object('series', 4, 'fecha', v_x.fecha, 'source_type', 'customer_payment',
          'source_id', md5(v_c.id::text || ':' || v_x.clase || ':' || v_x.gc_id)::uuid, 'concepto', v_x.concepto,
          'party_id', v_x.party_id, 'confianza', 'seguro',
          'porque', case v_x.clase when 'cobro' then 'Cobro de GoCardless (X33).' else 'Ingreso de GoCardless en el banco (X33).' end),
        v_x.lineas, null, v_quien, auth.uid());
      v_entry := (v_r->>'id')::uuid;
      -- El cobro, apuntado en su factura con este asiento: ningún otro camino la vuelve a cobrar.
      if v_f.id is not null then
        perform public.conta_venta_cobrar(v_f.id, v_x.fecha, v_x.importe, 'GoCardless', 'GoCardless ' || v_x.gc_id, v_quien);
        update public.customer_invoice_payment p set entry_id = v_entry
         where p.invoice_id = v_f.id and p.note = 'GoCardless ' || v_x.gc_id and p.entry_id is null;
      end if;
      v_preparados := v_preparados + 1;
    else
      v_pendientes := v_pendientes + 1;
    end if;
    insert into public.conta_gc_asiento (company_id, account_id, clase, gc_id, fecha, importe, nombre, cuenta, concepto, entry_id, pendiente,
                                         preparado_en, preparado_por_nombre, factura_id, nota)
    values (v_c.id, v_c.account_id, v_x.clase, v_x.gc_id, v_x.fecha, v_x.importe, v_x.nombre, v_x.cuenta, v_x.concepto, v_entry, v_x.pendiente,
            now(), v_quien, v_f.id, v_nota)
    on conflict (company_id, clase, gc_id) do update set fecha = excluded.fecha, importe = excluded.importe, nombre = excluded.nombre,
      cuenta = excluded.cuenta, concepto = excluded.concepto, entry_id = excluded.entry_id, pendiente = excluded.pendiente,
      preparado_en = excluded.preparado_en, preparado_por_nombre = excluded.preparado_por_nombre,
      factura_id = excluded.factura_id, nota = excluded.nota;
  end loop;

  return jsonb_build_object('preparados', v_preparados, 'ya_estaban', v_seguian, 'pendientes', v_pendientes,
    'texto', format('%s preparados · %s ya estaban · %s en «Pendiente de revisar».', v_preparados, v_seguian, v_pendientes));
end $$;

-- Lo preparado del mes: con la nota de cada fila.
do $$
declare
  v_def text := pg_get_functiondef('public.conta_gc_asientos_del_mes(uuid,date)'::regprocedure);
  v_viejo constant text := '''pendiente'', to_jsonb(a.pendiente), ''entry_id'', a.entry_id,';
  v_nuevo constant text := '''pendiente'', to_jsonb(a.pendiente), ''entry_id'', a.entry_id, ''nota'', a.nota, ''factura_id'', a.factura_id,';
  v_n int;
begin
  if strpos(v_def, '''nota'', a.nota') > 0 then return; end if;   -- ya pasada
  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 1 then raise exception 'X33b: conta_gc_asientos_del_mes no es la medida (% veces, y era 1): no se toca.', v_n; end if;
  execute replace(v_def, v_viejo, v_nuevo);
end $$;
