-- supabase/migrations/20261111T0710_c06b_diez_autorizo_primero.sql
--
-- C06b · Respuesta 7 de Julio, tarea 1, orden del plan: «primero un solo
-- asiento en C0008 con autorizo de Julio (Uber · Alcalá del 01/10); Julio lo
-- mira en Diez; después, "Validar y enviar a Diez" con el resto».
--
-- Esto es SOLO lo primero: la autorización de ESE asiento para escribir en la
-- base real C0008. No envía nada: lo envía Julio desde el Libro («Validar y
-- enviar a Diez»), con conta-diez-enviar desplegada y la conexión con Diez de
-- la empresa dada de alta. El resto de la empresa irá en otra tanda
-- (alcance 'empresa'), cuando Julio lo haya mirado en Diez.
--
-- Anclado por cuenta y empresa (regla 9), fecha y concepto; tiene que ser
-- UNO, de ventas de un día y sin anular. Si no, para y no escribe nada. Se
-- puede volver a aplicar: con la autorización ya puesta, no hace nada.
do $$
declare
  v_cuenta  constant uuid := '51ad1792-6629-4ef7-833a-b57b09a86710';
  v_empresa constant uuid := '658728c0-fcd7-46ef-a860-d4e5e6eb21d9';
  v_ids uuid[];
begin
  if not exists (select 1 from public.accounts where id = v_cuenta) then
    raise notice 'C06b 0710: esta base no tiene la cuenta de Foodint (staging): no hay nada que autorizar.';
    return;
  end if;
  select array_agg(id) into v_ids from public.journal_entry
   where account_id = v_cuenta and company_id = v_empresa and entry_date = '2026-10-01'
     and concept = 'Ventas Uber · Foodint Alcalá' and source_type = 'sales_day' and status in ('propuesto', 'validado');
  if coalesce(array_length(v_ids, 1), 0) <> 1 then
    raise exception 'C06b 0710: esperaba UN asiento «Ventas Uber · Foodint Alcalá» del 01/10 y hay %. No se autoriza nada.', coalesce(array_length(v_ids, 1), 0);
  end if;
  if exists (select 1 from public.conta_diez_autorizo where entry_id = v_ids[1]) then
    raise notice 'C06b 0710: ese asiento ya estaba autorizado. No se toca nada.';
    return;
  end if;
  insert into public.conta_diez_autorizo (account_id, company_id, alcance, entry_id, nombre_bd, autorizado_por, motivo)
  values (v_cuenta, v_empresa, 'asiento', v_ids[1], 'C0008', 'Julio',
          'Respuesta 7 (14/10): el primero en C0008, Uber · Alcalá del 01/10, sin PDF (Cegid no guarda documentos). Julio lo mira en Diez antes del resto.');
  raise notice 'C06b 0710: autorizado escribir en C0008 el asiento %.', v_ids[1];
end $$;
