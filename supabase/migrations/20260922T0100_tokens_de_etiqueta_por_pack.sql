-- ============================================================================
-- Los packs pedidos 2x acunaban tokens para UNO.  (22/09/2026)
-- ----------------------------------------------------------------------------
-- PROPUESTA. NO APLICADA. La ejecuta Julio.
--
-- G587 · Alcala · Dos Coyotes · Glovo 101780066538 · 21/09 16:06. Dos «PACK PA
-- 2 DC». `ensure_label_tokens` acuno 5 tokens de unidad (1+1+1+2) en vez de 10
-- (2+2+2+4), asi que salieron pegatinas para UN pack. Cocina hizo uno, el pase
-- lo dio por completo, y Glovo reclamo: -31,43 EUR al partner.
--
-- LA REGLA, la misma que el front:  unidades = hijo.quantity x padre.quantity
-- Es la que ya usaba `_sale_line_raw_consumption` (por eso el stock SI cuadro,
-- y por eso esa funcion NO se toca).
--
-- DOS CAMBIOS, y el segundo no venia en el encargo con esta forma:
--   1) multiplicar por el padre al acunar.
--   2) barrer los tokens de la venta que apuntan a una linea que YA NO EXISTE.
--      Medido el 22/09: `label_token.line_id` NO tiene clave ajena a
--      `sale_line`, y 1.949 de 8.473 tokens (23 %) apuntan a una linea muerta.
--      En el G587 son 5 de 5. Pasa porque los adaptadores BORRAN y reinsertan
--      las lineas en cada actualizacion del pedido, y los tokens se acunan al
--      imprimir. Un token colgando de una linea que no existe no sabe a que
--      pieza va: una reimpresion no puede casarlo.
--
-- LO QUE NO SE BORRA NUNCA: un token ya ESCANEADO. Eso es historia de una
-- bolsa que alguien leyo, y se queda aunque su linea haya desaparecido.
--
-- No reprocesa nada: solo actua sobre la venta que se esta imprimiendo, y las
-- ventas pasadas se quedan como estan (regla del 18/09).
-- ============================================================================

begin;

-- ── Guarda: la funcion es la que creo que es ────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ensure_label_tokens'
       and pg_get_function_identity_arguments(p.oid) = 'p_sale_id uuid'
  ) then
    raise exception 'ABORTA: no existe public.ensure_label_tokens(uuid) con esa firma.';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'label_token_unidad_unica'
  ) then
    raise exception 'ABORTA: falta la restriccion label_token_unidad_unica, de la que depende la idempotencia.';
  end if;
end $$;

-- Misma firma (p_sale_id uuid) y mismo tipo de vuelta: CREATE OR REPLACE es
-- correcto aqui. NO se anade ningun parametro — si algun dia hiciera falta,
-- seria DROP + CREATE, nunca REPLACE (regla 2: replace crea una SOBRECARGA y
-- deja las llamadas viejas ambiguas).
create or replace function public.ensure_label_tokens(p_sale_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_acc uuid; v_loc uuid; v_n int := 0;
begin
  select account_id, location_id into v_acc, v_loc from sale where id = p_sale_id;
  if v_acc is null then return 0; end if;

  -- (2) Barrido de huerfanos de ESTA venta: tokens que apuntan a una linea que
  -- ya no existe porque el adaptador reescribio el pedido. Sin clave ajena
  -- nadie los limpia, y una reimpresion no sabria a que pieza va cada uno.
  -- Los ESCANEADOS se quedan: son historia de una bolsa que alguien leyo.
  delete from public.label_token lt
   where lt.sale_id = p_sale_id
     and lt.line_id is not null
     and lt.scanned_at is null
     and not exists (select 1 from sale_line sl where sl.id = lt.line_id);

  with objetivo as (
    -- Linea suelta (sin componentes): su propia cantidad.
    select p.id as line_id, greatest(1, round(p.quantity)::int) as uds
      from sale_line p
     where p.sale_id = p_sale_id and p.parent_sale_line_id is null
       and not exists (select 1 from sale_line h
                        where h.parent_sale_line_id = p.id and h.line_type = 'combo_item')
    union all
    -- (1) Componente de combo: SU cantidad POR LA DEL PACK. Lo que faltaba.
    -- coalesce(padre,1) para que un hijo sin padre localizable no de 0 piezas:
    -- un cero se lee como "no lleva nada" y vuelve a salir la bolsa a medias.
    select h.id,
           greatest(1, round(h.quantity)::int)
             * greatest(1, round(coalesce(pp.quantity, 1))::int)
      from sale_line h
      left join sale_line pp on pp.id = h.parent_sale_line_id
     where h.sale_id = p_sale_id and h.line_type = 'combo_item'
  ),
  unidades as (
    select o.line_id, g.n as unit_no from objetivo o, generate_series(1, o.uds) as g(n)
    union all
    select null::uuid, null::int   -- el token de la BOLSA, uno por venta
  ),
  puestos as (
    insert into public.label_token (token, account_id, location_id, sale_id, line_id, unit_no)
    select public._label_token_nuevo(), v_acc, v_loc, p_sale_id, u.line_id, u.unit_no
      from unidades u
    on conflict on constraint label_token_unidad_unica do nothing
    returning 1
  )
  select count(*)::int into v_n from puestos;

  return v_n;
exception when others then
  raise warning 'ensure_label_tokens: venta % sin tokens (%): %', p_sale_id, sqlstate, sqlerrm;
  return 0;
end;
$function$;

-- ── ENSAYO, dentro de esta misma transaccion (regla 10: por los CAMINOS) ────
-- El camino que cambia es UNO: imprimir. Ni la recepcion de albaran, ni la
-- merma, ni el recuento tocan `label_token`; y el consumo de venta lo calcula
-- `_sale_line_raw_consumption`, que no se toca. Va dicho.

-- E1. G587: 10 tokens de unidad + 1 de bolsa, TODOS con linea viva.
select public.ensure_label_tokens('a6750ed3-0a6e-46fa-b982-5044f4ba56ff') as acunados_ahora;

select coalesce(sl.product_name, '(bolsa)') as pieza,
       count(*) as tokens,
       count(*) filter (where lt.line_id is not null
                          and not exists (select 1 from sale_line s2 where s2.id = lt.line_id)) as huerfanos
  from public.label_token lt
  left join public.sale_line sl on sl.id = lt.line_id
 where lt.sale_id = 'a6750ed3-0a6e-46fa-b982-5044f4ba56ff'
 group by 1 order by 1;
-- Esperado: QUESATACOS BIRRIA 2 · QUESATACOS TERNERA 2 · QUESADILLA 2 ·
--           Coca Cola 4 · (bolsa) 1  = 11 filas de token, 0 huerfanos.
-- Hoy son 6 tokens: 1+1+1+2 de unidad y 1 de bolsa, y los 5 de unidad huerfanos.

-- E2. Idempotencia: pasarla otra vez no acuna NADA y no cambia lo que hay.
select public.ensure_label_tokens('a6750ed3-0a6e-46fa-b982-5044f4ba56ff') as segunda_pasada;
-- Esperado: 0

-- E3. El antes/despues sobre la POBLACION REAL, con la misma vara a los dos
-- lados (regla 31). Medido en seco el 22/09 sobre 30 dias de la cuenta:
--
--     packs de uno           733 ventas   2.279 piezas hoy -> 2.279   (+0)
--     packs pedidos 2x o mas  42 ventas     114 piezas hoy ->   246 (+132)
--
-- O sea: 132 piezas en 30 dias que ni se pegaron ni se cocinaron, y CERO
-- movimiento en todo lo demas. Si al repetirlo el primer grupo se mueve una
-- sola pieza, el arreglo esta rompiendo algo y no se commitea.
with hijos as (
  select s.id as sale_id, p.quantity as padre_qty,
         greatest(1, round(h.quantity)::int) as uds_hoy,
         greatest(1, round(h.quantity)::int)
           * greatest(1, round(coalesce(p.quantity,1))::int) as uds_nuevas
    from sale s
    join sale_line p on p.sale_id = s.id and p.account_id = s.account_id
                    and p.parent_sale_line_id is null
    join sale_line h on h.parent_sale_line_id = p.id and h.account_id = s.account_id
                    and h.line_type = 'combo_item'
   where s.account_id = '51ad1792-6629-4ef7-833a-b57b09a86710'
     and s.sold_at >= now() - interval '30 days'
)
select case when padre_qty > 1 then 'packs pedidos 2x o mas' else 'packs de uno' end as grupo,
       count(distinct sale_id) as ventas,
       sum(uds_hoy) as piezas_hoy,
       sum(uds_nuevas) as piezas_con_el_arreglo,
       sum(uds_nuevas) - sum(uds_hoy) as piezas_que_faltaban
  from hijos group by 1 order by 1;

-- ── Julio: pasar primero con ROLLBACK y leer E1/E2/E3. Solo entonces COMMIT.
rollback;
-- commit;
