---
name: folvy_recepcion_pantalla_diseno_20260813
description: DISEÑO DE PANTALLA de la recepción de mercancía, en dos modos (directo y oficina) válidos para cualquier negocio de hostelería. Sustituye a la maqueta del 12/08. Define quién puede editar qué y por qué, el rastro obligatorio al cambiar cantidad, y la métrica que APAGA la revisión de oficina cuando el error baja. Leer junto a folvy_recepcion_un_paso_diseno_20260812.md (diseño rector del ciclo) antes de tocar GoodsReceiptForm.tsx.
sources:
  - cowork
estado: DISEÑO APROBADO por Julio (13/08) · pendiente de encargo a Code
---

# Recepción — diseño de pantalla

> **El objetivo, en palabras de Julio (13/08):** *"que Folvy reciba datos reales en las recepciones,
> que el error humano desaparezca, que en la recepción se grabe el inventario y en oficina se revise
> y corrija si es necesario. Los errores arrastrados provocan escandallos erróneos e imposibilidad de
> avanzar en el punto de pedido para el MRP II."*

**No es una pantalla más: es la puerta por donde entra —o se corrompe— el coste de todo el sistema.**
Sin recepción fiable no hay escandallo fiable; sin escandallo no hay food cost, ni T7, ni punto de
pedido. Un ×80 aquí descuadra una carta entera (caso Pan de Pita, 05/08).

---

## 1. El principio que ordena todo: quién sabe qué

De los tres datos de una línea, **solo uno necesita un humano**:

| Dato | ¿Quién lo sabe? | ¿Se deduce? |
|---|---|---|
| **Cuánto ha llegado** | solo quien ve la mercancía | ❌ **no** — irreductible |
| **En qué formato viene** | el pedido enlazado, o la memoria de casado | ✅ casi siempre |
| **Cuánto cuesta** | el albarán, vía OCR | ✅ sí |

> **La vía para que el error humano desaparezca no es validar mejor: es NO PREGUNTAR.**
> Lo que se puede deducir, se deduce. Solo se pregunta lo que nadie más puede saber.

**Corolario que corrige la maqueta del 12/08:** la oficina **no puede** responder "¿480 cajas o 480
panes?" — no vio la mercancía. Preguntárselo produce una adivinanza guardada como dato real, que es
peor que un hueco porque nadie vuelve a mirarla. **Esa pregunta vive donde está la caja.**

---

## 2. Dos modos, un solo diseño

⚠️ **Folvy es para toda la hostelería, no para Foodint.** Un bar donde el dueño recibe y lleva las
cuentas no puede ser obligado a dos pasos. El interruptor **ya existe**: `locations.receipt_approval`.

| Tipo de negocio | `receipt_approval` | Qué ve |
|---|---|---|
| Bar, cafetería, restaurante pequeño (recibe el dueño) | `directo` | **Una pantalla.** Recibe, ve el precio, confirma |
| Restaurante con administración, cadena, hotel con economato | `oficina` | **Dos pasos.** Quien recibe cuenta; quien lleva cuentas cuadra |

**Es el MISMO componente.** Lo que cambia:
1. **Si quien recibe ve el dinero.** En `directo` sí (es su dinero, y decide mejor viéndolo). En
   `oficina` no: el cocinero no ve precios, solo cuenta.
2. **Si hay segundo paso.**

Se construye una vez. El modo lo fija la plantilla de alta por tipo de negocio.

---

## 3. Pantalla 1 — quien recibe (móvil, en la cocina o el muelle)

**Arranca del albarán escaneado.** El OCR ya trae las líneas, las cantidades y el proveedor, y **el
OCR enlaza el pedido** cuando lo hay (PR #54). Quien recibe **no teclea: confirma**.

```
┌─────────────────────────────────────────┐
│ 📷 Albarán 4471 · Cloudtown   [Ver foto]│
├─────────────────────────────────────────┤
│ ✓ Queso Gouda Lonchas                   │
│   El albarán dice 1 caja de 12 ud       │
│      [ − ]        1 caja        [ + ]   │
├─────────────────────────────────────────┤
│ ⚠ Pan de Pita                           │
│   El albarán dice 480 · ¿cajas o panes? │
│      [   6 cajas de 80   ]              │
│      [ 480 panes sueltos ]              │
├─────────────────────────────────────────┤
│ 10 líneas más, tal como vienen          │
├─────────────────────────────────────────┤
│    [ Recibir y meter al stock ]         │
└─────────────────────────────────────────┘
```

- **Sin teclado.** Botones +/− de 52 px y el número grande. Se recibe de pie, con prisa, a veces con
  guantes.
- **Sin precios** en modo `oficina`. En modo `directo`, cada opción muestra el €/ud que resultaría
  (*"0,33 €/ud · su precio de siempre"* frente a *"0,0041 €/ud · 80 veces más barato"*).
- **La ambigüedad de formato salta aquí**, con la caja delante. Y **si hay pedido enlazado, ni
  siquiera aparece**: el formato ya viene dado.
- **El stock entra al pulsar "Recibir"**, no al confirmarlo la oficina. Decisión ya tomada en el
  diseño rector.

---

## 4. Pantalla 2 — oficina (solo en modo `oficina`)

**El stock ya está dentro.** El trabajo de la oficina es **cuadrar el dinero**, no re-contar.

- **Cabecera honesta:** *"En stock desde las 11:42 · revisar 1 importe"*.
- **Enlace a pedido resoluble aquí:** si el OCR no lo enlazó, se ofrece el candidato **con la
  evidencia** (*"mismo proveedor, mismo día, 11 de 12 artículos coinciden"*) y un botón, más "buscar
  otro". No hay que salir de la pantalla.
- **Cuadre del total, siempre visible:** *"albarán 386,42 € = contado 386,42 €"*. Es literalmente su
  trabajo y en la maqueta del 12/08 no existía.
- **Cada línea se abre con [Abrir]** y se colapsa al guardar.

### Qué puede editar la oficina — TODO

| Parámetro | ¿Puede? | ¿Rastro? |
|---|---|---|
| Artículo | ✅ | no |
| Formato (incluido **crear uno nuevo**) | ✅ | no |
| Importe | ✅ | no |
| Enlace a pedido | ✅ | no |
| **Cantidad** | ✅ | ✅ **pide motivo** |

**Por qué solo la cantidad deja rastro** (decisión de Julio, 13/08): es el único dato que la oficina
**no puede verificar**. Los demás los tiene delante en el albarán. Sin ese rastro, la métrica de §6
no distingue "cocina falló" de "oficina reinterpretó", y entonces no sirve para apagar nada.

El motivo es **un toque, no un formulario**: *lo dice el albarán · llamé a cocina · error evidente*.

🔴 **Consecuencia técnica que no se puede omitir:** como el stock YA entró, cambiar la cantidad en
oficina **debe generar un ajuste de stock registrado**, no una corrección silenciosa. Si no, el
inventario y el consumo se desalinean — exactamente lo que este diseño existe para evitar.

---

## 5. Reglas de la línea (comunes a los dos modos)

1. **Lo resuelto se colapsa a una frase con su resultado**, con tic verde:
   `Servilletas 30 x 40 · 2 cajas · 9.000 ud · 0,0092 €/ud`.
   Fuera las etiquetas de maquinaria (`formato:`, `€/formato`, "Propuesto — confírmalo").
2. **Lo que pide acción destaca**: el texto literal del albarán, **una pregunta** y **botones
   grandes**. Nunca enlaces de texto ni dos acciones del mismo peso apiladas.
3. **El coste unitario resultante SIEMPRE visible.** Es la mejor defensa contra el error de formato:
   un `0,0037 €/ud` de pan se ve mal de un vistazo.
4. **Se pide el IMPORTE TOTAL de la línea, no el €/caja.** Es el número impreso en el albarán, así se
   copia sin convertir. Elimina la trampa que ya duplicó un coste real (Julio tecleó el total donde
   iba el unitario).
5. **Cada formato enseña el €/ud que resultaría antes de elegirlo**, y el habitual viene
   preseleccionado. Comparar dos números, no calcular.
6. **Crear formato guarda en el ARTÍCULO** (`recipe_item_purchase_format`), no solo en esa línea. La
   próxima recepción ya lo tiene. *"Cuanto más poblado, menos piensas."*
7. **Contador arriba**: *"Falta 1 de 12 líneas"*.
8. **El botón dice lo que hace**: "Recibir y meter al stock", y **está bloqueado** mientras quede algo
   sin resolver, con el motivo escrito. Descartar una línea es un acto deliberado ("no inventariar"),
   nunca el resultado de no hacer nada.

### Bloqueo por coste implausible
No es un aviso: es **una pregunta con dos botones** que impide seguir. `price_drift_for` y
`negotiated_price` **ya existen y solo avisan** — y nadie atendía el aviso (regla de la cuarta pata).
En modo `directo` este bloqueo importa MÁS, no menos: no hay oficina detrás que lo cace.

---

## 6. La métrica que APAGA la revisión de oficina

Sin medir, *"la revisión desaparece cuando el error sea bajo"* se queda en intención. Al pie de la
pantalla de oficina:

```
¿Sigue haciendo falta revisar?
La revisión se apaga sola cuando cocina acierte 30 recepciones seguidas.

  Corregidas por oficina        Seguidas sin fallo
        3 de 41                     12 de 30
```

**Umbral: 30 recepciones consecutivas sin corrección de cantidad** (no un porcentaje: un porcentaje
se puede cumplir con fallos recientes; una racha demuestra que el proceso está estable *ahora*).
Al alcanzarlo, Folvy **propone** pasar el local a `directo`. No lo hace solo.

---

## 7. 🔴 PRERREQUISITO — sin esto, la pantalla no sirve

**Esta pantalla asume que al escanear, las líneas llegan con artículo y formato ya resueltos.**
Si el casado no acierta, quien recibe se encuentra doce preguntas en el móvil y abandona a la tercera
— exactamente lo que ya pasó con Pamela en junio: *"del 3º o 4º apenas miraba lo que hacía"*.

**Estado medido el 13/08:** 97 líneas sin casar en producción. **Verificar en vivo que el casado
automático (PR #56, mergeado el 12/08 a las 00:15) resuelve la mayoría antes de construir esta
pantalla.** Si no lo hace, arreglar el casado va PRIMERO.

---

## 8. Fases

| Fase | Contenido | Depende de |
|---|---|---|
| **P0** | **Verificar el casado en vivo** con una recepción real | — |
| **P1** | Pantalla de quien recibe (móvil): línea colapsada, +/−, pregunta de formato, "Recibir y meter al stock" | P0 |
| **P2** | Pantalla de oficina: edición completa, enlace a pedido, cuadre del total, motivo en cantidad + ajuste de stock | P1 |
| **P3** | Métrica de tasa de corrección y propuesta de apagado | P2 |
| **P4** | Modo `directo` (una sola pantalla con precios) | P1 |

---

## 9. Decisiones tomadas (Julio, 13/08)

- ✅ La cantidad se puede editar en oficina, **con motivo**.
- ✅ Dos modos según `receipt_approval`, un solo componente. **Nada específico de Foodint.**
- ✅ La pregunta de formato vive donde está la mercancía, no en oficina.
- ✅ El stock entra al recibir.
- ✅ Se pide importe total de línea, no unitario.

### Pendientes
- El umbral de 30 recepciones: ¿vale, o se ajusta?
- `negotiated_price` (precio de referencia del artículo) **no se edita aquí** a propósito — su sitio
  es la ficha del ingrediente. Mezclarlo en la recepción hace que un error puntual contamine la carta.
  ¿Se confirma?
