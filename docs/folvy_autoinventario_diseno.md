# Folvy — Autoinventario IA (cycle counting por cobertura de valor en riesgo)

**Diseño para aprobación. No se ha tocado código.**
RECON hecho: tablas de conteo/stock existen; `abc_class`, `variance_*`, `within_tolerance`,
`recount_of` ya en `inventory_count_line`; `qty_on_hand`/`avg_unit_cost`/`stock_value` en
`recipe_item_location_stock`; `stock_waste` recién creado. NO existe función de ABC ni de
cycle counting (a construir). `abc_class` hoy vacío.

---

## 0. Qué es y por qué golea

En vez de parar la cocina para un inventario completo (que nadie hace bien ni a menudo),
el sistema propone cada día un **muestreo dirigido**: cuenta unos pocos artículos, los que
importan, hasta alcanzar una **fiabilidad real** sobre el valor del inventario. Es muestreo,
no inventario.

**El hueco que nadie cubre:** MarketMan/xtraCHEF/Apicbase hacen cycle counting con cadencia
fija o listas manuales. Ninguno DIMENSIONA la muestra por fiabilidad, ni EXPLICA el porqué,
ni CIERRA el bucle hasta el food cost. Folvy hace las tres. No empata: golea.

---

## 1. El motor, en dos capas anidadas (decisión Julio: mezcla, pero jerarquizada)

**No** se suman tres criterios al mismo peso. Se anidan en dos planos:

### Capa 1 — el QUÉ (priorizar: qué artículos entran en la cola)
Cada artículo recibe una PRIORIDAD que combina:
- **Valor** — su peso en € del inventario (`stock_value`). ABC clásico: el ~20% de
  artículos concentra el ~80% del valor.
- **Rotación** — lo que más se mueve se descuadra más (del consumo teórico ventas×escandallo).
- **Riesgo** — su historial de desviación en conteos previos (`variance_*`) + mermas
  registradas (`stock_waste`). Lo que ya dio sustos sube.

Pesos CURADOS por defecto (buenos para hostelería). No se exponen como sliders al gerente
(sobre-ingeniería SMB). El gerente fija el OBJETIVO, no el motor.

### Capa 2 — el CUÁNTO (dimensionar: hasta dónde contar hoy)
NO un número fijo (el "3-5 al día" era inventado, descartado). El sistema cuenta artículos
de la cola priorizada **hasta alcanzar el objetivo de cobertura**. Día con anomalías →
cuenta más; día tranquilo → menos. El número sale del objetivo.

**Honestidad técnica (Julio, no vender humo):** no es un p-valor de muestreo de auditoría
(el inventario de cocina es muy sesgado, no población homogénea aleatoria). Es una métrica
de **COBERTURA DE VALOR EN RIESGO**: qué % del valor que importa has verificado en la
ventana reciente. Se vende como "fiabilidad real por cobertura", NO como "estadística"
a secas. Eso sí es defendible como golazo.

---

## 2. Quién cuenta (decisión Julio: trabajador fichado)

El sistema elige al contador, con reglas:
- **Solo elegibles los FICHADOS** en ese local/turno (ata autoinventario ↔ fichaje, que ya
  existe en Personal).
- **No siempre el mismo** (rota entre los fichados).
- **No su propia zona** (quien cocina una partida no se autocuenta — control anti-sesgo).

---

## 3. Variaciones → food cost (la pieza que diseñó Julio, el cierre del bucle)

La variación del conteo es el PUENTE entre food cost teórico y real:
- **Teórico** = ventas × escandallo (lo que deberías haber gastado).
- **Real** = compras − variación de inventario (lo que de verdad se fue).
- La **variación no explicada por ventas = MERMA REAL**; su valor (`variance_value`,
  a `avg_unit_cost`) **se suma al food cost real**. La diferencia teórico↔real = € evaporado.

### Valoración + explicación de faltantes (real / teórica)
Cada faltante se valora a su coste y se EXPLICA, en dos niveles:
- **REAL (documentada):** si hay `stock_waste` que lo justifica → "de 3 que faltan, 2
  explicados: 1 caducado, 1 rotura".
- **TEÓRICA (propuesta IA):** el resto sin documentar → la IA propone causa probable por
  patrón ("se desvía siempre en finde → probable sobreporción en servicio fuerte";
  "merma de manipulación típica de fresco"). PROPONE, no afirma ("IA propone, humano
  decide"). Confianza visible.

Lo no explicado **realimenta el RIESGO** de la capa 1 → ese artículo se cuenta más. Bucle
que se afina solo: lo que baila se vigila, lo estable se espacia.

---

## 4. Configurable (decisión Julio: sí, el objetivo, no el motor)

- **Configurable (gerente):** el OBJETIVO de cobertura/fiabilidad ("estándar / alta /
  exhaustiva" o % objetivo) + el umbral de tolerancia de anomalía (`within_tolerance`,
  ya existe, default 5%).
- **NO configurable (curado):** los pesos valor/rotación/riesgo del motor. Modo avanzado
  oculto como mucho. Principio Julio: "set curado, la empresa enciende/apaga lo que usa".

---

## 5. Didáctico en dos idiomas (decisión Julio: Folvy es didacta)

Ningún competidor explica POR QUÉ manda contar algo (cajas negras). Folvy lo dice en
lenguaje humano:
- **Cocinero:** una frase por artículo. "Cuenta el aceite (de los que más € mueven) y el
  solomillo (la última vez bailó 8%)." Sin jerga.
- **Gerente:** panel que enseña el método. "Contamos por valor en riesgo: el 20% de tus
  artículos concentra el 80% del valor; los vigilamos a menudo. Hoy cubres el 73% del valor
  en riesgo del mes." Con detalle abrible: prioridad de cada artículo, fiabilidad acumulada.

Convierte el autoinventario de "tarea impuesta" en "sistema que enseña a controlar el
negocio". Marca Folvy.

---

## 6. Orden de construcción (por capas, deuda 0, ritual completo)

- **A1 — ABC / valoración:** función que calcula valor+ABC por artículo×local desde
  `recipe_item_location_stock` (`abc_class` hoy vacío). Base de la capa 1.
- **A2 — Score de prioridad (QUÉ):** valor+rotación+riesgo → cola priorizada. Pesos curados.
- **A3 — Dimensionado (CUÁNTO):** recorrer la cola hasta el objetivo de cobertura. Genera
  un `inventory_count` dirigido (kind nuevo: 'cycle'/'auto') con sus líneas.
- **A4 — Asignación de contador:** elegir fichado, rotar, no-su-zona.
- **A5 — Variación → food cost + explicación:** al aprobar el conteo, sumar merma real al
  coste, valorar faltantes, explicación real (stock_waste) + teórica (IA propone),
  realimentar riesgo.
- **A6 — Capa didáctica:** los dos idiomas (cocinero/gerente) sobre lo anterior.

Cada capa es usable sola. A1-A3 ya dan el "qué cuento hoy y cuánto". A5 cierra el food cost.

---

## 7. RECON pendiente (corto, antes de construir A5)

Confirmar dónde vive el food cost teórico hoy (¿vista? ¿menu_item_economics pendiente?
¿motor de coste de escandallo?) para enganchar A5 sin suponer. Se hace justo antes de A5,
no ahora.

---

## 8. Benchmark a cerrar antes de A2 (ritual)

Verificar cómo hacen cycle counting MarketMan, xtraCHEF, Apicbase (cadencia, selección,
si dimensionan muestra, si explican). Confirmar que el dimensionado por cobertura +
explicación + cierre a food cost es diferencial real. Hacer antes de diseñar el score (A2).
