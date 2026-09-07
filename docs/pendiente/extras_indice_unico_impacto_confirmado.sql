-- ══════════════════════════════════════════════════════════════════════════
-- PENDIENTE DE APLICAR · sección Extras · decisión de Julio del 07/09 (§6)
--
-- Este fichero NO está en `supabase/migrations/` a propósito. Va ahí, con la
-- versión EXACTA que registre la base, en el momento en que se aplique
-- (regla 17). Ponerle ahora un número inventado es lo que ya se hizo mal una
-- vez en esta sesión con la pieza C de B79.
--
-- SE APLICA FUERA DE LA BANDA 12:15–23:45, con las demás migraciones de la
-- sección.
-- ══════════════════════════════════════════════════════════════════════════
--
-- QUÉ IMPIDE: que una opción de modificador tenga DOS impactos confirmados
-- sobre la misma ficha. Sumaría el coste dos veces, en silencio, y el sitio
-- donde se notaría es la cuenta de resultados, no la pantalla.
--
-- QUÉ SIGUE PERMITIENDO, a propósito:
--   · varios impactos confirmados sobre fichas DISTINTAS — un extra lleva
--     «pan, carne y salsa», y ése es justo el modelo que se abrió el 07/09;
--   · varias PROPUESTAS conviviendo (`proposed`) hasta que se confirme una:
--     el índice es parcial, sólo mira `confirmed`.
--
-- ── POR QUÉ `NULLS NOT DISTINCT`, QUE NO ESTABA EN EL ENCARGO ─────────────
-- `target_recipe_item_id` es nullable, y en Postgres dos NULL NO chocan entre
-- sí por defecto. Con el índice escrito sin más, una opción podría acabar con
-- dos `multiply` confirmados —los dos con destino NULL— y multiplicar dos
-- veces. Es exactamente el doble conteo que este índice existe para impedir,
-- entrando por la puerta de al lado.
--
-- `NULLS NOT DISTINCT` (PostgreSQL 15+; aquí corre 17.6, comprobado) los trata
-- como iguales: un solo impacto confirmado sin destino por opción. Los tipos
-- que no apuntan a ficha son `none` y `multiply`, y tener dos de ésos a la vez
-- no describe nada coherente («no cambia el coste» dicho dos veces, o dos
-- multiplicadores encadenados).
--
-- Medido antes de escribirlo (07/09): 40 impactos confirmados, 2 sin destino,
-- ambos `none`, en opciones distintas. CERO pares duplicados con estas
-- semánticas. El índice entra sin tocar un solo dato.

begin;

-- ── COMPROBACIÓN PREVIA ───────────────────────────────────────────────────
-- Si algún par duplicado hubiera nacido entre la medición y la aplicación, se
-- ABORTA. Un índice único que se crea a ciegas o falla a medias es peor que
-- no tenerlo: aquí se falla en voz alta y con el par delante.
do $previo$
declare v_n int; v_ejemplo text;
begin
  select count(*), min(modifier_option_id::text || ' → ' || coalesce(target_recipe_item_id::text,'(sin destino)'))
    into v_n, v_ejemplo
    from (
      select modifier_option_id, target_recipe_item_id
        from public.modifier_recipe_impact
       where status = 'confirmed'
       group by modifier_option_id, target_recipe_item_id   -- NULL agrupa con NULL
      having count(*) > 1
    ) t;

  if v_n > 0 then
    raise exception
      'ABORTA: hay % par(es) de impactos confirmados duplicados; el primero es %. Hay que resolverlos ANTES de poner el índice.',
      v_n, v_ejemplo;
  end if;
end
$previo$;

-- ── EL ÍNDICE ─────────────────────────────────────────────────────────────
create unique index if not exists modifier_recipe_impact_un_confirmado_por_ficha
  on public.modifier_recipe_impact (modifier_option_id, target_recipe_item_id)
  nulls not distinct
  where status = 'confirmed';

comment on index public.modifier_recipe_impact_un_confirmado_por_ficha is
  'Extras (07/09). Una opción no puede tener dos impactos CONFIRMADOS sobre la misma ficha: sumaría el coste dos veces. Varias fichas distintas sí (un extra lleva varias cosas) y varias propuestas también, hasta que se confirme una. NULLS NOT DISTINCT para que dos `multiply` sin destino tampoco se encadenen.';

-- ── GUARDA ────────────────────────────────────────────────────────────────
-- Verificar CADA objeto con una consulta independiente. No basta el «Success».
do $guarda$
declare v_def text;
begin
  select pg_get_indexdef(i.indexrelid) into v_def
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
   where c.relname = 'modifier_recipe_impact_un_confirmado_por_ficha';

  if v_def is null then
    raise exception 'GUARDA: el índice no existe después de aplicar.';
  end if;
  if v_def !~ 'UNIQUE' then
    raise exception 'GUARDA: el índice existe pero NO es único: %', v_def;
  end if;
  if v_def !~ 'NULLS NOT DISTINCT' then
    raise exception 'GUARDA: falta NULLS NOT DISTINCT — dos multiply sin destino seguirían encadenándose: %', v_def;
  end if;
  if v_def !~ 'status = ''confirmed''' then
    raise exception 'GUARDA: el índice no es parcial sobre confirmed; bloquearía las propuestas: %', v_def;
  end if;
end
$guarda$;

commit;

-- ══════════════════════════════════════════════════════════════════════════
-- PROBADO ANTES DE APLICAR (07/09), en tabla temporal, contra este mismo
-- Postgres 17.6. No es la definición lo que se comprobó: es el comportamiento.
--
--   PASAN, y tienen que pasar:
--     · dos fichas DISTINTAS confirmadas en la misma opción  → 2 filas dentro
--     · dos PROPUESTAS sobre la misma ficha                  → 2 filas dentro
--     · un impacto sin destino confirmado                    → 1 fila dentro
--   RECHAZAN, con 23505:
--     · misma opción + misma ficha, confirmado dos veces
--     · misma opción + SIN destino, confirmado dos veces
--
--   Y la medición de los dos lados que justifica el `NULLS NOT DISTINCT`:
--   con el índice tal y como venía descrito en el encargo (sin él), las TRES
--   filas «misma opción + sin destino + confirmed» ENTRAN. Con él, la segunda
--   se rechaza.
--
-- Las tres guardas de abajo se probaron contra la salida real de
-- `pg_get_indexdef`, que imprime `WHERE (status = 'confirmed'::text)`: las tres
-- casan. Un guarda que rechaza un objeto correcto ya costó una migración
-- abortada el 06/09.
-- ══════════════════════════════════════════════════════════════════════════
