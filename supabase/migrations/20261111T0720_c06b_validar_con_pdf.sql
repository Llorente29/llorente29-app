-- supabase/migrations/20261111T0720_c06b_validar_con_pdf.sql
--
-- cambia: public.journal_entry · prueba: supabase/staging/sql/20261111_c06b_validar_con_pdf_prueba.sql
--
-- C06b · Respuesta 8 de Julio, pregunta 1: «validar y generar el PDF van
-- juntos; si falla el PDF, el asiento no se valida y se dice por qué».
--
-- Hasta hoy eran dos pasos: journal_entry_validar y, después,
-- conta_documento_guardar. Si el segundo fallaba, el asiento quedaba validado
-- (con su número y su huella, que ya no se tocan) y sin PDF.
--
-- El PDF lleva el número del asiento, y ese número es el siguiente de su serie
-- en el ejercicio (max + 1, journal_entry_validar). Se sabe ANTES de validar:
--   1. conta_numero_previsto(asiento): el número que le tocaría ahora.
--   2. El navegador hace el PDF con ese número y lo sube (el bucket ya deja
--      subir en la carpeta de la cuenta; un fichero subido sin enlazar no es
--      el documento de nadie).
--   3. journal_entry_validar_con_documento: valida y guarda el PDF en UNA
--      transacción. Si el número que da la validación no es el del PDF (otro
--      asiento de la serie se ha validado entre medias), o el PDF no se puede
--      guardar, no se valida nada y se dice por qué.
--
-- Y para que nadie valide un asiento de ventas de una plataforma sin su PDF,
-- por ningún camino (el botón de antes en una pestaña sin recargar, una
-- llamada directa): un disparador DIFERIDO en journal_entry lo comprueba al
-- final de la transacción. Si el asiento queda validado sin su «Resumen de
-- ventas», la transacción entera se deshace. Solo los asientos con resumen de
-- ventas (sales_day_summary con plataforma): los demás, como hasta hoy. El
-- contraasiento de una anulación (source_type 'reversal') no tiene resumen
-- propio: no le afecta.
--
-- Solo añade: dos funciones nuevas, una función de disparador nueva y su
-- disparador. journal_entry_validar y conta_documento_guardar no cambian.

create function public.conta_numero_previsto(p_entry uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_e public.journal_entry;
begin
  select * into v_e from public.journal_entry where id = p_entry;
  if v_e.id is null or not public.belongs_to_account(v_e.account_id) then
    raise exception 'Ese asiento no está.' using errcode = 'P0002';
  end if;
  if not public.current_user_is_admin_or_manager_of(v_e.account_id) then
    raise exception 'Solo un administrador o un encargado de la cuenta valida asientos.' using errcode = '42501';
  end if;
  if v_e.status not in ('propuesto', 'borrador') then
    raise exception 'El asiento ya está %.', v_e.status using errcode = '23514';
  end if;
  -- El mismo cálculo que journal_entry_validar (regla 2): el siguiente de su serie en el ejercicio.
  return (select coalesce(max(number), 0) + 1 from public.journal_entry
           where company_id = v_e.company_id and fiscal_year_id = v_e.fiscal_year_id and series = v_e.series and number is not null);
end $$;

revoke all on function public.conta_numero_previsto(uuid) from public, anon;
grant execute on function public.conta_numero_previsto(uuid) to authenticated, service_role;

create function public.journal_entry_validar_con_documento(
  p_entry uuid, p_numero integer, p_ruta text, p_nombre text, p_sha256 text, p_bytes integer, p_quien_nombre text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_v jsonb; v_d jsonb;
begin
  if p_numero is null then
    raise exception 'Falta el número con el que se hizo el PDF.' using errcode = '22023';
  end if;
  -- Valida con todas sus reglas (cuadre, fecha, mes, IVA, número y huella).
  v_v := public.journal_entry_validar(p_entry, p_quien_nombre);
  if (v_v->>'numero')::int <> p_numero then
    raise exception 'El PDF se hizo con el nº % y al validar le toca el nº % (se ha validado otro asiento de la serie a la vez): no se valida. Vuelve a pulsar.',
      p_numero, (v_v->>'numero')::int using errcode = '40001';
  end if;
  -- Y guarda su PDF en la misma transacción: si no se puede, no se valida.
  v_d := public.conta_documento_guardar(p_entry, p_ruta, p_nombre, p_sha256, p_bytes, p_quien_nombre);
  return jsonb_build_object('id', p_entry, 'serie', v_v->'serie', 'numero', v_v->'numero', 'huella', v_v->'huella', 'documento', v_d);
end $$;

revoke all on function public.journal_entry_validar_con_documento(uuid, integer, text, text, text, integer, text) from public, anon;
grant execute on function public.journal_entry_validar_con_documento(uuid, integer, text, text, text, integer, text) to authenticated, service_role;

-- Al final de la transacción: un asiento con resumen de ventas que ha pasado a
-- validado lleva su PDF. Si no, se deshace todo (también la validación).
create function public.journal_entry_valida_con_pdf()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.status = 'validado'
     and exists (select 1 from public.sales_day_summary d
                  where d.entry_id = new.id and d.account_id = new.account_id and d.channel_id is not null)
     and not exists (select 1 from public.journal_entry_document x
                      where x.entry_id = new.id and x.account_id = new.account_id and x.kind = 'resumen_ventas') then
    raise exception 'Un asiento de ventas de una plataforma se valida con su PDF («Resumen de ventas»), y este no lo lleva: no se valida.'
      using errcode = '23514', hint = 'Validar y guardar el PDF van juntos (journal_entry_validar_con_documento).';
  end if;
  return null;
end $$;

revoke all on function public.journal_entry_valida_con_pdf() from public, anon, authenticated;

create constraint trigger trg_journal_entry_valida_con_pdf
  after update of status on public.journal_entry
  deferrable initially deferred
  for each row
  when (new.status = 'validado' and old.status is distinct from 'validado')
  execute function public.journal_entry_valida_con_pdf();
