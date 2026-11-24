-- supabase/migrations/20261113T0913_s01p_recibida_fecha.sql
--
-- S01p·18 · Respuesta 18.2, punto 2 (Julio, 13/11) · El asiento de una factura
-- recibida lleva la FECHA DE LA FACTURA, salvo que su trimestre tenga el IVA
-- presentado (regla de Julio, 04/11). La base ya lo hace al proponer desde la
-- 2210 (_conta_recibida_no_antes_de_entrar), pero la pantalla le mandaba la
-- fecha ya movida:
--
--   · la regla V04 del 27/10 («nunca antes del día en que entró») seguía en el
--     front (propuestasLibroService · fechaDeLaRecibida): una factura del 31/10
--     aprobada el 05/11 se proponía el 05/11, y la base, con el 05/11 abierto, no
--     tenía nada que mover. Medido el 13/11 (solo lectura): de las facturas con
--     asiento desde julio, 40 de Foodint en otro mes con el trimestre abierto, las
--     40 en el día que entró la factura (y otras 81 en otro día del mismo mes);
--     0 de Casa Lola. La última, de hoy a las 07:45 UTC.
--   · y el front frenaba con CUALQUIER mes cerrado (también el que cierra una
--     persona), cuando la base solo frena con el corte con Diez y el impuesto
--     presentado (conta_mes_cerrado, S01p).
--
-- Aquí solo se AÑADE conta_recibida_fecha(empresa, fecha): la fecha con la que
-- se apunta una factura recibida y, si no es la suya, por qué. Es la MISMA regla
-- que aplica la base al proponer (_conta_recibida_no_antes_de_entrar), para que
-- la pantalla la enseñe antes de validar y la proponga igual. El front deja de
-- mover la fecha por su cuenta.
--
-- Nada en el camino del pedido. No mueve ninguna fila; los 40 asientos que ya
-- están los cambia D con su tanda (DL1_23).

create or replace function public.conta_recibida_fecha(p_company uuid, p_fecha date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_cuenta uuid; v_r jsonb; v_abierto date;
begin
  select account_id into v_cuenta from public.company where id = p_company;
  if v_cuenta is null or not public.belongs_to_account(v_cuenta) then
    raise exception 'Esa empresa no está en tu cuenta.' using errcode = '42501';
  end if;
  if p_fecha is null then raise exception 'Falta la fecha de la factura.' using errcode = '22023'; end if;
  v_abierto := public.conta_primer_dia_iva_abierto(p_company, p_fecha);
  if v_abierto is null then
    return jsonb_build_object('fecha', null, 'factura', p_fecha,
      'aviso', format('No hay ningún día abierto desde el %s para apuntar esta factura (el ejercicio está cerrado o no existe).', to_char(p_fecha, 'DD/MM/YYYY')));
  end if;
  v_r := public._conta_recibida_no_antes_de_entrar(p_company, jsonb_build_object('source_type', 'supplier_invoice', 'fecha', p_fecha));
  return jsonb_build_object('fecha', (v_r->>'fecha')::date, 'factura', p_fecha, 'aviso', v_r->>'aviso');
end $$;
revoke all on function public.conta_recibida_fecha(uuid, date) from public, anon;
grant execute on function public.conta_recibida_fecha(uuid, date) to authenticated;
comment on function public.conta_recibida_fecha(uuid, date) is
  'S01p·18.2 (0913). La fecha con la que se apunta una factura recibida: la suya, salvo que su trimestre tenga el 303 presentado o su día no esté abierto (entonces el primer día abierto, con su aviso). La misma regla que _conta_recibida_no_antes_de_entrar al proponer; la pantalla la enseña antes de validar.';
