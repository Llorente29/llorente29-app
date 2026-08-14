-- ----------------------------------------------------------------------------
-- Folvy - 20260814T2200
-- Formatos (Tramo A): interprete deterministico de pack_size (Ley 1.bis)
-- ----------------------------------------------------------------------------
--
-- QUE ES ESTO
-- -----------
-- Funcion pura, sin efectos, que resuelve la cantidad en unidad base de UN
-- formato de compra a partir de lo que el OCR ya extrajo de la sesion
-- (pack_size, pack_unit, raw_text) y de la unidad base real del articulo.
-- No escribe nada. No decide cuantos paquetes llegaron (eso es Tramo B).
--
-- PRIORIDAD (aprobada por Julio el 14/08 tras el hallazgo de Code):
-- primero regex determinista sobre el texto literal del documento, y solo
-- despues la tabla indexada por pack_unit. Motivo medido: para el patron
-- "N UD DE X KG" el mismo raw_text produce pack_size/pack_unit distintos
-- entre sesiones de OCR del mismo documento (CARNE BIRRIA CAJA 3 UD DE 2 KG
-- salio como (6,kg), (3,kg) y (3,ud) en sesiones distintas). El texto
-- literal no baila; la extraccion de campos estructurados, si.
--
-- TRAMPA DE POSTGRES (real, encontrada al calibrar): en el motor de regex
-- de Postgres (ARE), \b NO es limite de palabra -- es backspace. El limite
-- de palabra es \y. Las tres primeras versiones de este interprete usaron
-- \b y nunca encajaban una sola linea real.
--
-- REGLAS AÑADIDAS SOBRE LA TABLA DEL ENCARGO, con su caso real:
--   R0          "CAJA N PAQ DE M UD"  -> Tortilla Maiz "CAJA 12 PAQ DE 20 UD" = 240, no 12.
--   R0bis/R0ter "N,N DOCENAS"         -> pack_size baila igual que en R1/R2/R3: la misma
--               frase "2,5 docenas" dio pack_size=2.5 en una sesion (hace falta x12) y
--               pack_size=30 en otra (YA viene multiplicado). Se compara pack_size contra
--               el numero literal que precede a "DOCENA": coincide -> x12; si no, ya es total.
--
-- GATE DE CALIBRACION (A.1) -- SUPERADO el 14/08/2026, 22:40:
-- Denominador corregido tras la instruccion de Julio del 14/08 22:15: el primer intento
-- (85.1%) comparaba contra qty_in_base historico sin filtrar los articulos cuya FICHA se
-- corrigio ese mismo dia en la auditoria F1 (Gouda, Milanesa, Patatas Baston, Cebollino,
-- Tequeños, Bacon, Crema Agria, Jamon Dulce, Salsa Verde, Tomate Frito, Guacamole, Piedra
-- Limpia, Queso Rulo, Bolsas SOS) -- para esos articulos el historico previo a la
-- correccion ES el error, no la referencia.
--
-- Sobre 167 lineas historicas utilizables (699 de sesion, cruzadas por raw_text con su
-- goods_receipt_line real, fuera las 86 lineas pinneadas en
-- docs/folvy_calibracion_exclusiones_20260814.md y fuera los 14 articulos de ficha
-- corregida el 14/08):
--   - 155 resueltas (92.8%), 12 NO_RESUELTO (7.2%).
--   - De las 155, 14 fallaban en el primer calculo. Triadas una a una contra su raw_text:
--     6 son hallazgos de ficha (el texto respalda al interprete, el historico esta mal:
--     Bobina papel cocina x2, Pan Bocadillos, Pasta Trufada, Pulled Pork ALB-00049, Tajin
--     con Limon -- detalle en el informe a Julio); 4 son evidencia de Ley 2, no del
--     interprete (doc_qty y qty_received divergen y el total real casa con doc_qty:
--     Carne de Birria y Pollo Mechado de ALB-00115, Kebab Pollo y Kebab Ternera de
--     ALB-00010 -- quedan anotadas para el barrido retroactivo de F7, fuera del gate por
--     instruccion explicita); 1 (Huevos) SI era bug real y se corrigio con R0ter.
--   - Bugs reales que quedan sin corregir, documentados, bajo el 5% de tolerancia:
--     Frijoles Negros (el texto trae dos pesos, "1600gne (2500 g)", y el interprete confia
--     en el primero cuando el real es el segundo -- un solo caso, no da para regla nueva) y
--     Sweet Potato Fries x2 (McCain, sin ningun peso en el texto legible; pack_size=2.5kg
--     no tiene con que contrastarse).
--   - Con eso: 142 de 145 intentos con ficha fiable aciertan = 97.9%. Umbral pactado: >=95%.
--   - Los 7 casos testigo nombrados en el encargo: 0 fallos silenciosos. Milanesa sale de
--     los casos testigo por decision de Julio (es un caso de Ley 5 -- peso variable via
--     ~4 ud/kg -- fuera de alcance de este encargo, no un fallo de Ley 1.bis).
--
-- Tramo B puede avanzar sobre esta version.
--
-- Esta funcion SI se versiona porque es pura, no tiene efectos, y ya vivia probada en
-- produccion desde la sesion de calibracion (creada por MCP con este mismo nombre). No hay
-- nada nuevo en el commit que no se haya ejecutado ya contra los casos reales.
-- ----------------------------------------------------------------------------

create or replace function public._interpret_pack_size(
  p_pack_size numeric,
  p_pack_unit text,
  p_raw_text text,
  p_base_unit_abbr text,
  p_base_unit_dimension text
) returns table(qty_in_base numeric, rule_id text)
language plpgsql
immutable
as $$
declare
  v_text text := upper(coalesce(p_raw_text, ''));
  m text[];
  v_n numeric;
  v_x numeric;
  v_x_unit text;
  v_factor numeric;
begin
  v_text := regexp_replace(v_text, '(\d),(\d)', '\1.\2', 'g');

  -- R0: "CAJA N PAQ DE M UD" -- triple multiplicacion, articulo en unidades.
  if p_base_unit_dimension = 'unit' then
    m := regexp_match(v_text, '(\d+)\s*PAQ\w*\s+DE\s+(\d+)\s*(?:UD|UDS|UNIDADES)\y');
    if m is not null then
      return query select round(m[1]::numeric * m[2]::numeric, 3), 'R0_texto_n_paq_de_m_ud'::text;
      return;
    end if;

    -- R0bis/R0ter: "N,N DOCENAS". pack_size a veces YA viene multiplicado por 12
    -- (no-determinismo de OCR, igual que en R1/R2/R3). Se compara pack_size contra
    -- el numero literal que precede a "DOCENA": si coincide, hace falta multiplicar;
    -- si no, pack_size ya es el total.
    if v_text like '%DOCENA%' then
      m := regexp_match(v_text, '([\d.]+)\s*DOCENA');
      if m is not null and abs(p_pack_size - m[1]::numeric) < 0.01 then
        return query select round(p_pack_size * 12, 3), 'R0bis_docenas'::text;
        return;
      else
        return query select round(p_pack_size, 3), 'R0ter_docenas_ya_convertido'::text;
        return;
      end if;
    end if;
  end if;

  -- R1: "N UD DE X KG/GR/G/ML/L/LT" -- prioridad maxima para articulos en peso.
  if p_base_unit_dimension = 'weight' then
    m := regexp_match(v_text, '(\d+)\s*(?:UD|UDS|UNIDADES)\s+DE\s+([\d.]+)\s*(KG|GR|G|ML|LT|L)\y');
    if m is not null then
      v_n := m[1]::numeric;
      v_x := m[2]::numeric;
      v_x_unit := lower(m[3]);
      v_factor := case v_x_unit when 'kg' then 1000 when 'gr' then 1 when 'g' then 1
                                 when 'lt' then 1000 when 'l' then 1000 when 'ml' then 1 end;
      return query select round(v_n * v_x * v_factor, 3), 'R1_texto_n_ud_de_x_peso'::text;
      return;
    end if;

    -- R2: orden inverso "X KG/GR ... CAJA/CJ N UD" (gouda: "500 GR CAJA 12 UD").
    m := regexp_match(v_text, '([\d.]+)\s*(KG|GR|G|ML|LT|L)\y.{0,40}?(?:CAJA|CJ)\s+(\d+)\s*(?:UD|UDS|UNIDADES)\y');
    if m is not null then
      v_x := m[1]::numeric;
      v_x_unit := lower(m[2]);
      v_n := m[3]::numeric;
      v_factor := case v_x_unit when 'kg' then 1000 when 'gr' then 1 when 'g' then 1
                                 when 'lt' then 1000 when 'l' then 1000 when 'ml' then 1 end;
      return query select round(v_n * v_x * v_factor, 3), 'R2_texto_x_peso_caja_n_ud'::text;
      return;
    end if;

    -- R3: multiplicacion con asterisco o "x": "15*1.25L" / "5X1KG".
    m := regexp_match(v_text, '(\d+)\s*[\*X]\s*([\d.]+)\s*(KG|GR|G|ML|LT|L)\y');
    if m is not null then
      v_n := m[1]::numeric;
      v_x := m[2]::numeric;
      v_x_unit := lower(m[3]);
      v_factor := case v_x_unit when 'kg' then 1000 when 'gr' then 1 when 'g' then 1
                                 when 'lt' then 1000 when 'l' then 1000 when 'ml' then 1 end;
      return query select round(v_n * v_x * v_factor, 3), 'R3_texto_n_por_x_peso'::text;
      return;
    end if;
  end if;

  -- R4: pack_unit es peso/volumen y coincide con la dimension del articulo -> directo.
  if p_pack_unit in ('kg','g','gr') and p_base_unit_dimension = 'weight' then
    v_factor := case p_pack_unit when 'kg' then 1000 else 1 end;
    return query select round(p_pack_size * v_factor, 3), 'R4_pack_unit_peso_directo'::text;
    return;
  end if;
  if p_pack_unit in ('l','lt','ml') and p_base_unit_dimension = 'volume' then
    v_factor := case p_pack_unit when 'ml' then 1 else 1000 end;
    return query select round(p_pack_size * v_factor, 3), 'R4_pack_unit_volumen_directo'::text;
    return;
  end if;

  -- R5: pack_unit='ud' y el articulo se mide en unidades -> directo.
  if p_pack_unit = 'ud' and p_base_unit_dimension = 'unit' then
    return query select round(p_pack_size, 3), 'R5_pack_unit_ud_articulo_unidad'::text;
    return;
  end if;

  -- Cierre: fuera de tabla -> no se adivina.
  return query select null::numeric, 'NO_RESUELTO'::text;
end;
$$;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from pg_proc where proname = '_interpret_pack_size';
  if v_count <> 1 then
    raise exception 'guard: se esperaba 1 funcion _interpret_pack_size, hay %', v_count;
  end if;
end $$;
