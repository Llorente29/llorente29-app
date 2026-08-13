# Almacén · RECEPCIÓN — estado del área
**Actualizado: 12 ago 2026.** Regenerado desde BBDD (MCP) y repo, no desde el relato.

---

## 1. Dónde está el frente HOY

La **cadena técnica funciona de punta a punta**, verificada en pantalla por Julio con ALB-00105:
`El albarán dice → artículo casado → formato Caja (4.500) "el habitual" → 41,51 € → 0,0092 €/ud →
9.000 ud al almacén`, con los avisos de precio (`price_drift_for`) encima.

**Lo que falla ahora es el DISEÑO de la pantalla**, no la lógica. Ver `folvy_estado.md` (frente
activo) y la maqueta propuesta el 12/08.

---

## 2. Lo construido y desplegado el 12/08 (4 PR)

| PR | Qué | Estado |
|---|---|---|
| #54 | Enlace pedido↔recepción | mergeado y desplegado |
| #55 | Selector de formato (botón grande, coste/ud visible, bloqueo al confirmar) | mergeado |
| #56 | Casado automático desde `article_supplier` | mergeado |
| #57 | `fromOcr` → `needsResolution` (el que lo hizo visible) | mergeado |

---

## 3. Los CINCO bugs del mismo patrón (leer antes de tocar `GoodsReceiptForm.tsx`)

El camino **"revisar borrador"** —el ÚNICO que usa Llorente29, porque los dos locales activos
tienen `locations.receipt_approval = 'oficina'`— estaba sistemáticamente peor cubierto que el de
escanear. Cinco fallos, misma raíz:

1. `if (order || correcting) return` en el efecto de candidatos de pedido → **arreglado (#54)**
2. `updateGoodsReceipt` **nunca escribía `purchase_order_id`** → sin esto, #54 habría sido cosmético
3. `fromOcr = false` al revisar → apagaba casado, formato y su efecto → **arreglado (#57)**
4. `rowToReceiptLine` leía `supplier_code` y **no lo mapeaba** — el dato se descartaba en silencio
5. **PENDIENTES (2):** el efecto de enlace de líneas al pedido (`if (order || correcting) return`) y
   las Propuestas de `run_mapping` (condicionadas a `ocrPrefill`)

> **Causa de fondo, y así hay que atacarlo:** `fromOcr` / `ocrPrefill` se usan como si significaran
> *"esta línea se puede editar"*, cuando significan *"vengo de una sesión de escaneo en vivo"*.
> **El repaso NO es cazar los 2 que quedan: es decidir de una vez la condición que gobierna la
> edición** y aplicarla en todos.

---

## 4. Números medidos en producción (12/08)

| | |
|---|---|
| Recepciones · enlazadas a pedido | 107 · **1** |
| Recepciones por `ocr` / `manual` | 104 / 1 (el picker manual **se usó 1 vez en 2 meses**) |
| Líneas sin casar | **97** — de ellas **83 (85,6 %) resuelven solas** por código o texto exacto |
| ALB-00107 | 10 de 12 líneas casan solas |
| Albaranes atascados | 14 (6 confirmados + 8 borradores) |
| Artículos con factor de conversión **inconsistente** | **27 de 129** · 12 con coste variando ×10 |

**Memoria de casado (`article_supplier`)**: 248 filas · 140 con texto de albarán · 173 con código ·
**240 con formato**. `learn_from_receipt` **aprende bien**; el problema era que nadie la leía.

---

## 5. El caso rector — Pan de Pita (por qué esto importa)

| Recepción | qty_received | qty_in_base | unit_cost | Coste/ud |
|---|---|---|---|---|
| 19/06 | **6** (cajas) | 480 | 26,40 € | 0,33 € ✅ |
| 05/08 | **480** (¡unidades!) | **38.400** (×80 otra vez) | 0,30 € | **0,0037 €** 🔴 |

Efecto: la Pita Mixta pasó a costar 2,17 € y aparentar **91 % de margen**. Al corregir el pan a
0,30 €, **toda la carta de Meraki se recalculó sola** (20 platos).

⚠️ Sigue viva la **Pita de Falafel**: coste 0,30 € sobre PVP 11,10 € (2,7 % de food cost) — su
receta tiene **solo el pan**. Pasa la regla de "escandallo completo" y es falsa.

---

## 6. Diseños vigentes del área (NO re-diseñar)

- **`folvy_recepcion_un_paso_diseno_20260812.md`** — de 4 pasos a 1. Decisiones de Julio: el stock
  entra **al recibir** (no al confirmar); casado automático en coincidencia exacta, siempre
  modificable; la revisión de oficina es **obligatoria pero no bloquea el stock**, y se quita cuando
  una métrica de tasa de corrección demuestre que el automático es de fiar. Incluye **R5 · puntos de
  pedido**.
- **`folvy_almacen_stock_minimo_autorregulado_diseno.md` (10/08)** — el MRP II ya diseñado, con
  fórmulas, perfil por día de semana y el gate: *"autorregular mínimos sobre un consumo que
  infra-mide es automatizar el error"*.
- **`folvy_coste_recepcion_blindaje_diseno.md`** — reajustado tras descubrir que `negotiated_price`
  y `price_drift_for` ya existen: lo que falta es que **bloqueen**, no que avisen.

---

## 7. Prueba teórica de punto de pedido (12/08, con datos reales)

Cloudtown → Alcalá, entrega en 2 días, ponderando la curva semanal (**domingo 1,28 · jueves 0,71**):
**5 artículos** entrarían en punto de pedido — Milanesa de Pollo (5 cajas), Delicias de Pollo Southern
(3), Cebollino (3 manojos), Cebolla Salteada (1), Carne de Birria (1).

**Dos lecciones medidas:**
- El consumo diario **debe calcularse sobre días con servicio real**, no sobre el calendario:
  dividir entre 90 cuando solo 39 tenían consumo registrado hundía la media a la mitad.
- **Sin ponderar el fin de semana el sistema habría dejado a Llorente29 sin carne de birria el
  domingo**, su mejor día.

⚠️ **No encender hasta que recepción y consumo estén limpios.** Un punto de pedido sobre datos
sucios produce pedidos erróneos automáticos, que es peor que no tenerlos.
