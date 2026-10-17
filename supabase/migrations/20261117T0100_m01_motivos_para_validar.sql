-- supabase/migrations/20261117T0100_m01_motivos_para_validar.sql
--
-- cambia: public.journal_entry_validar · prueba: supabase/staging/sql/20261117_m01_motivos_para_validar_prueba.sql
-- cambia: public.tg_journal_entry_envio_por_aclarar · prueba: supabase/staging/sql/20261117_m01_motivos_para_validar_prueba.sql
--
-- M01 · «Esperan» (Julio, 16/10, decisión 1: opción A). Lo que la validación
-- parará no cuenta como tarea en «Te toca hoy»: va a una vista «Esperan», cada
-- asiento con su motivo en palabras de oficina. La regla se lee de la base y
-- vive en UN sitio.
--
-- VA DESPUÉS DE LA TANDA DE C (#210, 20261116T0100_c06b_promociones_envios),
-- y se escribe sobre su versión. Esa tanda no cambia journal_entry_validar:
-- añade el freno de los envíos «por aclarar» como un disparador en
-- journal_entry (tg_journal_entry_envio_por_aclarar). Así que hoy la regla de
-- «no se valida» vive en DOS sitios: las guardas de journal_entry_validar
-- (versión vigente: 20261113T0100_c06b_centimo_iva, la misma que producción el
-- 16/10) y ese disparador. Este fichero junta las dos en una sola función.
--
-- ORDEN (Julio, 16/10): esta tanda va DESPUÉS de la de C, y se lanza cuando
-- Julio diga «te toca». Y AL REVÉS TAMBIÉN: si hay que deshacer el 0100 de C
-- (20261116T0100_c06b_promociones_envios), primero se deshace esta. La
-- validación nueva llama a conta_motivos_para_validar, que llama a
-- conta_cargos_de_pedidos (de C): si C se deshace sola, se lleva esa función y
-- deja sin poder validar todos los asientos de ventas del día.
--
-- LO QUE HACE:
--   1. conta_motivos_para_validar(asiento) (NUEVA, solo lee): todo lo que
--      haría que journal_entry_validar no lo valide, por orden, con el MISMO
--      texto con el que hoy lo para. Las guardas, copiadas de la vigente; el
--      envío por aclarar, del disparador de C. No mira quién valida ni si el
--      asiento ya está validado: eso no es un motivo para esperar, y sigue en
--      journal_entry_validar.
--   2. conta_esperan(empresa, desde, hasta) (NUEVA, solo lee): los asientos
--      propuestos o en borrador de esas fechas que la validación pararía, con
--      sus motivos. Es lo que lee la vista «Esperan» del libro diario.
--   3. journal_entry_validar (MISMA FIRMA): en vez de sus guardas, para con el
--      primer motivo de conta_motivos_para_validar. Lo demás —quién valida, el
--      estado, la numeración, la huella— igual que la vigente.
--   4. tg_journal_entry_envio_por_aclarar (MISMA FIRMA, la de C): lee su
--      motivo de conta_motivos_para_validar. El disparador no cambia: sigue
--      frenando por cualquier camino (una actualización directa, el botón de
--      antes en una pestaña sin recargar).
--
-- Lo que NO entra en los motivos, a propósito:
--   · el «Resumen de ventas» de una plataforma (trg_journal_entry_valida_con_pdf,
--     20261111T0720): lo hace el propio botón de validar al validar; no es algo
--     que el usuario tenga que esperar;
--   · lo que pasa con Diez después de validar (sin documento, envío fallido,
--     plataforma sin factura medida, local sin grupo): no para la validación.
--
-- Fuera del camino del pedido: journal_entry_validar la llama quien valida un
-- asiento; las dos nuevas solo leen. Misma firma en las dos que cambian:
-- create or replace no crea una sobrecarga.

-- 1 ----------------------------------------------------------------------------------
create function public.conta_motivos_para_validar(p_entry uuid)
returns table (orden int, codigo text, motivo text)
language plpgsql
stable
set search_path = public
as $function$
declare
  v_e public.journal_entry; v_y public.fiscal_year;
  v_n int; v_debe numeric; v_haber numeric; v_cierre boolean; v_mal text; v_aclarar int; v_lista text;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null then return; end if;

  -- Regla 1: cuadra, al céntimo.
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v_n, v_debe, v_haber
    from public.journal_line where entry_id = p_entry;
  if v_n < 2 then
    orden := 1; codigo := 'pocos_apuntes'; motivo := 'Un asiento lleva al menos dos apuntes.'; return next;
  end if;
  if v_debe <> v_haber then
    orden := 2; codigo := 'no_cuadra';
    motivo := format('No cuadra: Debe %s y Haber %s, diferencia %s.', v_debe, v_haber, v_debe - v_haber); return next;
  end if;

  -- Regla 4: fecha en su ejercicio, abierto, fuera de lo traído, mes abierto.
  select * into v_y from public.fiscal_year where id = v_e.fiscal_year_id;
  if v_e.entry_date not between v_y.starts_on and v_y.ends_on then
    orden := 3; codigo := 'fuera_del_ejercicio';
    motivo := format('La fecha %s no es del ejercicio %s.', to_char(v_e.entry_date, 'DD/MM/YYYY'), v_y.code); return next;
  end if;
  if v_e.source_type <> 'migrated' then
    if v_y.status <> 'open' then
      orden := 4; codigo := 'ejercicio_cerrado'; motivo := format('El ejercicio %s está cerrado.', v_y.code); return next;
    end if;
    if v_y.origin in ('mixed', 'migrated') and v_y.origin_program is not null and v_y.history_imported_at is null then
      orden := 5; codigo := 'falta_historico';
      motivo := format('Primero hay que traer el histórico de %s de %s.',
        case lower(v_y.origin_program) when 'diez' then 'Diez' else v_y.origin_program end, v_y.code); return next;
    end if;
    if v_y.imported_until is not null and v_e.entry_date <= v_y.imported_until then
      orden := 6; codigo := 'traido';
      motivo := format('Hasta el %s el ejercicio %s es traído de %s: la fecha abierta más cercana es el %s.',
        to_char(v_y.imported_until, 'DD/MM/YYYY'), v_y.code, v_y.origin_program,
        to_char(public.conta_primer_dia_abierto(v_e.company_id, v_y.imported_until + 1), 'DD/MM/YYYY')); return next;
    end if;
    if public.conta_mes_cerrado(v_e.company_id, v_e.entry_date) then
      orden := 7; codigo := 'mes_cerrado';
      motivo := format('El mes de %s está cerrado: la fecha abierta más cercana es el %s.',
        to_char(v_e.entry_date, 'MM/YYYY'),
        coalesce(to_char(public.conta_primer_dia_abierto(v_e.company_id, v_e.entry_date), 'DD/MM/YYYY'), 'ninguna')); return next;
    end if;

    -- C05 (respuesta 3), copiado de la vigente: un asiento de cierre o de
    -- apertura del generador de cierre (o su contraasiento) se libra de las
    -- reglas de IVA y retención.
    v_cierre := exists (
      select 1 from public.journal_entry o
        join public.fiscal_year oy on oy.id = o.fiscal_year_id
       where o.id = case when v_e.source_type = 'reversal' then v_e.reverses_entry_id else v_e.id end
         and o.source_type in ('closing', 'opening')
         and coalesce(o.reasons, '[]'::jsonb) @> '[{"decision": "cierre-del-ejercicio"}]'::jsonb
         and exists (
           select 1 from public.fiscal_year_closing c
            where c.company_id = o.company_id
              and ((o.source_type = 'closing' and c.fiscal_year_id = o.fiscal_year_id
                    and o.id in (c.regularization_entry_id, c.closing_entry_id))
                or (o.source_type = 'opening' and c.opening_entry_id = o.id
                    and exists (select 1 from public.fiscal_year a
                                 where a.id = c.fiscal_year_id and a.ends_on + 1 = oy.starts_on)))));

    -- Regla 5, copiada de la vigente (20261113T0100: el céntimo de redondeo).
    select string_agg(format('apunte %s (%s): %s', l.position, a.code, m.motivo), '; ' order by l.position) into v_mal
      from public.journal_line l
      join public.company_account a on a.id = l.company_account_id
      left join public.tax_rate t on t.id = l.tax_rate_id
      cross join lateral (select case
        when (a.template_code like '472%' or a.template_code like '477%') and l.tax_rate_id is null and not v_cierre
          then 'un apunte de IVA lleva base, tipo y libro registro'
        when l.tax_rate_id is not null
             and abs(round(l.tax_base * t.rate / 100, 2) - (l.debit + l.credit)) > greatest(1, floor(l.tax_documents / 2.0)) / 100
          then format('la cuota %s no es la base %s × %s %% = %s', l.debit + l.credit, l.tax_base, t.rate, round(l.tax_base * t.rate / 100, 2))
        when a.template_code like '4751%' and l.withholding_rate_id is null and not v_cierre
          then 'una retención lleva su tipo, su base y su modelo'
        when not l.is_common and l.location_id is null
          then 'falta el local (o marcarlo como común)'
        end as motivo) m
     where l.entry_id = p_entry and m.motivo is not null;
    if v_mal is not null then
      orden := 8; codigo := 'apuntes'; motivo := format('No se valida: %s.', v_mal); return next;
    end if;
  end if;

  -- C06b (#210): un asiento de ventas del día con un envío por aclarar. Copiado
  -- de tg_journal_entry_envio_por_aclarar, que desde aquí lo lee de esta función.
  if v_e.source_type = 'sales_day' then
    select count(*), string_agg(coalesce(s.platform_order_code, left(s.id::text, 8)) || ' (envío ' || public.conta_euros_exactos(c.envio) || ', ' || c.por_que || ')', '; ' order by s.sold_at)
      into v_aclarar, v_lista
      from public.sales_day_summary d
      cross join lateral public.conta_cargos_de_pedidos(d.account_id, d.sale_ids) c
      join public.sale s on s.id = c.id and s.account_id = d.account_id
     where d.entry_id = v_e.id and d.account_id = v_e.account_id and c.clase = 'por_aclarar';
    if v_aclarar > 0 then
      orden := 9; codigo := 'envio_por_aclarar';
      motivo := format('No se valida: %s con envío por aclarar: %s. Se resuelve con la liquidación de esa semana.',
        v_aclarar || case when v_aclarar = 1 then ' pedido' else ' pedidos' end, v_lista); return next;
    end if;
  end if;
end $function$;
comment on function public.conta_motivos_para_validar(uuid) is
  'M01 (16/10): lo que haría que journal_entry_validar no valide este asiento, por orden y con el texto con el que lo para. La regla vive aquí: journal_entry_validar y tg_journal_entry_envio_por_aclarar la leen. Solo lee.';
revoke all on function public.conta_motivos_para_validar(uuid) from public, anon;
grant execute on function public.conta_motivos_para_validar(uuid) to authenticated;

-- 2 ----------------------------------------------------------------------------------
-- Con los permisos de quien la llama (la RLS de journal_entry deja ver solo lo
-- de su cuenta), y además por la cuenta de la empresa (regla 9).
create function public.conta_esperan(p_company uuid, p_desde date, p_hasta date)
returns table (entry_id uuid, orden int, codigo text, motivo text)
language sql
stable
set search_path = public
as $function$
  select e.id, m.orden, m.codigo, m.motivo
    from public.journal_entry e
    join public.company c on c.id = e.company_id and c.account_id = e.account_id
   cross join lateral public.conta_motivos_para_validar(e.id) m
   where e.company_id = p_company
     and e.status in ('propuesto', 'borrador')
     and e.entry_date between p_desde and p_hasta
   order by e.entry_date, e.id, m.orden
$function$;
comment on function public.conta_esperan(uuid, date, date) is
  'M01 (16/10): los asientos propuestos o en borrador de esas fechas que la validación pararía, con sus motivos (conta_motivos_para_validar). Lo lee la vista «Esperan» del libro diario. Solo lee.';
revoke all on function public.conta_esperan(uuid, date, date) from public, anon;
grant execute on function public.conta_esperan(uuid, date, date) to authenticated;

-- 3 ----------------------------------------------------------------------------------
create or replace function public.journal_entry_validar(p_entry uuid, p_quien_nombre text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_e public.journal_entry;
  v_numero int; v_seq bigint; v_prev text; v_hash text; v_mal text;
begin
  select * into v_e from public.journal_entry where id = p_entry for update;
  if v_e.id is null then raise exception 'Ese asiento no existe.' using errcode = 'P0002'; end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida asientos.' using errcode = '42501';
  end if;
  if v_e.status not in ('propuesto', 'borrador') then
    raise exception 'El asiento ya está %.', v_e.status using errcode = '23514';
  end if;

  -- Reglas 1, 4 y 5 y el envío por aclarar: el primer motivo, con su texto.
  -- La regla vive en conta_motivos_para_validar (M01, 16/10).
  select m.motivo into v_mal from public.conta_motivos_para_validar(p_entry) m order by m.orden limit 1;
  if v_mal is not null then raise exception '%', v_mal using errcode = '23514'; end if;

  -- Regla 2: número siguiente de su serie en el ejercicio, sin huecos. Huella encadenada.
  perform pg_advisory_xact_lock(hashtextextended('journal_entry_numero:' || v_e.company_id, 0));
  select coalesce(max(number), 0) + 1 into v_numero from public.journal_entry
   where company_id = v_e.company_id and fiscal_year_id = v_e.fiscal_year_id and series = v_e.series and number is not null;
  select chain_seq, hash into v_seq, v_prev from public.journal_entry
   where company_id = v_e.company_id and chain_seq is not null order by chain_seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;

  update public.journal_entry set number = v_numero, status = 'validado', validated_at = now(), validated_by = auth.uid(),
         validated_by_name = coalesce(p_quien_nombre, public.conta_nombre_actor()), chain_seq = v_seq, prev_hash = v_prev,
         hash = 'pendiente'
   where id = p_entry;
  v_hash := public.journal_huella(v_prev, public.journal_entry_canonico(p_entry));
  -- La huella se escribe en la misma transacción: el disparador deja pasar este
  -- cambio porque el asiento acaba de validarse (journal_entry_inalterable, 0100).
  perform set_config('folvy.journal_huella', p_entry::text, true);
  update public.journal_entry set hash = v_hash where id = p_entry;
  perform set_config('folvy.journal_huella', '', true);
  return jsonb_build_object('id', p_entry, 'serie', v_e.series, 'numero', v_numero, 'huella', v_hash);
end $function$;

-- 4 ----------------------------------------------------------------------------------
create or replace function public.tg_journal_entry_envio_por_aclarar()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_mal text;
begin
  select m.motivo into v_mal from public.conta_motivos_para_validar(new.id) m where m.codigo = 'envio_por_aclarar';
  if v_mal is not null then raise exception '%', v_mal using errcode = '23514'; end if;
  return new;
end $$;
comment on function public.tg_journal_entry_envio_por_aclarar() is
  'C06b (16/10): un asiento de ventas del día con un envío por aclarar (no se sabe si es del restaurante) no pasa a validado. M01 (16/10): el motivo se lee de conta_motivos_para_validar.';
