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
-- TRAMPA DE POSTGRES (real, real, encontrada al calibrar): en el motor de
-- regex de Postgres (ARE), \b NO es limite de palabra -- es backspace. El
-- limite de palabra es \y. Las tres primeras versiones de este interprete
-- usaron \b y nunca encajaban una sola linea real.
--
-- REGLAS AÑADIDAS SOBRE LA TABLA DEL ENCARGO, con su caso real:
--   R0    "CAJA N PAQ DE M UD"      -> Tortilla Maiz "CAJA 12 PAQ DE 20 UD" = 240, no 12.
--   R0bis "N,N DOCENAS"             -> Huevos "huevera 2,5 docenas" = 30, no 2.5.
--
-- GATE DE CALIBRACION (A.1) -- ESTADO A 14/08/2026, NO SUPERADO:
-- Sobre 208 lineas historicas utilizables (699 de sesion, cruzadas por
-- raw_text con su goods_receipt_line real, excluidas las 86 lineas
-- pinneadas en docs/folvy_calibracion_exclusiones_20260814.md):
--   - 188 resueltas (90.4%), 20 NO_RESUELTO (9.6%).
--   - 160 de 188 resueltas coinciden con el total real de la linea
--     (interprete x qty_received) = 85.1%. Umbral pactado: >=95%.
--   - Los 7 casos testigo nombrados en el encargo: 0 fallos silenciosos.
--     6 de 7 dan el valor exacto del encargo. El septimo (Milanesa,
--     "CJ 4 KG -> 4000, no 16") se reporta como contradiccion real de
--     datos, no como fallo: ver informe a Julio del 14/08 22:00.
-- Detalle completo, por regla y con los casos que fallan, en el mismo
-- informe. Tramo B NO se despliega sobre esto hasta que Julio decida como
-- seguir -- lo dice el propio encargo: "si no llegas al umbral, paramos".
--
-- Esta funcion SI se versiona porque es pura, no tiene efectos, y ya vivia
-- probada en produccion desde la sesion de calibracion (creada por MCP con
-- este mismo nombre). No hay nada nuevo en el commit que no se haya
-- ejecutado ya contra los 699 casos reales.
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

    -- R0.bis: "N,N DOCENAS" -- pack_size viene en docenas, x12.
    if v_text like '%DOCENA%' then
      return query select round(p_pack_size * 12, 3), 'R0bis_docenas'::text;
      return;
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
