-- ============================================================================
-- `pase_ficha` · LA HOJA DE DETALLE DEL PASE · 16/09/2026
--
-- Se decidió el 14/09 --«primero `pase_board`, después la hoja de detalle y
-- `pase_ficha`»-- y se quedó fuera de la cola: la tarjeta salió a producción y
-- la hoja no llegó a existir. Esto es la mitad que faltaba.
--
-- POR QUÉ NO VA DENTRO DE `pase_board`: el tablero se llama en bucle, cada pocos
-- segundos, en tres tablets. Esto se llama UNA vez, cuando alguien toca una
-- tarjeta. Meter el teléfono del cliente en el bucle sería mandar datos
-- personales de veinte pedidos cada cinco segundos para enseñar los de uno.
--
-- MISMA FRONTERA QUE EL TABLERO: el token identifica al aparato, el aparato da
-- cuenta y local, y la venta tiene que ser de ESA cuenta y de ESE local (regla
-- 9). Un token de Alcalá no abre la ficha de un pedido de Villaverde ni aunque
-- se le pase el uuid: se comprueban las dos cosas, no sólo la cuenta.
--
-- QUÉ DEVUELVE Y QUÉ NO. Datos, no frases. `quien_lo_lleva` y las explicaciones
-- de por qué no hay teléfono las arma el front en `laFicha.ts`, con las mismas
-- funciones que ya usa la tarjeta: la misma regla en dos sitios es una regla que
-- un día dice dos cosas, y entonces la tarjeta y la hoja discrepan del mismo
-- pedido. La única frase que sí viaja armada es `cliente_marcacion`, y no es una
-- frase: es lo que se marca. Si dos sitios lo arman con pausas distintas, la
-- llamada falla en la mano de quien está sirviendo.
--
-- MEDIDO ANTES DE ESCRIBIRLO, 14 días de Foodint, 1.669 ventas no anuladas:
--
--   origen · canal · servicio        n     tel.rider  tel.cli  código  dirección
--   ───────────────────────────────────────────────────────────────────────────
--   Last    · Glovo   · plataforma  844        0          0       0        0
--   Last    · Uber    · plataforma  350        0        350     350        0
--   HubRise · Glovo   · NUESTRO     222      215        221       0      218
--   HubRise · Uber    · plataforma  179        0        179     179        0
--   HubRise · Glovo   · plataforma   41        0          0       0        0
--   Last    · JustEat · plataforma   12        0         12      12        0
--   HubRise · JustEat · NUESTRO       6        6          6       6        6
--   Last    · JustEat · NUESTRO       4        0          4       4        4
--   recogidas                        11        0          6       6        0
--
--   · La centralita con código es de Uber Y de JustEat: 529 de 529 y 22 de 22.
--     La maqueta del 14/09 sólo nombraba a Uber.
--   · Glovo no manda código en 1.107 pedidos, y cuando reparte Glovo tampoco
--     manda teléfono del cliente: 0 de 885.
--   · 🔴 SIETE repartos nuestros con flota traen nombre de repartidor y NO
--     traen su teléfono (215 de 222 + 6 de 6). Ese caso existe y la hoja lo
--     dice; antes habría pintado un botón que no marca nada.
--
-- 🔴 LO QUE NO HAY, Y SE DICE EN VEZ DE DEJAR UN HUECO: no existe ningún campo
-- de ALERGIAS en el pedido. Ni en `sale` ni en `sale_line`. La maqueta pedía
-- «notas y alergias»; lo que hay es `sale.customer_note` --84 en 14 días, y
-- NINGUNA menciona una alergia-- y `sale_line.kitchen_note`, que está vacía en
-- las 4.968 líneas del periodo. Así que la hoja enseña la nota del cliente y
-- dice que no hay alergias declaradas. Queda apuntado como deuda: si un día se
-- quiere alergias de verdad, hay que capturarlas del conector, no inventarlas.
--
-- LA BANDA DE SERVICIO, contada y no supuesta:
--   · función NUEVA: no la llama nadie. `pg_proc` con 'pase_ficha' en el cuerpo
--     → 0. `cron.job` con 'pase_ficha' → 0. `pg_trigger` → 0 disparadores.
--   · un CREATE FUNCTION no toma cierre exclusivo sobre ninguna tabla.
--   · se aplica fuera de banda de todos modos: APLICADA a las 23:45:36 del
--     reloj de la base, con 13 pedidos todavía abiertos en Alcalá y sin tocar
--     ninguno.
--
-- ENSAYADA CON PEDIDOS DE VERDAD, con el token de la tablet «Pase» de Alcalá:
--   J191403139 · JustEat con flota  rider sí · tel sí · código 878795717 ·
--                                   marcación tel:+34910381… · dirección sí
--   G161       · Glovo con flota    rider sí · tel sí · SIN código ·
--                                   marcación tel:+34660475… · dirección sí
--   G858       · Glovo por Glovo    nada de nada, los cuatro campos en null
--   G805       · 🔴 de CARABANCHEL  rechazado: «ese pedido no es de este local»
-- El último no estaba previsto y es la mejor prueba de las cuatro: la guarda de
-- local se disparó con un pedido real de otro local, no con un caso inventado.
--
-- VOLVER ATRÁS: `drop function if exists public.pase_ficha(text, uuid);`
--   No hay nada más que deshacer: no toca ninguna tabla ni ninguna función.
-- ============================================================================

create or replace function public.pase_ficha(p_device_token text, p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device kds_device;
  v_sale   sale;
  v_raw    jsonb;
  v_codigo text;
  v_tel    text;
  v_marca  text;
begin
  v_device := public.kds_resolve_device(p_device_token);
  if v_device.id is null then
    raise exception 'pase_ficha: token de dispositivo no válido';
  end if;

  -- 🔴 CUENTA **Y** LOCAL. El token es del aparato; el aparato es de un local.
  select s.* into v_sale
    from sale s
   where s.id         = p_sale_id
     and s.account_id = v_device.account_id
     and s.location_id = v_device.location_id;

  if v_sale.id is null then
    -- No se dice «no existe» ni «no es tuya»: se dice lo mismo en los dos casos,
    -- porque distinguirlos le contaría a un token ajeno qué ventas hay.
    raise exception 'pase_ficha: ese pedido no es de este local';
  end if;

  -- `raw_tab` es texto y puede no ser JSON. Si no lo es, no hay código y ya
  -- está: un pedido sin centralita es un caso normal, no un fallo.
  begin
    v_raw := v_sale.raw_tab::jsonb;
  exception when others then
    v_raw := null;
  end;

  v_codigo := nullif(btrim(coalesce(
                v_raw #>> '{customer,phone_access_code}',      -- HubRise
                v_raw #>> '{customerInfo,phoneNumberCode}'     -- Last
              )), '');

  v_tel := nullif(btrim(v_sale.customer_phone), '');

  -- La marcación, con las pausas. Tres comas son ~6 segundos en Android: lo que
  -- tarda una centralita en descolgar y pedir el código.
  -- ⚠️ NO VERIFICADO: que las centralitas de Uber y JustEat traguen los tonos
  -- nada más descolgar. Por eso el código viaja TAMBIÉN suelto, para escribirlo
  -- grande en la hoja: hasta la llamada de prueba desde la tablet de Alcalá, la
  -- persona tiene que poder teclearlo.
  v_marca := case
               when v_tel is null then null
               when v_codigo is null then 'tel:' || replace(v_tel, ' ', '')
               else 'tel:' || replace(v_tel, ' ', '') || ',,,' || replace(v_codigo, ' ', '')
             end;

  return jsonb_build_object(
    'sale_id',       v_sale.id,
    'codigo',        coalesce(v_sale.pos_short_code, v_sale.platform_order_code),
    'marca',         (select b.name     from brand b where b.id = v_sale.brand_id),
    'marca_logo_url',(select b.logo_url from brand b where b.id = v_sale.brand_id),
    'channel',       coalesce((select c.name from sales_channel c where c.id = v_sale.channel_id),
                              v_sale.external_channel_text),
    -- Los mismos campos crudos que manda `pase_board`, para que las frases de
    -- quién lo lleva se armen igual en la tarjeta y en la hoja.
    'order_status',  v_sale.order_status,
    'service_type',  v_sale.service_type,
    'has_courier',   v_sale.has_courier,
    'carrier_code',  v_sale.carrier_code,
    'source',        v_sale.source,
    'delivery_state',v_sale.delivery_state,
    -- El repartidor: de casa o de nadie.
    'repartidor_nombre',   nullif(btrim(v_sale.rider_name), ''),
    'repartidor_telefono', nullif(btrim(v_sale.rider_phone), ''),
    -- El cliente.
    'cliente_nombre',    nullif(btrim(v_sale.customer_name), ''),
    'cliente_telefono',  v_tel,
    'cliente_codigo',    v_codigo,
    'cliente_marcacion', v_marca,
    -- Los cinco instantes, en crudo: el reloj lo elige el front.
    'entro_at',    coalesce(v_sale.opened_at, v_sale.sold_at, v_sale.created_at),
    'accepted_at', v_sale.accepted_at,
    'ready_at',    v_sale.ready_at,
    'handed_to_courier_at', v_sale.handed_to_courier_at,
    'delivered_at',         v_sale.delivered_at,
    'direccion',   nullif(btrim(v_sale.delivery_address), ''),
    'notas',       nullif(btrim(v_sale.customer_note), '')
  );
end;
$$;

revoke all on function public.pase_ficha(text, uuid) from public;
grant execute on function public.pase_ficha(text, uuid) to anon, authenticated, service_role;

comment on function public.pase_ficha(text, uuid) is
  'La hoja de detalle del Pase: teléfonos, centralita, tiempos y dirección de UN '
  'pedido. Frontera de token igual que pase_board, y además comprueba el LOCAL. '
  'Devuelve datos, no frases: las frases las arma el front en laFicha.ts.';
