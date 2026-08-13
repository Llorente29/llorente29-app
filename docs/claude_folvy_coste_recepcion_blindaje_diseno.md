---
name: folvy_coste_recepcion_blindaje_diseno
description: DISEÑO del blindaje del coste en recepción — de "avisar" a "bloquear". Reajustado el 12/08 tras descubrir que la maquinaria (negotiated_price + price_drift_for) YA existe y solo avisa, nunca bloquea. Distingue coste de referencia (estándar, quieto) de coste real (último recibido). Leer antes de tocar confirm_goods_receipt, computed_cost, el casado de formato o cualquier alarma de precio en recepción.
sources:
  - cowork
estado: RECON ✅ (12/08) · DISEÑO REAJUSTADO · rama fix/blindaje-coste-recepcion (sin construir, pendiente de OK de Julio)
---

# Blindaje del coste en recepción — DISEÑO

> **Reajustado el 12/08.** El fichero previo (`docs/claude_folvy_coste_recepcion_blindaje_diseno.md`)
> proponía construir cosas que **ya existen**. Esta versión incorpora el RECON: la maquinaria está,
> pero **solo avisa, nunca bloquea**.

---

## 0. El problema en una frase

Un error de conversión al recibir (×80, ×10…) corrompe el coste unitario **en silencio** y contamina
todos los escandallos que usen ese artículo. Hay un aviso, pero es un badge que nadie tiene que
atender. **Avisar no sirve de nada si el equipo puede seguir adelante.**

**Medido en producción (12/08):** **27 de 129 artículos** con factores de conversión inconsistentes
entre recepciones; **12 con el coste variando ×10 o más**. Caso rector — **Pan de Pita**: 480
unidades tratadas como 480 cajas → coste ×80 abajo (0,33 € → 0,0037 €) → toda la carta de Meraki
descuadrada y la Pita Mixta aparentando **91 % de margen**.

---

## 1. 🔴 RECON: la maquinaria ya existe (verificado por MCP, 12/08)

- **`article_supplier.negotiated_price`** — el "coste de referencia": precio pactado/estándar,
  independiente del último recibido. **Existe y se edita** en la ficha del ingrediente. **44 de 248**
  artículos ya lo tienen poblado.
- **`price_drift_for(account, item, meses)`** — calcula la mediana de las últimas recepciones y el %
  de desviación del último coste frente a esa mediana. Es literalmente la matemática del vigía.
- **Ambos ya cableados en `GoodsReceiptForm.tsx`:** `negotiatedAlertFor` / `driftAlertFor` pintan
  "🤝 por encima de lo pactado" y "📈 tendencia al alza", con `driftAlertPct` por defecto 25.

**El problema real, entonces, no es que falte maquinaria — es que solo hay avisos, ningún bloqueo.**
No hay `disabled` ni bloqueo de confirmación ligado a esos avisos: son badges informativos en un
panel resumen. El Pan de Pita a 0,0037 € pasó por delante de un aviso que nadie atendía.

**Y la raíz de raíces:** `qty_in_base` **se calcula en el navegador** (`qtyInBaseFromFormat`) y
`confirm_goods_receipt` **se fía** de lo que le manda el cliente sin recomprobarlo. La conversión que
se rompe ni siquiera se valida donde debería. (Deuda ya declarada el **24/06** en CONTEXTO_CLAUDE.md:
"que la recepción al confirmar no permita 'confirmar y olvidar' en silencio".)

---

## 2. Las tres capas, reajustadas a lo que ya existe

**R1 · Vigía — ya está al ~90 %.** El cálculo de mediana/deriva existe y ya se pinta. Lo único que
falta es el **informe/alarma proactiva** (p. ej. semanal), no el cálculo.

**R2 · Coste de referencia → que ALIMENTE el escandallo.** La columna `negotiated_price` existe, pero
hoy solo alimenta un badge en la pantalla de recepción; **no toca el escandallo**. El trabajo real de
R2 es que **`computed_cost` use `negotiated_price`** cuando el coste real diverja de él más allá de un
umbral — para que un error puntual de recepción no arrastre toda la carta.

**R3 · Bloqueo (la pieza genuinamente nueva, y la que corta la hemorragia).** Convertir el aviso en un
**bloqueo real** y **moverlo al servidor** (`confirm_goods_receipt` recalcula `qty_in_base`, no se fía
del cliente). Cierra de paso la deuda del 24/06.

---

## 3. La pregunta que decide el diseño

Si el aviso ya existía y nadie lo atendía, **¿por qué un bloqueo sí se va a atender?** Porque **no
será un badge**: será **una pregunta concreta con dos botones grandes** en el punto donde ocurre —
*"¿480 cajas o 480 unidades?"*— y **sin responderla no se confirma la recepción**. (Principio de Julio:
las capacidades del personal son muy bajas; si hay decisión libre, hay error → o se guía paso a paso o
se bloquea.)

**Dónde salta:** en el **muelle**, no en la oficina. El del muelle sabe si llegaron 6 cajas o 480
panes; la oficina no puede saberlo.

---

## 4. Coste teórico vs real como alarma (idea de Julio, a valorar)

Tener un **coste teórico de receta** basado en el estándar (`negotiated_price`) y otro **real** (último
recibido); si la diferencia **crece**, es una alarma. Encaja con R2: el estándar es el ancla quieta, el
real es el que se mueve con cada recepción, y la brecha entre ambos es señal — sin que un error puntual
pise el ancla.

---

## 5. Estado

Diseño reajustado y subido a la rama **`fix/blindaje-coste-recepcion`**, **sin construir nada** —
pendiente del visto bueno de Julio con las fases ya corregidas. Depende de recepción y consumo limpios
(no bloquear sobre datos sucios).
