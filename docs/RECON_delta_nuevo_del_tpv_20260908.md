# Delta a la RECON de «Nuevo del TPV» — 08/09/2026

Al recibir el encargo entero (§1–§6, decisiones A–E) y ponerme con la **decisión A**,
lo primero que hay que decir es que su premisa no se sostiene tal cual. No cambia el
plan; cambia el trabajo, y a menos.

---

## 1 · `external_product_map` NO es una tabla nueva. Ya existe, y está abandonada

La decisión A dice «Tabla nueva `external_product_map(account_id, source,
external_kind ∈ {product, combo, catalog}, external_id, menu_item_id)`, única por
(account, source, kind, id)».

**Existe desde el 11/06** (`20260611T2000_contrato_ingesta_tablas_alias.sql`). Lo que
hay hoy:

```
external_product_map(id, account_id, source, external_product_id,
                     external_brand_id, menu_item_id, created_at, updated_at)
UNIQUE (account_id, source, external_product_id)
```

**Le falta exactamente el eje que la decisión A añadió a propósito: `external_kind`.**
Sin él, un `organizationComboId` y un `catalogProductId` compiten por la misma clave —
que es el problema de «dos ejes en una columna» que la decisión quería evitar, sólo que
una capa más abajo.

**Y está muerta:** 43 filas, **todas escritas el 10/07/26 en una sola tanda**, y nada
la ha tocado desde entonces. Ni `src/` ni ninguna edge function la leen — sólo aparece
en `src/types/database.ts` (el tipo generado) y en tres migraciones. Un relleno de una
tarde que nadie enganchó. **6 de las 43 apuntan a platos archivados.**

**Consecuencia para A:** es una MIGRACIÓN de una tabla existente, no un `CREATE`.
Añadir `external_kind` (con `default 'product'` para las 43 que hay), cambiar el índice
único a `(account_id, source, external_kind, external_product_id)`, y decidir qué se
hace con las 6 que apuntan a archivados. Y hay que mirar por qué se abandonó antes de
volver a apostar por ella: una tabla que ya se dejó tirada una vez es una candidata a
que la dejen tirada otra.

---

## 2 · Confirmado contra la función VIVA, no contra el fichero

B88 enseñó que un `.sql` del repo puede no ser lo que corre. Así que la comprobación va
sobre `pg_proc.prosrc` de producción:

| busco en `adapt_lastapp_order` (11.341 caracteres) | posición |
|---|---|
| `organizationProductId` | **1241** |
| `organizationComboId` | **0 — no aparece** |
| `catalogProductId` | **0 — no aparece** |
| `external_product_map` | **0 — no la lee** |

La premisa técnica de A es correcta: hoy se casa por `organizationProductId` y por
nombre, y los dos identificadores buenos —los que la RECON del 07/09 midió en 642/645 y
645/645— **no se leen en ninguna parte**. El trabajo de A sigue siendo el que era y
sigue valiendo el 74 % del dinero sin casar.

---

## 3 · Lo que esto NO cambia

Las decisiones B, C, D y E siguen en pie sin tocar: el bloque se alimenta del espejo
del catálogo, Casado absorbe `SalesExceptionsPage` en vez de duplicarla, sólo cuentan
las líneas `product`, y el §1 queda corregido.

---

## 4 · Lo que propongo, y no lo he hecho

Orden dentro de A, con la migración escrita y revisable antes de aplicar nada
(«Claude Code propone, Julio ejecuta y verifica»):

1. **Migración 1 — la tabla:** `external_kind` con su `default`, índice único nuevo,
   `COMMENT` que diga qué es cada `kind` y de dónde sale. DROP + CREATE del índice, no
   `CREATE OR REPLACE` de nada (regla 2 no aplica a índices, pero el orden sí importa:
   primero la columna, luego el índice, en la misma transacción).
2. **Migración 2 — el adaptador:** `adapt_lastapp_order` casa por `external_product_map`
   en el orden combo → catalog → product, y el nombre exacto queda de último recurso.
   DROP + CREATE si cambia la firma; si no, `CREATE OR REPLACE`.
3. **Relleno:** los ids que ya se pueden deducir de las ventas de 30 días, en una
   pasada revisable, con las dos cifras a los dos lados (642/645 antes y después).
4. **Nada de esto se aplica sin que lo veas.** El SQL va al repo y a ti, con el conteo
   previo de cuántas filas cambia cada paso.

**Y una pregunta que es tuya:** las 6 filas que apuntan a platos archivados. ¿Se
borran, o se dejan y el adaptador ignora los archivados? Lo segundo es más seguro
—casar contra un plato archivado descontaría almacén de algo retirado— pero deja
basura; lo primero limpia y pierde la huella de que ese id existió.
