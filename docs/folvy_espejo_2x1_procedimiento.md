# Folvy — Procedimiento oficial del 2x1-ESPEJO · v2 (modelo real de la casa)
**v2 · 05/07/2026 · Sustituye a v1.** Corregido con la verdad operativa de Julio: la casa YA usaba dos artículos desde la ley Ómnibus (uno activo, otro desactivado, distinguidos por un "." — que no ayudaba a cocina); Glovo con la promo 2x1 **marca 2 unidades en el pedido automáticamente**; y el precio del artículo real NO se toca jamás (Ómnibus penaliza). El error corregido de v1: NO existe "subreceta 2×" — contaría consumo doble.

## Modelo (cerrado 05/07 con Julio)
- **Dos artículos**: el ORIGINAL (intacto siempre — precio, receta, historial Ómnibus) y el ESPEJO (permanente como ficha, intermitente como oferta: se enciende/apaga con la campaña vía 86).
- **Nombre del espejo (cliente): `{Plato} ★`** — discreto, no genera dudas ("2x1" en el nombre confunde: la etiqueta de promo de Glovo ya vende el 2x1). La ★ es carácter de texto (Alt+9733), NO el emoji ⭐.
- **`kitchen_name` (cocina): `⚠2x1 {Plato}`** — la señal explícita vive donde cocina mira (KDS/ticket prefieren kitchen_name), sin pasar por el cliente.
- **Receta: LA MISMA del original (compartida, `recipe_item_id` = el del original).** Glovo marca 2 uds en el ticket → consumo teórico y coste salen solos (2 × receta de 1). PROHIBIDO crear receta "2×": duplicaría el consumo contado.
- **Precio del espejo: SIEMPRE de la fórmula** (`preview_bogo_mirror_price`: paridad de margen en € + suelo % como mínimo). En **Last se introduce CON IVA tal cual lo da la fórmula** (Last muestra al cliente lo que escribes: 22,10 → cliente ve 22,10). En **Folvy `menu_item.price` va SIN IVA** (22,10/1,10 = 20,09) — ⚠️ deuda anotada: el importador no normalizó el IVA del espejo en el alta (se corrigió a mano); verificar SIEMPRE post-adopción con `select price, round(price*1.10,2)`.
- **Casado**: `mirror_of_item_id` → original (permite el guardarraíl de cocina y el análisis), `external_id` de Last intacto (reimports idempotentes).

## Ciclo de vida
```
[1 sola vez]  CREAR FICHA (Last, ★, CON IVA, deshabilitada) → ADOPTAR (importador) →
              alinear en Folvy (nombre ★ si difiere, kitchen_name ⚠2x1, receta compartida,
              mirror_of, precio sin IVA verificado)
[cada campaña] 86-ON + publicar 2x1 (robot T5) → ... → cancelar 2x1 + 86-OFF
               (espejo dormido, carta EXACTA a como estaba: cero cadáveres)
```
Campañas `kind='bogo'` del agente nacen con **30 días** (always-on de facto, como el caso ×6 de Meraki). Propuestas no aprobadas caducan a 48h.

## Guardarraíl de cocina (pedido por Julio — PENDIENTE de construir, frente KDS/ticket)
Pedido con artículo-espejo (`mirror_of_item_id` not null) y **cantidad 1** → aviso en KDS y ticket: "⚠ 2x1: llega 1 ud — el cliente puede esperar 2, revisar". Motivo real: clientes que modifican a 1 unidad liándose y esperan 2.

## Primer espejo certificado (referencia)
`Burrito Colosal de Cochinita ★` (Bendito Burrito): Last 22,10€ CON IVA deshabilitado · Folvy 20,09 sin IVA · kitchen_name ⚠2x1 · receta compartida (coste 3,86/ud → 7,72 el 2x1, margen 45,1%, ahorro cliente 32,1%) · mirror_of ✓ · external_id ✓.

## Reparto de manos (hoy → destino)
| Paso | Hoy | Destino |
|---|---|---|
| Crear ficha en Last (★, CON IVA, off) | Julio (2 min) | Semi-auto desde Folvy (TPV Fase 2) |
| Adoptar + alinear en Folvy | Importador + SQL guiado | Importador con normalización IVA + botón "alinear espejo" |
| 86 on/off | Manual | Robot/Edge (API Last conocida) |
| Publicar/cancelar 2x1 en Glovo | — (bloqueado, capturas pendientes) | Robot v3.19 (T5) |
| Guardarraíl cocina qty-1 | — (pendiente) | KDS/ticket |

## Guardarraíles
- El original JAMÁS cambia (precio/receta/estado) por esta táctica — Ómnibus por construcción.
- `bogo` sin espejo creado+casado → no publicable (rechazo claro, jamás silencio).
- Precio del espejo jamás a ojo; si el coste del plato cambia, la siguiente propuesta recalcula.
- Cedidas: jamás.
