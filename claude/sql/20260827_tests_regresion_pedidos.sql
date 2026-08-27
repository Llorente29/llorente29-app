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
-- puede acabar pegada a la calle, y desastroso para Glovo. G659 (venta
-- xnp3b9x, 27/08 18:21) salió a reparto propio como "Calle de Ricardo Ortiz",
-- sin portal, y acabó NO ENTREGADO.
--
-- Y tres horas después del arreglo, G092 con city "40-46": un RANGO de
-- portales. El patrón solo aceptaba dígitos seguidos, no casó, y el número se
-- perdió otra vez — el mismo fallo por un caso no contemplado. De ahí que la
-- mitad de los casos de abajo sean rangos: es el borde que ya falló una vez.
--
-- Patrón vigente:  ^[0-9]{1,4}( *- *[0-9]{1,4})? *[A-Za-zºª]?$
--
-- La regla vive en TRES sitios con el mismo texto copiado a mano:
--   public.hubrise_street_line          (20260827163054 + 20260827175746)  <- manda
--   streetLine() en hubrise-webhook     (index.ts)
--   streetLine() en catcher-dispatch    (index.ts, sólo el recompuesto fallback)
-- Este test cubre la de SQL. Las dos de TypeScript se ejecutaron con estos
-- mismos 20 casos el 27/08 y dan idéntica respuesta; si tocas una, repite las
-- tres o volverán a divergir, que es exactamente como nació esto.
--
-- Baseline: 0 filas. Cada fila que salga es un caso que la regla ya no cumple.
with casos(caso, address_1, city, esperado) as (values
  ('glovo: portal en city',              'Calle de Ricardo Ortiz',                    '37',      'Calle de Ricardo Ortiz, 37'),
  ('glovo: portal con letra',            'Calle de Ricardo Ortiz',                    '12B',     'Calle de Ricardo Ortiz, 12B'),
  ('glovo: portal con ordinal',          'Calle Mayor',                               '5ª',      'Calle Mayor, 5ª'),
  ('glovo: portal letra separada',       'Calle Mayor',                               '3 A',     'Calle Mayor, 3 A'),
  ('glovo: RANGO (G092)',                'Calle de Emilio Gastesi Fernández',         '40-46',   'Calle de Emilio Gastesi Fernández, 40-46'),
  ('glovo: RANGO con espacios',          'Calle de Emilio Gastesi Fernández',         '40 - 46', 'Calle de Emilio Gastesi Fernández, 40 - 46'),
  ('glovo: portal de 3 digitos',         'Paseo de la Castellana',                    '128',     'Paseo de la Castellana, 128'),
  ('glovo: espacios sobrantes',          '  Calle de Ricardo Ortiz  ',                ' 37 ',    'Calle de Ricardo Ortiz, 37'),
  ('justeat: city es la ciudad',         'Calle de Vinaroz, 38, 2A',                  'Madrid',  'Calle de Vinaroz, 38, 2A'),
  ('justeat: ciudad en mayusculas',      'Calle de Vinaroz, 38, 2A',                  'MADRID',  'Calle de Vinaroz, 38, 2A'),
  ('city vacia',                         'Calle Mayor',                               '',        'Calle Mayor'),
  ('city nula',                          'Calle Mayor',                               null,      'Calle Mayor'),
  ('CP de 5 digitos no es portal',       'Calle Mayor',                               '28017',   'Calle Mayor'),
  ('ya termina en el portal (coma)',     'Calle de Ricardo Ortiz, 37',                '37',      'Calle de Ricardo Ortiz, 37'),
  ('ya termina en el portal (espacio)',  'Calle de Ricardo Ortiz 37',                 '37',      'Calle de Ricardo Ortiz 37'),
  -- Los dos siguientes prueban el ESCAPADO DEL GUION: sin él, `city` se
  -- interpola cruda en un patrón y el guion deja de ser un guion.
  ('ya termina en el RANGO (escapado)',  'Calle de Emilio Gastesi Fernández, 40-46',  '40-46',   'Calle de Emilio Gastesi Fernández, 40-46'),
  ('ya termina en el RANGO con espacios','Calle Mayor, 40 - 46',                      '40 - 46', 'Calle Mayor, 40 - 46'),
  ('el numero es de la calle',           'Calle 37',                                  '37',      'Calle 37'),
  ('sin calle: nunca ", 37"',            '',                                          '37',      null),
  ('sin calle (null)',                   null,                                        '40-46',   null)
)
select caso, address_1, city, esperado,
       public.hubrise_street_line(address_1, city) as obtenido
from casos
where public.hubrise_street_line(address_1, city) is distinct from esperado;

-- T14b · Los tres caminos de acuerdo, sobre datos reales. Baseline: 0 filas.
--
-- Compara la dirección GUARDADA con la que compone la regla desde las piezas
-- del pedido. Si difieren, alguien la compuso distinto — que es exactamente el
-- fallo que se vigila.
--
-- ⚠️ LA VENTANA DE 3 DÍAS NO ES DECORATIVA. Ampliada a 30 días saca 4 pedidos
-- de Just Eat del 13, 13, 15 y 16 de agosto (J189793329, J189807345,
-- J189909640, J189963703) con delivery_address a NULL. NO son de este fallo:
-- son víctimas del anterior, el UPDATE de adapt_hubrise_order que borraba los
-- cuatro campos de cliente, arreglado el 19/08 (20260819T0800). El histórico
-- no se recompone solo. Si amplías la ventana, espera verlos y no los cuentes
-- como regresión.
SELECT pos_short_code, delivery_address,
       raw_tab::jsonb->'customer'->>'address_1' AS a1,
       raw_tab::jsonb->'customer'->>'city'      AS city
FROM sale
WHERE source = 'hubrise'
  AND created_at > now() - interval '3 days'
  AND raw_tab::jsonb->'customer'->>'address_1' IS NOT NULL
  AND delivery_address IS DISTINCT FROM nullif(btrim(concat_ws(', ',
        public.hubrise_street_line(raw_tab::jsonb->'customer'->>'address_1',
                                   raw_tab::jsonb->'customer'->>'city'),
        nullif(btrim(coalesce(raw_tab::jsonb->'customer'->>'postal_code','')),'')
      )),'');
