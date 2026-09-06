-- B73a · pieza 4 (06/09/2026) — EL VIGIA. Arreglar diez y marcharse deja el
-- problema intacto para el siguiente: esto es lo que impide el cadaver numero once.
--
-- ── POR QUE NO ES UN AVISO CUANDO EL CONTADOR PASA DE CERO ───────────────────
-- El encargo pide «un aviso cuando el contador pase de cero». Medido antes de
-- escribir nada: el contador NO vale 14, vale **101 en Foodint** (eran 111 antes
-- de los arreglos de esta misma noche) y **77 en la cuenta plantilla**. De las
-- 101, **36 han vendido en los ultimos 30 dias**.
--
-- Un aviso a «> 0» se dispararia en la primera ejecucion y no pararia nunca. Eso
-- no es un vigia: es un ruido que se aprende a ignorar, y entonces tampoco se ve
-- el numero 102. Es exactamente lo que prohibe la regla 7 un piso mas abajo — un
-- umbral filtra lo que INTERRUMPE, pero un contador nunca puede decir «0» habiendo
-- filas.
--
-- Asi que el vigia es un TRINQUETE:
--   · Guarda una marca de agua por cuenta.
--   · Avisa cuando el numero de opciones que cobran, valen cero Y VENDEN sube por
--     encima de esa marca — que es el «el dia que valga 1 mas, se sabra el mismo
--     dia» que Julio pide de verdad.
--   · La marca solo BAJA. Arreglar consolida; nunca se absorbe un empeoramiento.
--   · El mensaje lleva SIEMPRE los dos numeros absolutos, asi que jamas dice
--     «todo bien» habiendo 101 filas.
--   · UN aviso por cuenta, nunca uno por opcion (regla 23).
--
-- Si Julio prefiere el aviso a «> 0» tal cual, se cambia el `>` por la marca a 0
-- y ya esta: la funcion no hay que reescribirla.

create table if not exists public.modifier_zero_cost_baseline (
  account_id  uuid primary key references public.accounts(id),
  vivas       integer     not null,
  total       integer     not null,
  updated_at  timestamptz not null default now()
);

comment on table public.modifier_zero_cost_baseline is
  'Marca de agua del vigia `modifier_zero_cost_watchdog`. `vivas` = opciones que cobran, resuelven a 0 EUR y han vendido en 30 dias. Solo baja.';

create or replace function public.modifier_zero_cost_watchdog(
  p_ventana          interval default interval '30 days',
  p_debounce_window  interval default interval '20 hours'
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r        record;
  v_base   record;
  v_avisos integer := 0;
begin
  for r in
    with cero as (
      -- Una opcion ACTIVA que cobra dinero y cuyos impactos confirmados suman
      -- exactamente 0 EUR. Devolver 0 no es «no inventar»: es afirmar que no
      -- cuesta nada. Incluye tanto las que tienen impacto roto (sin unidad, sin
      -- destino, no convertible) como las que no tienen NINGUN impacto — que es
      -- el caso de «Si, con patatas» de Lovers Burgers, 27 lineas en agosto.
      select mo.account_id, mo.id
        from modifier_option mo
       where mo.is_active
         and coalesce(mo.price_impact, 0) > 0
         and coalesce((select sum(case when i.impact_type in ('add_item','bundle','replace_item')
                                       then public._impact_cost(i.target_recipe_item_id, i.quantity, i.unit_id)
                                       else 0 end)
                         from modifier_recipe_impact i
                        where i.modifier_option_id = mo.id
                          and i.status = 'confirmed'), 0) = 0
    ),
    vivas as (
      -- Las que ademas SE ESTAN VENDIENDO. Una opcion muerta que vale cero es
      -- deuda; una que vende es dinero saliendo hoy.
      select distinct c.account_id, c.id
        from cero c
        join sale_line m on m.modifier_option_id = c.id and m.line_type = 'modifier'
        join sale s on s.id = m.sale_id
                   and s.account_id = c.account_id          -- regla 9, tambien aqui
                   and s.sold_at >= now() - coalesce(p_ventana, interval '30 days')
                   and coalesce(s.status, '') <> 'cancelled'
    )
    select c.account_id,
           coalesce(a.name, '(cuenta sin nombre)') as cuenta,
           count(distinct c.id)::int as total,
           count(distinct v.id)::int as vivas
      from cero c
      left join vivas v on v.id = c.id
      left join accounts a on a.id = c.account_id
     group by c.account_id, a.name
  loop
    select * into v_base from public.modifier_zero_cost_baseline where account_id = r.account_id;

    if not found then
      -- Primera vez: se siembra la marca con lo que hay y NO se avisa. Avisar de
      -- un pasivo que ya existia no le dice a nadie que ha pasado algo hoy.
      insert into public.modifier_zero_cost_baseline (account_id, vivas, total)
      values (r.account_id, r.vivas, r.total);
      raise warning 'modifier_zero_cost_watchdog: % — marca sembrada en % vivas de % que cobran y valen 0 EUR.',
        r.cuenta, r.vivas, r.total;

    elsif r.vivas > v_base.vivas then
      -- HA SUBIDO. Un aviso por cuenta, con los dos numeros absolutos delante.
      perform public._queue_system_alert(
        'modificador_sin_coste',
        'Hay ' || r.vivas::text || ' modificadores que cobran y cuestan 0 EUR en ' || r.cuenta
          || ' (eran ' || v_base.vivas::text || ')',
        'En ' || r.cuenta || ' hay ahora **' || r.vivas::text || ' opciones de modificador que '
          || 'COBRAN dinero, se han vendido en los ultimos '
          || extract(day from coalesce(p_ventana, interval '30 days'))::int::text
          || ' dias y aportan 0,00 EUR al coste**. Antes eran ' || v_base.vivas::text || '.'
          || chr(10) || chr(10)
          || 'En total, contando tambien las que no se venden, son ' || r.total::text
          || ' opciones en esa situacion.' || chr(10) || chr(10)
          || 'Aportar cero no es «no inventar un coste»: es afirmar que no cuesta nada, y eso '
          || 'baja el food cost de todo lo que las lleve. Las causas de siempre son tres: al '
          || 'impacto le falta la unidad, le falta el destino, o la opcion NO TIENE impacto '
          || 'ninguno (pasa cuando una marca se sustituye por otra y la nueva se queda sin '
          || 'configurar).' || chr(10) || chr(10)
          || 'Se revisa en Folvy Kitchen -> Cartas -> el producto -> pestaña «Modificadores» '
          || '-> bloque «Impacto en coste».',
        'modificador_sin_coste_' || r.account_id::text || '_'
          || to_char(now() at time zone 'Europe/Madrid', 'YYYYMMDD'),
        p_debounce_window
      );
      v_avisos := v_avisos + 1;
      raise warning 'modifier_zero_cost_watchdog: % — SUBE de % a % vivas (total %). Aviso encolado.',
        r.cuenta, v_base.vivas, r.vivas, r.total;

    elsif r.vivas < v_base.vivas then
      -- Ha bajado: se consolida. El trinquete solo gira en un sentido.
      update public.modifier_zero_cost_baseline
         set vivas = r.vivas, total = r.total, updated_at = now()
       where account_id = r.account_id;
      raise warning 'modifier_zero_cost_watchdog: % — BAJA de % a % vivas (total %). Marca consolidada.',
        r.cuenta, v_base.vivas, r.vivas, r.total;

    else
      -- Igual. Se dice igualmente: un vigia que calla no se distingue de uno roto.
      update public.modifier_zero_cost_baseline
         set total = r.total, updated_at = now()
       where account_id = r.account_id;
      raise warning 'modifier_zero_cost_watchdog: % — sin cambio: % vivas de % que cobran y valen 0 EUR.',
        r.cuenta, r.vivas, r.total;
    end if;
  end loop;

  return v_avisos;
end;
$function$;

-- La funcion nace declarada (regla 16): PUBLIC no la ejecuta.
revoke execute on function public.modifier_zero_cost_watchdog(interval, interval) from public, anon;
