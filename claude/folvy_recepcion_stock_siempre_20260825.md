# Recepción: el stock entra siempre (25/08/2026)

**Encargo de Julio, tres piezas.** Todas aplicadas en producción.

---

## 1. La promesa falsa de la pantalla

La pantalla de recepciones decía: *«La revisión se apaga sola cuando cocina acierte 30 recepciones seguidas.»*

Era mentira. El contador contaba, pero no estaba conectado a nada — el propio código lo documentaba: *«Folvy PROPONE pasar el local a confirmación directa — no lo cambia solo (ese modo, P4, es un encargo aparte: hoy no hay pantalla que lo consuma)»*.

Ahora la frase es verdad, porque se ha construido el interruptor (pieza 3). El texto pasa a describir lo que hace hoy la revisión:

> Hoy oficina repasa cada albarán **después** de que la mercancía entre al stock. Con 30 recepciones seguidas sin correcciones, este local pasa solo a confirmación directa.

Y al alcanzarla: *«Confirmación directa activa: los albaranes de este local se cierran solos. Una sola corrección de oficina vuelve a activar la revisión.»*

---

## 2. `hold` deja de retener stock

`receive_goods_receipt(id, p_hold)` retenía toda la mercancía cuando la IA pedía revisión. Ahora **postea siempre**; `hold` solo marca `needs_review` para que oficina lo repase.

**Lo que costó el modelo anterior:** cinco albaranes que entraron por la puerta, se escanearon, esperaron a oficina y acabaron **anulados sin existir nunca en el sistema**.

| Albarán | Fecha | Proveedor | Importe |
|---|---|---|---|
| ALB-00091 | 05-08 | CLOUDTOWN | 1.361,20 € |
| ALB-00092 | 05-08 | CLOUDTOWN | 667,71 € |
| ALB-00106 | 12-08 | CLOUDTOWN | 846,51 € |
| ALB-00073 | 30-07 | CLOUDTOWN | 0,00 € |
| ALB-00001 | 05-06 | EUROPASTRY | 0,00 € |
| | | **Total** | **2.875,42 €** |

**Matiz que hay que decir claro: este cambio no habría salvado a esos cinco.** Sus líneas llegaron con `map_source='unmapped'`, sin artículo y sin cantidad base — no había nada que postear. La causa raíz era el alta de códigos de proveedor: en cuanto CLOUDTOWN los tuvo, sus albaranes empezaron a mapear por `code` y a entrar solos (ALB-00124 y 125, del 25-08, entraron con sus 21 y 9 líneas sin incidencia).

Lo que este cambio evita es lo otro: que un albarán **que sí se puede postear** se quede fuera del almacén solo porque la IA dudó del documento.

Lo que no cambia: no se propaga coste ni se aprende memoria/alias de un albarán marcado. El stock se corrige en un clic; el catálogo contaminado, no.

---

## 3. El contador: persistido y conectado

**Sigue siendo por LOCAL y con todas las recepciones, venga el género de quien venga** — mide si cocina cuenta bien, no si el proveedor sirve bien. Umbral 30.

Qué cambia:

| | Antes | Ahora |
|---|---|---|
| Dónde vive | Calculado al vuelo en el cliente | Tabla `location_receipt_trust` |
| Quién lo mantiene | La pantalla, en cada carga | El servidor, en cada recepción y en cada corrección |
| Marca de "del asistente" | Deducida de `status='recibido'`, se perdía al confirmar | Columna `goods_receipt.via_assistant`, duradera |
| Al llegar a 30 | Nada | El local pasa **solo** a confirmación directa |
| Si oficina corrige | Nada | La racha se rompe y la revisión **vuelve sola** |

El bucle se cierra solo en los dos sentidos, que es lo que hace que la frase de la pantalla sea honesta.

**Sobre el umbral.** Julio pidió mantener 30 salvo argumento con datos. No lo hay para bajarlo: el local recibe entre 2 y 14 albaranes por semana (media ~8), así que 30 seguidas es del orden de un mes de trabajo limpio — un periodo de prueba razonable, no una barrera inalcanzable. Y si en la práctica se atasca, la columna `goal` es por local y se cambia con un `UPDATE`, sin migración.

**Un arreglo que venía de propina:** la marca `via_assistant` corrige un subconteo que el código anterior ya admitía («cuenta de menos, nunca de más»). Al sembrarla, Alcalá da **4 de 30** — el mismo número que mostraba la pantalla, que confirma que la racha va por 4 porque se reinició a propósito hace unos días, no porque estuviera rota.

---

## Verificación

- `receive_goods_receipt` ya no contiene la rama `if p_hold then` que saltaba el posteo.
- Siembra: Alcalá 4/30 con 0 correcciones; el resto de locales, 0. Coincide con lo que enseñaba la pantalla.
- Trigger probado en vivo sobre una línea de un albarán **anulado**, y revertido: disparó el recálculo del local correcto y dejó la racha intacta (los anulados no son candidatos).
- `tsc` limpio. Lint sin cambios respecto a la base (2 avisos preexistentes en `GoodsReceiptsPage`). Los 6 tests que fallan (`routes`, `brands`, `salesChannels`) ya fallaban antes.

## Lo que sigue pendiente

Los tres albaranes anulados de CLOUDTOWN (2.875,42 €) siguen sin entrar. Esa mercancía se consumió de verdad, así que el hueco lo han estado tapando los conteos de agosto a mano. Recuperarlos es una decisión aparte: hay que reconstruir sus líneas con artículo y cantidad, y decidir con qué fecha entran.
