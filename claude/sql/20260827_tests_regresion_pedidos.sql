-- 20260827_tests_regresion_pedidos.sql
-- TESTS DE REGRESIÓN de la INGESTA DE PEDIDOS (HubRise y plataformas).
-- Todos son SOLO LECTURA. Regla: 0 filas / 0 fallos. Si da otra cosa, volvió.
-- Ejecutar entero después de cada cambio en hubrise-webhook, catcher-dispatch
-- o adapt_hubrise_order.
--
-- Separado de 20260825_tests_regresion_stock.sql el 27/08: aquello mide el
-- motor de consumo y de conteo, y esto mide la frontera por donde entran los
-- pedidos. Son dos cadenas distintas y se rompen por motivos distintos; T13 y
-- T14 se escribieron ahí por inercia y de ahí vienen, con su numeración
-- intacta para no romper las referencias del historial.

-- ══ T13 · Ventas de HubRise sin código de plataforma ═════════════════════
-- El 13/08 por la noche un despliegue de hubrise-webhook borró la captura de
-- `collection_code` -> `platform_order_code`. 14 días y 148 pedidos sin el
-- código que ve el cliente, sin que saltara nada. Restaurado el 27/08 en
-- buildPlatformCodes() (supabase/functions/hubrise-webhook/index.ts) + relleno
-- histórico (20260827T1400) + vigía horario (20260827T1410).
-- Baseline tras el arreglo: 0. Si esto crece, la frontera ha vuelto a perderla.
select count(*) as t13_hubrise_sin_codigo
from sale
where source='hubrise' and platform_order_code is null
  and sold_at >= now() - interval '7 days';

-- Desglose: si T13 > 0, esto dice QUÉ frontera lo perdió (no solo HubRise).
select source,
       count(*) as ventas_7d,
       count(*) filter (where platform_order_code is null) as sin_codigo,
       count(*) filter (where pos_short_code is null)      as sin_corto
from sale
where sold_at >= now() - interval '7 days'
  and source in ('hubrise','lastapp')
group by 1 order by 1;

-- ══ T14 · La calle de Glovo sin el portal ════════════════════════════════
-- HubRise no normaliza la dirección: Glovo manda el número de portal en
-- `customer.city`, Just Eat manda ahí la ciudad.
--
--   Glovo      address_1 "Calle de Ricardo Ortiz"    city "37"      postal_code null
--   Just Eat   address_1 "Calle de Vinaroz, 38, 2A"  city "Madrid"  postal_code "28002"
--
-- La composición descartaba `city` siempre — correcto para Just Eat, donde no
-- puede acabar pegada a la calle, y desastroso para Glovo. El primer pedido
-- real de Glovo con reparto propio (G659, venta xnp3b9x, 27/08) salió a la
-- calle como "Calle de Ricardo Ortiz", sin portal.
--
-- La regla vive en TRES sitios con el mismo texto copiado a mano:
--   public.hubrise_street_line          (20260827163054)  <- manda, escribe última
--   streetLine() en hubrise-webhook     (index.ts)
--   streetLine() en catcher-dispatch    (index.ts, sólo el recompuesto fallback)
-- Este test cubre la de SQL; las dos de TypeScript se comprobaron con los
-- mismos 15 casos el 27/08 y dan idéntica respuesta.
--
-- Baseline: 0 filas. Cada fila que salga es un caso que la regla ya no cumple.
with casos(caso, address_1, city, esperado) as (values
  ('glovo: portal en city',            'Calle de Ricardo Ortiz',      '37',      'Calle de Ricardo Ortiz, 37'),
  ('glovo: portal con letra',          'Calle de Ricardo Ortiz',      '12B',     'Calle de Ricardo Ortiz, 12B'),
  ('glovo: portal con ordinal',        'Calle Mayor',                 '2ª',      'Calle Mayor, 2ª'),
  ('glovo: portal letra separada',     'Calle Mayor',                 '3 A',     'Calle Mayor, 3 A'),
  ('glovo: portal de 4 digitos',       'Paseo de la Castellana',      '1234',    'Paseo de la Castellana, 1234'),
  ('glovo: espacios sobrantes',        '  Calle de Ricardo Ortiz  ',  ' 37 ',    'Calle de Ricardo Ortiz, 37'),
  ('justeat: city es la ciudad',       'Calle de Vinaroz, 38, 2A',    'Madrid',  'Calle de Vinaroz, 38, 2A'),
  ('city vacia',                       'Calle Mayor',                 '',        'Calle Mayor'),
  ('city nula',                        'Calle Mayor',                 null,      'Calle Mayor'),
  ('city de 5 digitos no es portal',   'Calle Mayor',                 '12345',   'Calle Mayor'),
  ('ya termina en el portal (coma)',   'Calle de Ricardo Ortiz, 37',  '37',      'Calle de Ricardo Ortiz, 37'),
  ('ya termina en el portal (espacio)','Calle de Ricardo Ortiz 37',   '37',      'Calle de Ricardo Ortiz 37'),
  ('el numero es de la calle',         'Calle 37',                    '37',      'Calle 37'),
  ('sin calle: nunca ", 37"',          '',                            '37',      null),
  ('sin calle (null)',                 null,                          '37',      null)
)
select caso, address_1, city, esperado,
       public.hubrise_street_line(address_1, city) as obtenido
from casos
where public.hubrise_street_line(address_1, city) is distinct from esperado;

-- T14b · Sobre datos reales: la dirección guardada tiene que CONTENER la calle
-- que compone la regla. Si no la contiene, algún camino la compuso distinto —
-- que es exactamente el fallo que se está vigilando. Baseline: 0 filas.
select s.id, s.pos_short_code, s.sold_at at time zone 'Europe/Madrid' as sold_at_madrid,
       s.raw_tab::jsonb->'customer'->>'address_1' as address_1,
       s.raw_tab::jsonb->'customer'->>'city'      as city,
       public.hubrise_street_line(
         s.raw_tab::jsonb->'customer'->>'address_1',
         s.raw_tab::jsonb->'customer'->>'city')   as calle_esperada,
       s.delivery_address
from sale s
where s.source = 'hubrise'
  and s.sold_at >= now() - interval '7 days'
  and s.raw_tab is not null
  and public.hubrise_street_line(
        s.raw_tab::jsonb->'customer'->>'address_1',
        s.raw_tab::jsonb->'customer'->>'city') is not null
  and position(
        public.hubrise_street_line(
          s.raw_tab::jsonb->'customer'->>'address_1',
          s.raw_tab::jsonb->'customer'->>'city')
        in coalesce(s.delivery_address,'')) = 0
order by s.sold_at desc;
