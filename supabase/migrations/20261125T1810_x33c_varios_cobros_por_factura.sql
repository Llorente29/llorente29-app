-- supabase/migrations/20261125T1810_x33c_varios_cobros_por_factura.sql
--
-- X33c · Una factura por cliente y mes, con todos sus cobros del mes (Julio, 25/11: a un cliente, una factura con 6
-- cobros). Las facturas las emite Cegid y Sumied las lee; las ata Q a sus cobros en conta_gc_cobro_factura.
--
--   · conta_gc_cobro_factura: fuera el UNIQUE (invoice_id). Un cobro va a una sola factura (la clave sigue siendo la
--     empresa y el cobro); una factura puede tener varios cobros. Un índice normal por la factura, para leerla.
--   · conta_gc_asientos_preparar, cobro a cobro:
--       - este cobro ya apuntado en su factura (por «Preparar», o por el G05: «Domiciliación SEPA <cobro>»): no se
--         escribe otro asiento; la fila señala el que tiene;
--       - si cabe (lo cobrado de la factura más este no pasa de su total): su propio asiento, y el cobro apuntado en la
--         factura con él. La factura queda cobrada cuando la suma de sus cobros llega a su total, no con el primero;
--       - si pasa de su total: «Pendiente de revisar», con su motivo. No se salta en silencio.
--
-- destruye: quita la restricción única conta_gc_cobro_factura_invoice_id_key (la tabla tiene 0 filas en producción el
--   25/11; ninguna fila deja de cumplir nada: se permite más, no menos). Por eso pide autorizo.
-- cambia: public.conta_gc_asientos_preparar(uuid,date,text) · prueba: supabase/staging/sql/20261125_x33c_varios_cobros_por_factura_prueba.sql
--
-- Con la MISMA firma; respaldo antes, para la vuelta atrás. No escribe en ninguna fila. Nada en el camino del pedido.

select public._respaldar_funcion('public.conta_gc_asientos_preparar(uuid,date,text)', '20261125T1810_x33c_varios_cobros_por_factura');

alter table public.conta_gc_cobro_factura drop constraint if exists conta_gc_cobro_factura_invoice_id_key;
create index if not exists conta_gc_cobro_factura_factura on public.conta_gc_cobro_factura (invoice_id);
comment on table public.conta_gc_cobro_factura is
  'X33b/X33c · La factura de cada cobro de GoCardless: un cobro, una factura; una factura (por cliente y mes), varios cobros. La escriben las facturas de las cuotas (Q); la lee «Preparar» los asientos de GoCardless.';

-- Preparar: un asiento por cobro; la factura, cobrada cuando sus cobros llegan a su total.
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
  v_pend text[];
  v_ya_pago uuid;
  v_ya_hay boolean;
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
      select * into v_f from public._conta_gc_factura_de_cobro(v_c.id, v_x.gc_id);
    end if;
    v_pend := v_x.pendiente; v_ya_hay := false; v_ya_pago := null;
    if cardinality(v_pend) = 0 and v_f.id is not null then
      -- Este cobro, ¿ya está apuntado en su factura? (por «Preparar», o por el G05: «Domiciliación SEPA <cobro>»)
      select p.entry_id, true into v_ya_pago, v_ya_hay from public.customer_invoice_payment p
       where p.invoice_id = v_f.id and p.note in ('GoCardless ' || v_x.gc_id, 'Domiciliación SEPA ' || v_x.gc_id)
       order by p.created_at limit 1;
      v_ya_hay := coalesce(v_ya_hay, false);
      if not v_ya_hay and v_f.cobrado + v_x.importe > v_f.total then
        -- Una factura queda cobrada cuando la suma de sus cobros llega a su total: este no cabe. No se adivina: se dice.
        v_pend := v_pend || format('La factura %s ya está cobrada entera (%s de %s €): este cobro pasa de su total',
          v_f.numero, translate(to_char(v_f.cobrado, 'FM999G999G990D00'), ',.', '.,'), translate(to_char(v_f.total, 'FM999G999G990D00'), ',.', '.,'));
      end if;
    end if;
    if v_ya_hay then
      -- Un cobro, un asiento: la fila señala el que ya tiene.
      v_entry := v_ya_pago;
      v_nota := format('El cobro ya está apuntado en la factura %s: %s y no se escribe otro.', v_f.numero,
        case when v_entry is null then 'no lleva asiento aquí' else 'tiene su asiento' end);
      v_seguian := v_seguian + 1;
    elsif cardinality(v_pend) = 0 then
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
    values (v_c.id, v_c.account_id, v_x.clase, v_x.gc_id, v_x.fecha, v_x.importe, v_x.nombre, v_x.cuenta, v_x.concepto, v_entry, v_pend,
            now(), v_quien, v_f.id, v_nota)
    on conflict (company_id, clase, gc_id) do update set fecha = excluded.fecha, importe = excluded.importe, nombre = excluded.nombre,
      cuenta = excluded.cuenta, concepto = excluded.concepto, entry_id = excluded.entry_id, pendiente = excluded.pendiente,
      preparado_en = excluded.preparado_en, preparado_por_nombre = excluded.preparado_por_nombre,
      factura_id = excluded.factura_id, nota = excluded.nota;
  end loop;

  return jsonb_build_object('preparados', v_preparados, 'ya_estaban', v_seguian, 'pendientes', v_pendientes,
    'texto', format('%s preparados · %s ya estaban · %s en «Pendiente de revisar».', v_preparados, v_seguian, v_pendientes));
end $$;
