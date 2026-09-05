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

  if p_base_unit_dimension = 'unit' then
    m := regexp_match(v_text, '(\d+)\s*PAQ\w*\s+DE\s+(\d+)\s*(?:UD|UDS|UNIDADES)\y');
    if m is not null then
      return query select round(m[1]::numeric * m[2]::numeric, 3), 'R0_texto_n_paq_de_m_ud'::text;
      return;
    end if;

    if v_text like '%DOCENA%' then
      return query select round(p_pack_size * 12, 3), 'R0bis_docenas'::text;
      return;
    end if;
  end if;

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

  if p_pack_unit = 'ud' and p_base_unit_dimension = 'unit' then
    return query select round(p_pack_size, 3), 'R5_pack_unit_ud_articulo_unidad'::text;
    return;
  end if;

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