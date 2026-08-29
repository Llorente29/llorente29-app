# Tres funciones cambiadas en producción que el repo no conocía — 28/08/2026

**Fecha:** 28/08/2026
**Estado:** cerrado. Las tres están versionadas en `supabase/migrations/` (`20260828T1250`, `T1251`, `T1252`).

Producción fue por delante del repositorio desde las 12:50 del 28/08. Los cambios
se aplicaron a mano, en caliente, y ninguno estaba commiteado. Reaplicar la versión
del repo encima de cualquiera de las tres los habría retrocedido **en silencio** —
que es exactamente lo que pasó con `order_for_print` y `orders_feed`.

Esto no es un encargo de construir nada: es el registro de lo que ya corre. Las
tres migraciones llevan la definición **entera**, sacada con `pg_get_functiondef`
y verificada byte a byte, con el motivo y la marcha atrás en la cabecera.

| Función | md5 de la definición viva | Caracteres | Migración |
|---|---|---|---|
| `_availability_panel_core` | `046155c974a7bc9d3fed39b2306a461e` | 5.175 | `20260828T1250` |
| `_scope_preview_core` | `b817264453c82047230bbcf88c4b770a` | 1.889 | `20260828T1251` |
| `kds_recipe` | `f24491266172d575c40ccd5b3e21cb84` | 3.028 | `20260828T1252` |

Las tres tienen **una sola firma** (`pg_get_function_identity_arguments`), así que
no hay sobrecargas que desambiguar. Aplicar cualquiera de los tres ficheros hoy es
un no-op: son byte a byte lo que ya está vivo.

---

## 1 · `_availability_panel_core` — Last fuera del panel del 86

La CTE `last_off` lleva un `and false`:

```sql
where ecp.account_id = p_account_id and ecp.source='lastapp' and ecp.is_enabled=false
      -- 28/08/2026 · Julio: LAST FUERA DEL PANEL DEL 86, todas las marcas y locales.
      -- Provisional. Para revertir: quitar el "and false" de la linea siguiente.
      and false
```

Decisión de Julio: *«QUITA TODO LO RELACIONADO CON EL 86 DE LAST, cedidas y propias
y cualquier local. En un futuro volveremos pero ahora no.»*

Verificado: **0 tarjetas de Last** en Alcalá, en Carabanchel y en la vista de todos
los locales. **57 tarjetas, todas de Folvy.**
Contexto: `folvy_86_last_fuera_alcala_20260828.md`.

**Marcha atrás:** quitar el `and false`.

**Por qué el filtro vive en la función y no en `external_location_map`:** desactivar
filas de ese mapa habría tocado también la importación de ventas de Last y
`lastapp-sync-catalog`, y con ello la entrada de pedidos de Just Eat en Camichi.
El filtro dentro de la función se quita de encima ese riesgo sin comprobarlo.

## 2 · `_scope_preview_core` — `channelsLast` forzado a 0

```sql
-- 28/08/2026 · Julio: LAST FUERA DEL 86. channelsLast forzado a 0.
-- Folvy no escribe en Last desde el 30/07: el numero enganaba.
-- Para revertir: "if false" -> la condicion original de p_matriculas.
if false then
```

Verificado: el ensayo devuelve `channelsLast: 0`.

**Marcha atrás:** `if false then` → `if p_matriculas is not null and array_length(p_matriculas, 1) > 0 then`.

## 3 · `kds_recipe` — los gramajes que no se veían en Cook Mode

```sql
'qty_base',  coalesce(rl.quantity_gross, rl.quantity_net),   -- sin bruto declarado, el bruto ES el neto
'qty_total', round(coalesce(rl.quantity_gross, rl.quantity_net) * v_qty, 3),
```

`kds_recipe` leía `quantity_gross` a pelo. Con el bruto vacío mandaba `null` y
cocina veía «—» donde había un gramaje real: **237 líneas de 1.490, en 43 recetas
de 155** — más de una de cada cuatro. Ninguna estaba sin datos: las 237 tienen neto.
No faltaba el dato, faltaba el fallback.

El stock y el coste estaban **bien** — verificado, no supuesto:

```
explode_recipe_to_raws     COALESCE(v_line.quantity_gross, v_line.quantity_net)   ← consumo de stock
kitchen_recipe_breakdown   COALESCE(v_line.quantity_gross, v_line.quantity_net)   ← escandallo y coste
kds_recipe                 rl.quantity_gross                                      ← la única sin coalesce
```

Caso de libro de «un dato se calcula en un sitio»: tres funciones resolvían la misma
cascada bruto→neto y una se la saltó. **No descuadraba ningún número** — sólo dejaba
a un cocinero adivinando el gramaje. Por eso nadie lo vio: un fallo que no mueve
ninguna cifra no lo encuentra un cuadre, lo encuentra alguien mirando la pantalla.

Verificado en vivo por Julio el 28/08: *Korean Fried Chicken and fries* muestra
224 g de solomillo, 60 g de salsa coreana y 6 g de cebollino donde antes había guiones.

**Marcha atrás:** volver a `rl.quantity_gross` en `qty_base` y `qty_total`.

---

## Lo que NO hay que buscar

Entre las 12:38 y las 12:55 se desactivaron dos filas de `external_location_map`
(`19ebbc9d-…` y `d2bf2eeb-…`) y se volvieron a activar. Están en `is_active = true`.
No es un olvido: el filtro acabó viviendo en la función (§1), y así se quitó de
encima un riesgo sin comprobar sobre la entrada de pedidos de Just Eat en Camichi.

## Comentarios que se pierden al transcribir

Al commitear la versión viva **tal cual**, el repo pierde documentación que sí tenía.
No se re-añade aquí a propósito: el fichero tiene que casar byte a byte con producción,
y recuperar los comentarios exige un `CREATE OR REPLACE` nuevo — decisión aparte.

- **`_availability_panel_core`** (`20260825T2500`): se pierden dos bloques. El de la
  expansión de marcas por matrícula, y el que explicaba por qué la cara de la tarjeta
  sale de **una sola fila** (*«Antes cada campo salía del max() de su columna, y podían
  ser filas distintas»*). La lógica es idéntica; falta la explicación.

- **`_scope_preview_core`** (`20260806T1700`): la versión viva está además **reescrita
  en compacto**, por eso el diff son 40 líneas y no 4. Y se pierde el comentario del
  contrato `null` vs `0`:

  > *cada tramo se calcula en su propio bloque: un fallo en Last no debe tapar un
  > HubRise que sí se pudo calcular (y viceversa). `null` = no se pudo calcular ESE
  > tramo; el caller lo pinta como «—», nunca como 0.*

  Es justo la distinción que ahora más importa, porque `channelsLast` pasa a valer 0
  **siempre**: aquí 0 significa «no hay empuje a Last», no «no se pudo calcular».

- **`kds_recipe`**: limpio. Sólo los dos `coalesce` y una línea en blanco.

**Pendiente sugerido, no hecho:** un `CREATE OR REPLACE` que devuelva esos comentarios
sin tocar la lógica. Es seguro pero requiere aplicar, así que lo decide Julio.
