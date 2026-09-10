# PARTE · Contar por formatos, y que un recuento malo no se apruebe solo

**Encargo del 10/09/2026 · maqueta de 5 pantallas aprobada por Julio ese mismo día**
Rama `claude/conteo-formatos-validacion-pwbctk`.

---

## Lo primero: qué está hecho y qué espera a Julio

| | |
|---|---|
| **Construido y en la rama** | Diez migraciones, cinco pantallas, tres servicios nuevos, 22 pruebas nuevas |
| **Aplicado en producción** | **NADA.** Ninguna migración se ha ejecutado |
| **Lo que hay que hacer ahora** | El ensayo del coste medio (§2.5) con Julio delante, y después aplicar |

Las migraciones se proponen, no se aplican: es la regla de la casa. Y dos de
ellas (`p1`, el valor inicial de `use_in_count`; `p8`, el coste medio) tocan
datos de producción, así que su ensayo va escrito abajo con los números
medidos y con la consulta que los saca.

Van dos guiones listos para pegar:

- `supabase/verificacion/20260910_conteo_por_formatos.sql` — los nueve puntos
  del §4, para ejecutar **justo después** de aplicar. Lo que escribe va en
  transacciones que terminan en `ROLLBACK`.
- `supabase/verificacion/20260910_recalcular_coste_medio.sql` — el recálculo
  de las 453 filas, en dos pasos: el PASO 0 no escribe.

---

## §1 · RECON. Lo que encontré, y en qué discrepo del encargo

Todo medido el 10/09 en la cuenta **Foodint** (`51ad1792-…`). Regla 9: las tres
cuentas comparten tablas Y NOMBRES, y `Folvy Interno` tiene tres locales que se
llaman exactamente igual que los de producción. Ninguna cifra de este parte
sale de una consulta sin `account_id`.

### Confirmado, con el número exacto

| Punto del encargo | Lo que da la BBDD |
|---|---|
| 194 artículos contados desde el 10/08 | **194** · 141 con formato, **53 sin ninguno** |
| 26 artículos con formatos repetidos de distinto peso | **26** |
| 20 con un formato «Ud / Uni / Unidad / U» | **20** (12 de ellos con peso ≠ 1) |
| 453 filas artículo × local activas | **453** |
| 120 sin coste medio | **120** |
| 50 con coste medio negativo | **50** |
| `tg_..._sanity` sólo frena por arriba | Confirmado |
| `check_count_variance` devuelve low/high/ok contra el teórico vivo | Confirmado |
| `close_inventory_count` usa `COALESCE(avg_unit_cost, 0)` | Confirmado |
| `recompute_location_stock_core` = `SUM(qty×coste)/SUM(qty)` sobre todo el libro | Confirmado |
| `reason_code` CHECK con los 8 códigos | Confirmado |

### Donde el número no me sale

**«27 filas a más de ×3 del coste de ficha».** A mí me salen **6** con
`avg_unit_cost > 3 × COALESCE(computed_cost, fixed_cost)`, y **10** si comparo
el valor absoluto. No he encontrado la definición que da 27. No cambia ninguna
decisión —los 120 sin coste y los 50 negativos, que son lo grave, cuadran
exactos— pero va dicho: si esa cifra iba a algún sitio, no la respaldo.

### Cuatro cosas que el encargo no dice y sí importan

**1 · El trigger de cordura SÍ frena una cosa por abajo: el negativo.** Rechaza
`counted_qty < 0`. Lo que no tenía es la banda proporcional por abajo, que es
lo que dejó pasar el solomillo. Lo digo porque «nunca por abajo» hacía pensar
que no había nada allí.

**2 · El front escribía `counted_qty` con un UPDATE directo, y el veredicto de
variación llegaba TARDE.** Esto es el corazón del asunto y estaba a la vista en
`MiAutoinventario.tsx`:

```
await saveCountedQty(...)                    // ← ya está guardado
const verdict = await checkCountVariance(...) // ← y AHORA se pregunta
if (verdict === 'low' || verdict === 'high') setPhase('warn')
```

Y en la pantalla del aviso, el botón «Está bien, es correcto» llamaba a
`advance()`, que **no guarda nada porque ya estaba guardado**. El 0 del
peperoni no «pasó igual» a pesar del aviso: pasó porque el aviso no frenaba
nada. Era decorativo por construcción.

**3 · El origen de los 211 «otro».** No hay valor por defecto ni paso
automático que lo escriba. Lo que hay es peor de detectar: el clasificador
local `classifyCauseConCobertura` devuelve

```
{ reasonCode: 'otro', label: 'No atribuible', confidence: 'high' }
```

cada vez que no sabe atribuir la diferencia — y la pantalla lo enseña como
«El sistema cree: **No atribuible**» con un botón **Usar** al lado. Un clic por
línea. Es honesto en la etiqueta y deshonesto en el efecto: `apply_inventory_count`
sólo mira si `reason_code` está relleno, así que ese «no lo sé» **desbloquea la
aplicación del ajuste** igual que un «merma».

Medido en Foodint, recuentos aprobados del 1 al 9 de septiembre:
**212 «otro», y las 212 fuera de tolerancia.** Frente a 11 `error_escandallo`,
9 `merma`, 5 `error_recepcion` y 3 `robo_desconocido`. Los 152 sin motivo del
mismo periodo están **todos dentro de tolerancia**, así que los «35 sin motivo»
del encargo salen de otra ventana o de otro local.

No se ha quitado el clasificador: se ha quitado que «otro» salga gratis. Ahora
«otro» sin nota **no entra en la tabla** (CHECK en BBDD, no validación de
pantalla), y la lista de motivos tiene dos entradas nuevas —«Se usó sin
apuntar» y «Se contó mal»— que son donde iba a parar media de esa pila.

**4 · Hay un BUCLE que fabrica costes negativos.** `apply_inventory_count`
escribe cada ajuste con `unit_cost = COALESCE(ril.avg_unit_cost, 0)`. Así que un
coste medio negativo genera movimientos de coste negativo, que vuelven a
alimentar el coste medio. En Foodint hay **10.044 movimientos con `unit_cost < 0`**:
9.957 son salidas (que con la fórmula nueva ya no tocan la media) y **87 son
entradas**, que son las únicas que podían dejar el coste nuevo en negativo. Por
eso la media perpetua sólo se mueve con entradas de coste **> 0**, no «no nulo»:
es la lección de la regla 3 —cero no es NULL— aplicada al negativo.

**5 · `recount_of` existe en la tabla desde `20260604T3400` y no lo usa nadie.**
Ni una línea de `src`, ni una función. Ahora lo usan `request_recount` y
`_generate_daily_count_core`.

---

## §2 · Lo construido, paso a paso

Diez migraciones, una por paso, en `supabase/migrations/`:

| Fichero | Qué hace |
|---|---|
| `…090000_conteo_p1_use_in_count.sql` | La columna + el valor inicial |
| `…090500_conteo_p2_inventory_count_entry.sql` | Cómo se contó |
| `…091000_conteo_p3_columnas_y_umbrales.sql` | `needs_review`, `reason_note`, motivos nuevos, umbrales |
| `…091500_conteo_p4_save_count_line.sql` | La puerta única + el freno + `clear_count_line` |
| `…092000_conteo_p5_cordura_simetrica.sql` | La red, ahora por los dos lados |
| `…092500_conteo_p6_aprobacion_y_recuento.sql` | Lo que no se aplica solo + `request_recount` |
| `…093000_conteo_p7_recuentos_en_el_siguiente.sql` | El recuento pedido entra en el siguiente autoinventario |
| `…093500_conteo_p8_coste_medio_perpetuo.sql` | El € de verdad |
| `…094000_conteo_p9_formatos_revisados.sql` | «Confirmar» deja el artículo revisado |
| `…094500_conteo_p10_contexto_de_revision.sql` | Los hechos para escribir la contradicción |

### §2.1 · El ensayo del valor inicial de `use_in_count`

Sale `true` el formato **activo** cuyo nombre normalizado no se repite con otro
peso en el mismo artículo, que no se llama `ud/uni/unidad/u`, y —añadido mío—
cuyo peso es > 0.

```
Foodint        275 activos → 189 true · 86 false
                 (23 por nombre de unidad · 63 por choque de peso)
                 138 de los 194 artículos contados quedan con formato de conteo
Folvy Interno  306 activos → 206 true · 100 false  (24 · 76)
```

Los que esperan decisión, primero los que más se cuentan:

| Artículo | Recuentos | Lo que choca |
|---|---:|---|
| Milanesa Ternera Rebozado | 39 | «Ud» = **0,25 ud** — un cuarto de milanesa |
| Queso Gouda Loncheado | 33 | Paquete 500 g / Paquete 1 kg |
| Pulled Pork | 31 | Bolsa 1 / 1,3 / 4 kg · Caja 6 / 6,5 kg |
| Queso Mozarela | 30 | Bolsa 1 / 1,5 / 2 kg |
| Pan Hamburguesa | 28 | Caja 60 ud / Caja 80 ud |
| Tortilla Maíz 12 cm | 27 | «Ud» = 20 tortillas |
| Lechuga Romana | 26 | «bolsa» 1 kg / «Bolsa» 400 g / «Bolsa» 650 g |

**La guarda `qty_in_base > 0` no sale del encargo.** La puse porque un formato
de peso cero convierte cualquier cantidad contada en 0 sin avisar. Hoy no
cambia nada: **0 formatos activos con peso ≤ 0** en las tres cuentas. Es red
para el día que alguien cree uno.

Y **Milanesa Ternera es la razón de que la regla sea `≠ 1` y no `> 1`**. Con
`> 1`, ese «Ud» de 0,25 pasaba limpio y quien contara 4 «Ud» estaría apuntando
1 milanesa, no 4. Lo cazó la prueba **porque está escrita contra los nombres
reales del catálogo**; con ejemplos inventados habría salido en verde.

### §2.2 · La puerta única

`save_count_line(p_line_id, p_entries, p_confirm)` es **la única** forma de
escribir un conteo. El móvil manda el CÓMO; el servidor decide el CUÁNTO.

Los cuatro métodos: `formato` · `peso` · `fraccion` (¼ ½ ¾ a ojo) · `cero`.
Y un array vacío **no** es un cero: para dejar una línea sin contar hay una
llamada distinta con un nombre distinto, `clear_count_line`. No es
puntillosidad: un array vacío es justo lo que llega cuando el front se
equivoca, y si eso significara «no hay nada» estaríamos escribiendo ceros por
accidente en el libro de stock.

**Los dos intentos se guardan**, con `attempt` 1 y 2. Sin eso, la pantalla de
aprobación no puede decir «primero puso 0 y al volver a mirarlo puso 8,5 kg»,
que es la frase que hacía falta la noche del peperoni.

Nace privada: `REVOKE` de `PUBLIC`, `anon` y `authenticated`, y `GRANT` sólo a
`authenticated`. Y lleva `DROP FUNCTION IF EXISTS` delante de las dos firmas,
por la regla 2 —añadir un parámetro es DROP + CREATE— aunque aquí nazca en la
misma migración.

### §2.3 · El freno, y una contradicción del encargo

Dos referencias, ninguna de las dos vuelve al móvil:

- **(a)** el teórico vivo (`theoretical_qty_at`): ≥ ×3 o ≤ ⅓ → `recount`;
- **(b)** el **último recuento aprobado** del mismo artículo y local, más lo
  movido desde entonces sin contar inventario: apartarse ≥ 40 % **sin
  recepciones de por medio** → `recount`.

La (b) es la que faltaba y la que habría parado el peperoni.

> ### La contradicción, y cómo se resuelve
>
> **§4.3** pide que «25» contra 35 kg devuelva `recount`. **§2.3** pide un
> disparador de cordura simétrico, y con el factor de hoy (1.000) ese mismo 25
> cae por debajo de 35.006/1.000 = 35 y sería **rechazado con excepción** antes
> de que nadie pudiera devolver un veredicto. Los dos puntos del mismo encargo
> piden cosas incompatibles sobre el mismo número.
>
> **Se resuelve por el orden, sin bajar ninguno de los dos.** El freno se
> evalúa ANTES de escribir. Si sale `recount`, la línea **no se sella** —las
> entradas del intento sí se guardan, no se pierde lo que tecleó— y el
> disparador no llega a verlo. El disparador queda para el segundo guardado y
> para cualquier escritura que no pase por la puerta: la red, no el freno, que
> es literalmente lo que dice §2.3.
>
> Y encaja con la maqueta: la pantalla 3 enseña las casillas **vacías**. No por
> estética — las enseña vacías porque ese recuento aún no está.

**El cero queda fuera de la red por abajo, a propósito.** «No queda nada» es la
respuesta más común del almacén y contra un teórico positivo cae por debajo de
cualquier umbral: una red que lo atrapara haría imposible decir la verdad. Del
cero se ocupa el freno (b), que sabe mirar el recuento anterior.

**El segundo guardado se compara con el TOTAL DEL PRIMER INTENTO**, que está en
las entradas — no con `counted_qty`, que en un `recount` se quedó sin escribir.
Comparar contra un NULL habría hecho que «lo he mirado bien: es lo que hay»
acabara **siempre** en `needs_review`, y entonces «Confirmado 2 veces» sería una
etiqueta que está en la pantalla y no puede salir nunca.

### §2.4 · Aprobación

- `apply_inventory_count` en modo parcial **ya no aplica** una línea
  `needs_review` sin motivo, y `autoclose_daily_count` las cuenta como
  pendientes para no dejar el recuento en «aprobado» con cosas esperando.
  Es el éxito silencioso de la regla 8, un piso más abajo.
- **«Otro» sin nota no se puede guardar.** CHECK en la BBDD, `NOT VALID`: las
  212 líneas ya aprobadas de septiembre son historia y no se reescriben
  —reescribirlas sería inventarles un motivo que nadie dijo— pero ninguna fila
  nueva puede entrar así.
- **Recontar** crea la línea con `recount_of`, **asignada a otra persona**. Si
  la que se propone es quien contó, se busca a otro; si no hay nadie más, entra
  sin asignar y la reparte el round-robin. Volver a preguntarle a quien ya
  contestó no es un segundo recuento: es la misma respuesta otra vez.
- `_generate_daily_count_core` mete los recuentos pedidos **primero**
  (posición negativa): es lo que alguien ha pedido a mano, no lo que el motor
  ha elegido.

### §2.5 · El coste medio · **ENSAYO, PARA MIRAR ANTES DE APLICAR**

Media ponderada perpetua recorriendo el libro en orden. Las salidas no tocan la
media; `max(qty_antes, 0)` impide que un stock negativo la envenene; sin
entradas con coste se usa el de ficha; sin eso, **NULL — nunca 0 callado**.

```
Foodint · 453 filas artículo × local activas

                       ANTES        DESPUÉS
  sin coste              120             49
  coste negativo          50              0     ← §4.6
  cambian                              334
  valor total       41.442,43 €   49.181,59 €

  Foodint Alcalá     196 filas · neg 11 → 0 · 34.566,95 → 38.442,12 €
  Foodint Carabanchel 139 filas · neg 23 → 0 ·  2.551,01 →  5.777,71 €
  Foodint Plaza Cast. 118 filas · neg 16 → 0 ·  4.324,47 →  4.961,76 €
```

Las que más se mueven, con su nombre:

| Artículo · local | Coste antes | Coste después | Valor antes | Valor después |
|---|---:|---:|---:|---:|
| CAJA GENERICA 780 Ml · Alcalá | 0,1596 | 6,5461 | 79,80 | 3.273,06 |
| Tarta 3 Leches · Carabanchel | 0,5854 | 3,1580 | 120,02 | 647,39 |
| Aceite Oliva Suave · Carabanchel | 0,0008 | 0,1070 | 3,74 | 526,42 |
| Pollo Mechado · Carabanchel | **−0,0030** | 0,0109 | −81,38 | 297,53 |
| **Albahaca · Plaza Castilla** | **7,1536** | **0,0278** | **294,68** | **1,14** |
| Carne de Birria · Carabanchel | **−0,0062** | 0,0192 | −62,08 | 193,03 |
| Hamburguesa Mixta · Plaza Cast. | **−0,0266** | 0,7482 | −7,04 | 198,26 |
| Milanesa de Pollo · Carabanchel | 0,6181 | 1,8686 | 101,10 | 305,63 |
| **Tortilla Trigo 30 cm · Carabanchel** | **5,2209** | **0,2293** | **187,95** | **8,25** |
| Patatas Bastón · Carabanchel | **−0,0006** | 0,0017 | −48,30 | 129,53 |

**Las dos en negrita que BAJAN son las que hay que mirar despacio.** Albahaca
pasa de 7,15 €/g a 0,03 €/g y Tortilla Trigo de 5,22 €/ud a 0,23 €/ud. No es
que la fórmula nueva se equivoque: es que la vieja estaba promediando un libro
con las salidas dentro. Pero un artículo que pierde el 99 % de su valor merece
que alguien que conoce el producto diga «sí, la tortilla de trigo cuesta
23 céntimos», y eso no lo puedo decir yo.

Los tres que nombra el §4.6:

| | Antes | Después |
|---|---:|---:|
| Coca-Cola Zero Lata · Carabanchel | **−48,73 €** | 26,86 € |
| Coca-Cola Original Lata · Carabanchel | **−68,04 €** | 35,50 € |
| Carne de Birria · Carabanchel | **−62,08 €** | 193,03 € |
| Carne de Birria · Alcalá | 101,14 € | 101,12 € |
| Carne de Birria · Plaza Castilla | 370,74 € | 370,74 € |

`close_inventory_count` valora con ese coste y, sin coste, deja
`variance_value` en **NULL**. La pantalla dice «sin coste» y la franja de valor
dice aparte cuántas líneas no puede sumar. El único 0 que se queda es el del
saneamiento de negativos, y ahí el 0 es un cero de verdad —«esto no es una
pérdida»—, no un «no lo sé» disfrazado.

**Esto no se aplica solo.** El guion
`supabase/verificacion/20260910_recalcular_coste_medio.sql` tiene el PASO 0 sin
escribir, el PASO 1 comentado, y el PASO 2 —recalcular `variance_value` de los
aprobados desde el 01/08— también con su ensayo delante.

### §2.6 · Formatos en oficina

`Almacén › Cómo se cuenta` (`/supply/formatos-conteo`). Marcar, renombrar,
archivar y confirmar. **Archivar no borra**: `archived_at` + `is_active=false`,
y los albaranes y pedidos antiguos siguen apuntando a su id.

Mientras un artículo no tenga ningún formato de conteo, el móvil lo pide sólo
en su unidad base. **Folvy no elige** cuál de las tres bolsas de Pulled Pork
llega hoy: eso es un hecho del negocio y se pregunta.

---

## §3 · Diseño

Las cinco pantallas pintan con `cocinaTokens.css` —los mismos tokens de la
maqueta de Kitchen que aprobó Julio: `--ground #EAEEF1`, `--accent #0E5A5E`,
radios de 2-3 px, Archivo, cifras en IBM Plex Mono tabular— y reutilizan las
piezas de `PatronDeKitchen.tsx` en las dos de escritorio.

Las capturas del móvil a 390 px, **al lado de la maqueta**:
`docs/capturas/conteo_movil_comparacion_20260910.png`.

Están pintadas con las **piezas reales** de la pantalla y el CSS del build, no
con un HTML escrito para la foto — por eso las piezas salieron de
`MiAutoinventario.tsx` a `ConteoMovilPiezas.tsx`. Una foto que inventa su
marcado enseña una pantalla que no existe.

### Tres cosas que sólo se vieron en la captura

**1 · La caja de la báscula se salía de la tarjeta.** Con el `input` a
`w-full`, la caja crecía hasta el ancho por defecto de un `input[type=number]`
—unos 20 caracteres— y se llevaba por delante la «g» de la derecha, dejando
«Abierto o suelto» partido en tres líneas. Fijadas a 148 px de caja y 68 de
campo. Leyendo el código no se veía.

**2 · «2 bolsa cerradas».** Mi regla de plural añadía una ese al final del
nombre entero. En castellano «bolsa cerrada» hace «bolsas cerradas» —concuerdan
las dos palabras— y no hay regla general para eso. Ahora sólo se pluraliza un
nombre de UNA palabra («2 bolsas», que es lo que dice la maqueta); con dos o
más se escribe «2 × Bolsa cerrada», que nunca está mal.

**3 · «Otra» se leía «0tra».** El placeholder heredaba IBM Plex Mono, cuya O
mayúscula lleva barra dentro y se lee como un cero. Las cifras siguen en mono;
las palabras, no.

### Una desviación de la maqueta, dicha a las claras

La maqueta pone **«Bolsa abierta, a ojo»**. Eso sólo funciona con nombres
femeninos, y en el catálogo real de Foodint los formatos que se abren son
**«Paquete», «Estuche», «Bote» y «Manojo»**: la frase de la maqueta escribe
«Paquete abierta, a ojo». Lo vi mirando los nombres de verdad, no el ejemplo.

Está construido como **«Lo abierto, a ojo» / «¿Cuánto queda de Bolsa · 2,5 kg?»**,
que no tiene género y además dice algo que a la maqueta le faltaba: **de qué**
es la fracción. Un «½» sin decir de qué es lo mismo que el número pelado que
venimos a quitar. Si Julio prefiere la frase de la maqueta, es una línea.

---

## §4 · Verificación

### Lo verificado sobre datos reales, ya

**§4.2 · El peperoni.** Simulé la decisión de `save_count_line` sobre la fila
real (INV-00202, Foodint Alcalá):

```
anterior_quien   Pamela Guzman Velásquez
anterior_qty     9000
anterior_cuando  2026-09-03 21:00:01  (Madrid)
movido           −125          hubo_entrada  false
referencia       8875          desvio        100,0 %
veredicto        recount
```

**§4.3 · El solomillo.** La fila existe y es exactamente la del encargo:
INV-00162, **Foodint Carabanchel, 14/08/2026, contado 25 g contra 35.006 g de
teórico, y aprobado**. Con el freno: 25 ≤ 35.006/3 = 11.669 → `recount`.

**§4.6 · 0 filas con coste negativo.** Simulado sobre el libro entero de las
453 filas: **50 → 0**. Números completos arriba.

**§4.7 · `git grep` de escrituras directas a `counted_qty` desde el front:**

```
src/modules/supply/services/autoinventoryService.ts:329   lectura
src/modules/supply/services/autoinventoryService.ts:399   lectura
src/modules/supply/services/autoinventoryService.ts:435   .is('counted_qty', null)
src/modules/supply/services/inventoryCountService.ts:328  lectura
src/modules/supply/services/inventoryCountService.ts:356  lectura
```

**Ninguna escritura.** `saveCountedQty` **se ha borrado**, no marcado como
obsoleta: una función que escribe `counted_qty` a mano y sigue exportada es una
función que alguien usará dentro de seis meses sin saber que se salta el freno.

**§4.8 · Capturas a 390 px al lado de la maqueta.** Hechas, arriba.

**§4.9 · `tsc -b` exit 0.** Sí. Migraciones en `supabase/migrations/`.

### Lo que espera a que se apliquen las migraciones

§4.1 (Patatas Bastón → 5750 y 2 entradas), §4.2 y §4.3 **contra la respuesta
cruda de la RPC**, §4.4 (`needs_review` no la aplica el autocierre) y §4.5
(«otro» sin nota). Están escritos y listos en
`supabase/verificacion/20260910_conteo_por_formatos.sql`, con sus `ROLLBACK`.

**`database.ts` NO está regenerado**, y es lo único del §4.9 que falta. Los
tipos se generan **contra la BBDD**, y la BBDD no tiene las funciones nuevas
hasta que Julio aplique. Mientras tanto, `save_count_line`, `request_recount`,
`clear_count_line` y `count_review_context` se invocan con el cliente sin tipar
—el mismo patrón que ya usa `inventoryCountService.ts` con `avt_cause_context`,
con la deuda escrita en el fichero. Después de aplicar:

```
npm run types:gen
```

y se quita el ayudante `rpc()` de `countEntryService.ts`.

### Medido a los dos lados, con la misma vara

| | `origin/main` | Con el cambio |
|---|---|---|
| `tsc -b` | exit 0 | **exit 0** |
| `eslint src` | 761 errores · 268 avisos | **761 · 268** |
| `vitest run` (con `dist`) | 1.042 pasan · 6 fallan | **1.064 pasan · 6 fallan** |

Los 6 que fallan son los mismos seis de antes (`routes`, `brandsService`,
`salesChannelsService`) y no los toca nada de aquí. Los 22 nuevos son míos.

**Los dos errores de lint que sí añadí** eran `setState` en el cuerpo de un
efecto, en las dos pantallas nuevas. Movidos dentro de la función asíncrona, el
número vuelve exacto. Sin medir los dos lados se habrían ido con un «no he roto
nada» encima — que es la regla 31 pagándose sola otra vez.

### Las pruebas nuevas, y contra qué están escritas

`tests/unit/modules/supply/formatosDeConteo.test.ts` (14) va contra los
formatos **copiados de la BBDD**, con sus ids y sus faltas de ortografía
(«bolsa» y «Bolsa» en Lechuga Romana, «caja» en Milanesa). La consulta que los
saca está escrita en la cabecera del fichero.

`tests/unit/modules/supply/contradiccionRecuento.test.ts` (7) va contra los
tres recuentos reales del peperoni del 3, 4 y 5 de septiembre, con sus nombres
y sus horas.

`tests/unit/modules/supply/capturaConteoMovil.test.tsx` (1) escribe las tres
capturas y comprueba dos cosas: que el marcado no lleve clases del Folvy viejo
—medido sobre el **marcado**, no sobre el fichero, porque el CSS del build
lleva compiladas todas las clases de la app y buscarlas ahí da positivo
siempre— y que en ninguna de las tres aparezcan **8875** ni **9000**. Si
aparecieran, el freno habría dejado de ser ciego.

---

## §5 · Lo que hace falta de Julio, en orden

1. **Leer el ensayo del coste medio de arriba**, en especial Albahaca y
   Tortilla Trigo 30 cm.
2. **Aplicar las diez migraciones** por orden de nombre.
3. **Ejecutar** `supabase/verificacion/20260910_conteo_por_formatos.sql` y
   pegar el resultado.
4. **PASO 0** de `20260910_recalcular_coste_medio.sql` (no escribe). Si cuadra
   con las cifras de arriba, descomentar el PASO 1 y el PASO 2.
5. `npm run types:gen`.
6. Abrir **Almacén › Cómo se cuenta** y decidir los formatos de los siete
   artículos de la tabla del §2.1 — sobre todo Pulled Pork, que se cuenta 31
   veces al mes con cinco formatos y ninguno marcado.

## §6 · Lo que NO va aquí, y no va

Unidad base de ficha con conversión · fiabilidad por empleado dentro de Folvy ·
FEFO y lotes · traspasos entre locales. Nada de eso se ha tocado.
