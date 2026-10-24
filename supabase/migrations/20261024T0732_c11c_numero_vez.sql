-- C11c · El asiento de ventas rehecho después de anular llega a Diez con su número (Julio, 24/10).
--
-- SOLO AÑADE una función. No cambia ninguna tabla, índice ni función que exista.
--
-- POR QUÉ: el número de la factura de ventas sale del local y el día
-- («UBR-CAM-20261010»). Al rehacer un asiento anulado (1821 → 1896, Uber
-- Carabanchel del 10/10), el rehecho llevaba el MISMO número; «nunca dos
-- veces» encontraba en Diez la factura del anulado (2026/1/1820), la daba por
-- suya y, al apuntarla, chocaba con el envío del anulado
-- (external_send_ext_uq). Sin el choque habría sido peor: el rehecho se habría
-- quedado enlazado a la factura anulada y no habría llegado nunca a Diez.
--
-- QUÉ: conta_diez_numero_vez(asiento, número) da la vez de ese número de
-- factura para ese asiento: 1 + los asientos ANULADOS de su empresa que ya lo
-- mandaron a Diez (el número tal cual o «número-N»). El envío
-- (_shared/diezEnviar.ts, en este PR) numera «UBR-CAM-20261010-2» la segunda
-- vez, «-3» la tercera, y no enlaza nunca un documento de Diez que ya es de otro
-- asiento. La primera vez, 1: el número de siempre (nada cambia para los que
-- nunca se anularon).
--
-- Solo la ejecuta el servidor (conta-diez-cola y conta-diez-enviar, con la
-- clave de servicio). Se puede pasar dos veces.
-- Prueba: supabase/staging/sql/20261024_c11c_rehecho_a_diez_prueba.sql
-- Vuelta atrás: supabase/vuelta-atras/20261024T0732_c11c_numero_vez.down.sql

create or replace function public.conta_diez_numero_vez(p_entry uuid, p_base text)
 returns integer
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare v_empresa uuid; v_cuenta uuid; v_n int;
begin
  if coalesce(p_base, '') !~ '^[A-Za-z0-9][A-Za-z0-9-]*$' then
    raise exception 'conta_diez_numero_vez: «%» no es un número de factura de ventas.', p_base using errcode = '22023';
  end if;
  select e.company_id, e.account_id into v_empresa, v_cuenta from public.journal_entry e where e.id = p_entry;
  if v_empresa is null then
    raise exception 'conta_diez_numero_vez: el asiento % no existe.', p_entry using errcode = 'P0002';
  end if;
  select count(distinct s.entry_id) into v_n
    from public.external_send s
    join public.journal_entry a on a.id = s.entry_id and a.account_id = s.account_id
   where s.account_id = v_cuenta and s.company_id = v_empresa
     and s.entry_id <> p_entry
     and s.status in ('enviado', 'enlazado')
     and a.status = 'anulado'
     and (s.ext_invoice_number = p_base or s.ext_invoice_number ~ ('^' || p_base || '-[0-9]+$'));
  return 1 + v_n;
end
$function$;

comment on function public.conta_diez_numero_vez(uuid, text) is
  'C11c (24/10). La vez de un número de factura de ventas para un asiento: 1 + los asientos anulados de su empresa que ya lo mandaron a Diez (tal cual o «-N»). El envío numera «base-2», «base-3»…';
revoke execute on function public.conta_diez_numero_vez(uuid, text) from public, anon, authenticated;
grant execute on function public.conta_diez_numero_vez(uuid, text) to service_role;
