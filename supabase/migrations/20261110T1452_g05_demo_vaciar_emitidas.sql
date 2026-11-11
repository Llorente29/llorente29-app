-- supabase/migrations/20261110T1452_g05_demo_vaciar_emitidas.sql
-- cambia: public.customer_invoice_inalterable · prueba: supabase/staging/sql/20261110_g05_demo_vaciar_emitidas_prueba.sql
-- cambia: public.customer_invoice_line_inalterable · prueba: supabase/staging/sql/20261110_g05_demo_vaciar_emitidas_prueba.sql
-- cambia: public.journal_entry_inalterable · prueba: supabase/staging/sql/20261110_g05_demo_vaciar_emitidas_prueba.sql
-- cambia: public.journal_line_inalterable · prueba: supabase/staging/sql/20261110_g05_demo_vaciar_emitidas_prueba.sql
--
-- G05 · nº 86 · «VOLVER A EMPEZAR» DE LA DEMO PUEDE VACIAR SUS FACTURAS EMITIDAS Y
-- SUS ASIENTOS VALIDADOS. Las cuatro protecciones (una factura emitida no se borra
-- ni se cambia, ni sus líneas; un asiento validado tampoco, ni sus apuntes) no
-- dejaban vaciar la demo: 22 facturas, 37 líneas, 82 asientos y 186 apuntes.
--
-- La regla no cambia para nadie más. Solo se aparta cuando se dan las dos cosas:
--   · la cuenta es de demostración (accounts.is_demo), y
--   · en esta misma transacción se ha pedido vaciarla (la marca de sesión
--     folvy.demo_vaciando = esa cuenta), que solo pone
--     _conta_demo_permitir_vaciar(cuenta): no la puede llamar nadie desde fuera
--     (ni authenticated ni anon ni service_role), solo una función del dueño de
--     la base, como demo_gestoria_volver_a_empezar. Desde la API no se puede poner
--     una marca «folvy.*» a mano.
-- Las cuatro funciones son las de producción (medidas el 10/11 a las 14:50 UTC)
-- con una sola línea más al principio. Cada una con su respaldo.
--   1. _conta_demo_vaciando(cuenta): si se está vaciando esa cuenta de demostración.
--   2. _conta_demo_permitir_vaciar(cuenta): pone la marca, hasta el final de la transacción.
--   3. Las cuatro protecciones, con el «si se está vaciando esta demo, se deja».
-- Nada en el camino del pedido. No toca datos.
-- Vuelta atrás: supabase/vuelta-atras/20261110T1452_g05_demo_vaciar_emitidas.down.sql

select public._respaldar_funcion('public.customer_invoice_inalterable()', '20261110T1452_g05_demo_vaciar_emitidas');
select public._respaldar_funcion('public.customer_invoice_line_inalterable()', '20261110T1452_g05_demo_vaciar_emitidas');
select public._respaldar_funcion('public.journal_entry_inalterable()', '20261110T1452_g05_demo_vaciar_emitidas');
select public._respaldar_funcion('public.journal_line_inalterable()', '20261110T1452_g05_demo_vaciar_emitidas');

create or replace function public._conta_demo_vaciando(p_cuenta uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_cuenta is not null
     and coalesce(current_setting('folvy.demo_vaciando', true), '') = p_cuenta::text
     and exists (select 1 from public.accounts where id = p_cuenta and is_demo is true)
$$;
revoke all on function public._conta_demo_vaciando(uuid) from public, anon, authenticated;

create or replace function public._conta_demo_permitir_vaciar(p_cuenta uuid)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  if not exists (select 1 from public.accounts where id = p_cuenta and is_demo is true) then
    raise exception 'Solo se vacía una cuenta de demostración: % no lo es.', p_cuenta using errcode = '42501';
  end if;
  perform set_config('folvy.demo_vaciando', p_cuenta::text, true);
end $$;
revoke all on function public._conta_demo_permitir_vaciar(uuid) from public, anon, authenticated, service_role;

comment on function public._conta_demo_permitir_vaciar(uuid) is
  'G05 · nº 86 · Deja borrar, hasta el final de la transacción, las facturas emitidas y los asientos validados de UNA cuenta de demostración (para «Volver a empezar»). Nadie la puede llamar desde fuera.';

create or replace function public.customer_invoice_inalterable()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  -- G05 · nº 86 · «Volver a empezar» de una cuenta de demostración, y solo eso.
  if public._conta_demo_vaciando(old.account_id) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status <> 'borrador' then
      raise exception 'Una factura emitida no se borra nunca: se corrige con su rectificativa.' using errcode = '23514';
    end if;
    return old;
  end if;
  if old.status <> 'borrador' and (
       new.number is distinct from old.number or new.number_text is distinct from old.number_text or new.series_code is distinct from old.series_code
       or new.fiscal_year is distinct from old.fiscal_year or new.issue_date is distinct from old.issue_date or new.customer is distinct from old.customer
       or new.base is distinct from old.base or new.tax is distinct from old.tax or new.total is distinct from old.total
       or new.surcharge_amount is distinct from old.surcharge_amount or new.withholding_amount is distinct from old.withholding_amount
       or new.hash is distinct from old.hash or new.doc_type is distinct from old.doc_type or new.corrects_id is distinct from old.corrects_id
       or (old.pdf_sha256 is not null and new.pdf_sha256 is distinct from old.pdf_sha256)) then
    raise exception 'La factura % ya está emitida: no se cambia. Se corrige con «Corregir».', old.number_text using errcode = '23514';
  end if;
  if old.status = 'anulada' and new.status <> 'anulada' then
    raise exception 'Una factura anulada no vuelve atrás.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $function$;

create or replace function public.customer_invoice_line_inalterable()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare v_estado text;
begin
  -- G05 · nº 86 · «Volver a empezar» de una cuenta de demostración, y solo eso.
  if tg_op <> 'INSERT' and public._conta_demo_vaciando(old.account_id) then return coalesce(new, old); end if;
  select status into v_estado from public.customer_invoice where id = coalesce(new.invoice_id, old.invoice_id);
  -- Al borrar un borrador entero (cascada) la factura ya no está: se deja.
  if v_estado is not null and v_estado <> 'borrador' then
    -- V01b: poner la cuota donde no la había, sin tocar nada más, sí.
    if tg_op = 'UPDATE' and old.tax_amount is null and new.tax_amount is not null
       and (to_jsonb(new) - 'tax_amount') = (to_jsonb(old) - 'tax_amount') then
      return new;
    end if;
    raise exception 'Las líneas de una factura emitida no se cambian.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $function$;

create or replace function public.journal_entry_inalterable()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_anulacion constant text[] := array['status', 'voided_by_entry_id', 'voided_at', 'voided_by', 'voided_by_name', 'void_reason', 'updated_at'];
begin
  -- G05 · nº 86 · «Volver a empezar» de una cuenta de demostración, y solo eso.
  if public._conta_demo_vaciando(old.account_id) then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.number is not null or old.status in ('validado', 'anulado') then
      raise exception 'El asiento %/% está validado: no se borra, se anula.', old.series, old.number using errcode = '42501';
    end if;
    return old;
  end if;
  new.updated_at := now();
  if old.status = 'validado' and old.hash = 'pendiente' and current_setting('folvy.journal_huella', true) = old.id::text
     and (to_jsonb(new) - array['hash', 'updated_at']) = (to_jsonb(old) - array['hash', 'updated_at']) then
    return new;
  end if;
  if old.status = 'anulado' then
    raise exception 'El asiento %/% está anulado: ya no cambia.', old.series, old.number using errcode = '42501';
  end if;
  if old.status = 'validado' then
    if new.status <> 'anulado'
       or (to_jsonb(new) - v_anulacion) is distinct from (to_jsonb(old) - v_anulacion) then
      raise exception 'El asiento %/% está validado: no se modifica, se anula con un contraasiento.', old.series, old.number using errcode = '42501';
    end if;
  end if;
  return new;
end $function$;

create or replace function public.journal_line_inalterable()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_status text; v_entry uuid := coalesce(new.entry_id, old.entry_id);
begin
  -- G05 · nº 86 · «Volver a empezar» de una cuenta de demostración, y solo eso.
  if tg_op <> 'INSERT' and public._conta_demo_vaciando(old.account_id) then return coalesce(new, old); end if;
  select status into v_status from public.journal_entry where id = v_entry;
  -- Al borrar un borrador, sus apuntes se van con él (el asiento ya no existe).
  if v_status in ('validado', 'anulado') then
    raise exception 'Los apuntes de un asiento validado no se tocan: se anula con un contraasiento.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.entry_id <> old.entry_id then
    raise exception 'Un apunte no cambia de asiento.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $function$;
