-- ═══════════════════════════════════════════════════════════════════════════
-- MODIFICADORES · A3b — `extra_desconocido` entra en los motivos validos
--
-- SE APLICA A LOS 53 SEGUNDOS DE A3, Y POR UN FALLO MIO.
--
-- A3 hace que una linea de extra sin enlazar se guarde con
-- `unmapped_reason = 'extra_desconocido'`, que es lo que pide el encargo. Lo
-- que no mire antes de aplicar: `sale_line_unmapped_reason_valid` es un CHECK
-- VALIDADO con una lista cerrada —no_brand, no_recipe, no_menu_item,
-- ambiguous, ignored, delisted— y ese valor no estaba dentro.
--
-- Consecuencia mientras las dos migraciones no estan juntas: un pedido que
-- traiga un extra que no se pueda enlazar revienta al adaptarse, con 23514. O
-- sea, se pierde el pedido entero por un extra. Comprobado despues: en esa
-- ventana no entro NINGUN pedido, asi que no se perdio nada. Pero eso es
-- suerte, no diseño.
--
-- Lo que fallo en mi forma de comprobar, que es lo que hay que aprender: el
-- ensayo de A3 corrio sobre 45 ventas REALES y salio verde, pero en esas 45
-- no habia NI UNA linea sin enlazar —A1 y A2 acababan de rescatarlas todas—
-- asi que el camino nuevo, el unico que estrena valor, no se ejecuto ni una
-- vez. Un ensayo verde sobre una poblacion que no contiene el caso no dice
-- nada de ese caso; y yo mismo lo habia escrito en el parte («con_motivo se
-- queda a 0 porque en esta muestra nada acaba sin enlazar») antes de aplicar.
-- Verlo y aplicar igual es el fallo.
--
-- Ampliar un CHECK es seguro: todas las filas que cumplian la lista corta
-- cumplen la larga, asi que se valida sin excepciones.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.sale_line DROP CONSTRAINT sale_line_unmapped_reason_valid;

ALTER TABLE public.sale_line ADD CONSTRAINT sale_line_unmapped_reason_valid
  CHECK (unmapped_reason IS NULL OR unmapped_reason = ANY (ARRAY[
    'no_brand'::text, 'no_recipe'::text, 'no_menu_item'::text,
    'ambiguous'::text, 'ignored'::text, 'delisted'::text,
    -- NUEVO (11/09): el extra llego en el pedido y Folvy no tiene ninguna
    -- opcion que le corresponda, ni por codigo ni por nombre en su marca.
    'extra_desconocido'::text
  ]));
