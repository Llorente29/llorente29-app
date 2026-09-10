# PARTE · Contar por formatos, y que un recuento malo no se apruebe solo

**Encargo del 10/09/2026 · maqueta de 5 pantallas aprobada por Julio ese mismo día**
Rama `claude/conteo-formatos-validacion-pwbctk`.

> ## Segunda vuelta · respuesta a las correcciones de Julio
>
> **§1.1 · Sólo las recepciones mueven la media.** Tenía razón y el caso que lo
> prueba es suyo: el ajuste de 31 ml de Aceite de Oliva del 05/08 entraba con
> 0,1070 €/ml —el coste medio viejo, arrastrado— y se convertía en la media
> nueva. **107 € el litro de aceite.** Ahora mueven la media sólo
> `goods_receipt_line` y `traspaso_entrada`. Y `apply_inventory_count` escribe
> sus ajustes con `avg_unit_cost` a secas, NULL incluido: ahí se cierra el
> bucle.
>
> **§1.2 · Una recepción con el coste mal puesto envenena la media nueva.**
> También cierto. Banda de ×5 contra el coste de ficha, en
> `supply_settings.cost_band_factor`. CAJA GENERICA 780 Ml pasa de 6,5461 €/ud a
> **0,2014**, y sus 3.273 € de stock inventado a 100,72 €.
>
> **Y una cosa que sale de listar las 53:** en **21 de los 23** artículos la
> mediana de sus recepciones coincide con la ficha, o sea que la banda está
> dejando fuera exactamente la línea rara. En **dos no**, y ahí la rara es LA
> FICHA — están abajo con nombre. Esa columna va en el ensayo, porque es la que
> dice qué corregir.
>
> **§1.3 · Albahaca y Tortilla Trigo.** Comprobado y coincide: ya no las
> pregunto.
>
> **§2 · Las cuatro de pantalla**, hechas. La primera era la peor y tenía razón
> dos veces: «Bolsa cerrada abierta, a ojo» decía «cerrada» de una bolsa
> abierta. Ahora el título sale del ENVASE —la primera palabra— y el género de
> una regla probada contra los 24 nombres de formato que hay en el catálogo.
>
> **§3 · Las dos cifras.** Los «27» son 6 por arriba + 21 por abajo; los «35 sin
> motivo» caben dentro de mis 152. Anotado, nada que cambiar.
>
> **Sigue sin aplicarse nada.** El orden de §4 es el que se sigue.

---

## Lo primero: qué está hecho y qué espera a Julio

| | |
|---|---|
| **Construido y en la rama** | Diez migraciones, cinco pantallas, tres servicios nuevos, 22 pruebas nuevas |
| **Aplicado en producción** | **SÍ, el 10/09 con Julio delante.** Las diez migraciones y la fusión a `main`. Ver el registro al final |
| **Lo que hay que hacer ahora** | Los puntos 5, 6 y 7 del §5: `types:gen`, el recálculo del coste y decidir los formatos |

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

**«27 filas a más de ×3 del coste de ficha».** Resuelto por Julio: son **6 por
encima de ×3 más 21 por debajo de ⅓**. Mi consulta sólo miraba hacia arriba. No
cambia ninguna decisión.

**«35 líneas sin motivo».** También resuelto: son de Alcalá, sin las líneas de
Julio, y contando sólo las que tienen diferencia distinta de cero. Caben dentro
de mis 152, que son de los tres locales.

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

### §2.5 · El coste medio · **ENSAYO REHECHO, PARA MIRAR ANTES DE APLICAR**

Media ponderada perpetua recorriendo el libro en orden. **Sólo las recepciones
mueven la media**, y sólo si su coste está dentro de ×5 del coste de ficha. Los
ajustes de recuento, las mermas, las aperturas y las salidas mueven la cantidad
y no tocan el coste. `max(qty_antes, 0)` impide que un stock negativo la
envenene. Sin recepciones válidas se usa el coste de ficha; sin eso, **NULL —
nunca 0 callado**.

```
Foodint · 453 filas artículo × local activas

                       ANTES        DESPUÉS
  sin coste              120             49
  coste negativo          50              0     ← §4.6
  cambian                              339
  valor total       41.442,43 €   49.735,98 €

  Foodint Alcalá     196 filas · neg 11 → 0 · 34.566,95 → 38.486,15 €
  Foodint Carabanchel 139 filas · neg 23 → 0 ·  2.551,01 →  6.233,60 €
  Foodint Plaza Cast. 118 filas · neg 16 → 0 ·  4.324,47 →  5.016,23 €
```

**Los dos casos que puso Julio, resueltos:**

| | Primer ensayo | Con las correcciones |
|---|---:|---:|
| Aceite de Oliva Suave · Carabanchel | 0,1070 €/ml — **107 € el litro** | **0,0122 €/ml** |
| CAJA GENERICA 780 Ml · Alcalá | 6,5461 €/ud — **3.273,06 €** | **0,2014 €/ud — 100,72 €** |

**El total sube en vez de bajar, y hay que explicarlo.** Julio esperaba que
bajara porque la caja genérica sola aportaba 3.193 €. Baja por ahí, sí, pero
las dos correcciones empujan en los dos sentidos: la banda también deja fuera
recepciones ANORMALMENTE BARATAS —Pan de Pita a 0,0038 €/ud contra una ficha de
0,30, Coca-Cola a 0,0246 contra 0,5909, Servilletas a 0,0092 contra 0,2767— y
esos artículos pasan a valorarse por su ficha, que es mucho más alta. Neto:
49.181,59 € del primer ensayo → **49.735,98 €**. Son +554 €, no −3.193.

Las que más se mueven ahora, con su nombre:

| Artículo · local | Coste antes | Coste después | Valor antes | Valor después |
|---|---:|---:|---:|---:|
| Bolsas Personalizadas Birria Burrito · Alcalá | 0,1729 | 0,2151 | 8.644,69 | 10.754,00 |
| Bolsas Personalizadas Ay Mamita · Alcalá | 0,1622 | 0,1934 | 8.923,66 | 10.637,00 |
| Servilletas 30 x 40 · Carabanchel | 0,0166 | 0,1027 | 169,25 | 1.047,20 |
| **Tapa Salsero 120 Cc · Alcalá** | **2,8100** | **0,0045** | **562,00** | **0,89** |
| Tarta 3 Leches · Carabanchel | 0,5854 | 3,1580 | 120,02 | 647,39 |
| Bolsas Personalizadas Korean · Alcalá | 0,1742 | 0,1611 | 5.530,78 | 5.115,00 |
| Pollo Mechado · Carabanchel | **−0,0030** | 0,0109 | −81,38 | 297,53 |
| Albahaca · Plaza Castilla | 7,1536 | 0,0278 | 294,68 | 1,14 |
| Carne de Birria · Carabanchel | **−0,0062** | 0,0192 | −62,08 | 193,03 |
| Tortilla Trigo 30 cm · Carabanchel | 5,2209 | 0,2293 | 187,95 | 8,25 |

Los tres que nombra el §4.6:

| | Antes | Después |
|---|---:|---:|
| Coca-Cola Zero Lata · Carabanchel | **−48,73 €** | 26,86 € |
| Coca-Cola Original Lata · Carabanchel | **−68,04 €** | 27,63 € |
| Carne de Birria · Carabanchel | **−62,08 €** | 193,03 € |

#### Las 53 recepciones fuera de banda, y cuál es la rara

De las 911 recepciones con coste de Foodint, **53 se apartan más de ×5 de su
ficha, en 23 artículos**. La pregunta útil no es cuáles son, sino qué corregir
en cada una, y eso lo contesta comparar la ficha con la **mediana de TODAS las
recepciones del artículo**:

- **En 21 de los 23**, la mediana coincide con la ficha (ratio 1,00–1,25). Las
  recepciones concuerdan entre ellas y la ficha con ellas: la rara es esa línea
  suelta. Aquí la banda acierta y basta con corregir la recepción.
- **En 2 no**, y ahí la rara es la ficha:

| Artículo | Coste de ficha | Mediana de sus recepciones | |
|---|---:|---:|---|
| **Humus** | 0,0000072 €/g | 0,0065 €/g | ×900 |
| **Tapa Salsero 120 Cc** | 0,0045 €/ud | 0,0356 €/ud | ×8 |

En esos dos, la banda deja fuera las recepciones **buenas** y el artículo cae a
un coste de ficha que no vale: Tapa Salsero pasa de 562 € a 0,89 €. **No es un
fallo de la regla: es la regla diciendo dónde mirar.** Hay que arreglar la
ficha, no la recepción.

La lista completa, con nombre, fecha, cantidad, coste puesto, coste de ficha y
esa columna de veredicto, es el **PASO 0a** de
`supabase/verificacion/20260910_recalcular_coste_medio.sql`.

`close_inventory_count` valora con ese coste y, sin coste, deja
`variance_value` en **NULL**. La pantalla dice «sin coste» y la franja de valor
dice aparte cuántas líneas no puede sumar. El único 0 que se queda es el del
saneamiento de negativos, y ahí el 0 es un cero de verdad —«esto no es una
pérdida»—, no un «no lo sé» disfrazado.

**Esto no se aplica solo.** El guion tiene el PASO 0a y el 0b sin escribir, el
PASO 1 comentado, y el PASO 2 —recalcular `variance_value` de los aprobados
desde el 01/08— también con su ensayo delante.

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

### Las cuatro de la segunda vuelta

**1 · «Bolsa cerrada abierta, a ojo».** La peor, y Julio tenía razón dos veces:
decía «cerrada» de una bolsa que está abierta, y mi arreglo anterior —quitar el
género con «Lo abierto, a ojo»— esquivaba el problema en vez de resolverlo. El
género SÍ se puede sacar, y de donde ya se saca «Bolsa cerrada» y «Paquete
cerrado»: del **envase**, que es la primera palabra del nombre.

Ahora la frase es la de la maqueta —**«Bolsa abierta, a ojo» · «¿Cuánto queda en
ella?»**— con la cantidad de referencia debajo en gris: «bolsa de 2,5 kg».

La regla de género está probada contra **los 24 nombres de formato que existen
en el catálogo de Foodint**, con sus faltas de ortografía («Carton» sin tilde,
«PPaquete» con dos pes) y con el formato que se llama literalmente «1». Y esa
lista es la que obligó al segundo tramo de la regla: con «acaba en -a» a secas,
23 de 24 salían bien y **«Unidad» salía mal** — la pantalla habría escrito
«Unidad abierto». Uno de veinticuatro, y de los que se cuentan.

**2 · El total se partía.** «2 × Bolsa cerrada (5 kg) + 750 / g». Dos cosas:
el nombre del envase a secas y pluralizado —«2 bolsas», como la maqueta— y un
**espacio de no separación (U+00A0)** entre cada cifra y su unidad, en las cinco
pantallas. Sin él, «750» se queda al final de una línea y la «g» sola al
principio de la siguiente: una cantidad que hay que leer dos veces.

**3 · Las casillas vacías ponían «0».** Ahora ponen «–» mientras no se haya
tecleado nada de ese producto, y «0» en cuanto hay algo puesto en otra fila —que
es cuando el cero significa de verdad «ninguna caja». Es lo que hacen las dos
pantallas de la maqueta, y es lo mismo que dice `save_count_line` al negarse a
tratar un array vacío como un recuento a cero.

**4 · «Otra · + g» era «+ bolsa».** Corregido: lo que se teclea ahí son
unidades del formato, no gramos —el caso de dos bolsas abiertas y media—. Sigue
guardándose como **estimado** (`method = 'fraccion'`), así que llega a la
aprobación con su pastilla «A ojo»; lo único que ha cambiado en la BBDD es que
`fraction` ya no está obligada a ser menor que 1.

### Y una cosa que me encontré arreglando esto

**`tests/` no entra en ningún `tsconfig`** — `tsconfig.app.json` incluye sólo
`src`. Así que `tsc -b` **no mira los ficheros de prueba**, y eso incluye el que
genera las capturas. Se me olvidó pasarle la propiedad `tocado` a `FilaFormato`
en la captura, el compilador no dijo nada, y la foto salió con la caja en «–»
donde tenía que poner «0».

Lo cazó **mirar la foto**, que es exactamente para lo que están las capturas.
Pero conviene saberlo: el código que hace las capturas es, en silencio, el menos
comprobado del cambio. Ahora hay una prueba que fija el caso (`p1` lleva un 0,
`p3` lleva una raya) y otra que comprueba que el U+00A0 sigue ahí. **No he
metido `tests/` en el tsconfig**: eso enciende el typechecker sobre 82 ficheros
de prueba de golpe y no es lo que se me ha pedido hoy. Queda dicho aquí.

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
| `vitest run` (con `dist`) | 1.042 pasan · 6 fallan | **1.101 pasan · 6 fallan** |

Los 6 que fallan son los mismos seis de antes (`routes`, `brandsService`,
`salesChannelsService`) y no los toca nada de aquí. Los **59** nuevos son míos.

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

`tests/unit/modules/supply/generoDeEnvase.test.ts` (37) va contra **las 24
primeras palabras de nombre de formato** que hay en el catálogo, con el número
de formatos de cada una. Esa prueba ya se ganó el sueldo dos veces: puse 349 de
cabeza y son 330, y me enseñó que «unidad» rompía la regla de género.

`tests/unit/modules/supply/capturaConteoMovil.test.tsx` (1) escribe las tres
capturas y comprueba dos cosas: que el marcado no lleve clases del Folvy viejo
—medido sobre el **marcado**, no sobre el fichero, porque el CSS del build
lleva compiladas todas las clases de la app y buscarlas ahí da positivo
siempre— y que en ninguna de las tres aparezcan **8875** ni **9000**. Si
aparecieran, el freno habría dejado de ser ciego.

---

## §5 · Lo que hace falta de Julio, en orden

El orden que puso Julio, con las tres primeras EN LA MISMA SESIÓN — las
migraciones sin el front nuevo dejarían al móvil de hoy escribiendo contra el
disparador simétrico:

1. **PASO 0a** de `20260910_recalcular_coste_medio.sql` (no escribe): las 53
   recepciones fuera de banda. Corregir por lo menos las dos fichas malas
   —**Humus** y **Tapa Salsero 120 Cc**—, que son las que hacen caer un
   artículo a un coste que no vale.
2. **PASO 0b** (no escribe): el antes/después. Si no da 49.735,98 €, parar.
3. **Aplicar las diez migraciones** por orden de nombre y **fusionar la rama**,
   a la vez.
4. **Ejecutar** `supabase/verificacion/20260910_conteo_por_formatos.sql` y
   pegar el resultado.
5. `npm run types:gen`, y quitar el ayudante `rpc()` de `countEntryService.ts`.
6. **PASO 1** del coste medio, sólo si el 0b cuadró. Y después el PASO 2.
7. Abrir **Almacén › Cómo se cuenta** y decidir los formatos de los siete
   artículos de la tabla del §2.1 — sobre todo Pulled Pork, que se cuenta 31
   veces al mes con cinco formatos y ninguno marcado.

## §6 · Lo que NO va aquí, y no va

Unidad base de ficha con conversión · fiabilidad por empleado dentro de Folvy ·
FEFO y lotes · traspasos entre locales. Nada de eso se ha tocado.

---

# APLICADO EN PRODUCCIÓN · 10/09/2026, con Julio delante

Se ejecutaron los pasos 1 a 4 del §5. Los pasos 5, 6 y 7 quedan pendientes y
están al final.

## Antes de empezar: nadie estaba contando

| | Local | Estado | Líneas | Contadas |
|---|---|---|---:|---:|
| INV-00217 | Foodint Carabanchel | contando | 14 | **0** |
| INV-00218 | Foodint Alcalá | contando | 35 | **0** |

Los dos creados por el cron a las 06:00, con `counted_qty`, `counted_at` y
`counted_by_name` a nulo en las 49 líneas.

## Paso 1 · Las 53 recepciones fuera de banda

53 líneas, 23 artículos. En **21 de 23** la mediana de las recepciones coincide
con la ficha: la banda deja fuera exactamente la línea rara (Milanesa Ternera a
**233,96 €/ud** contra 3,66 de ficha, Pasta Trufada a **8,35** contra 0,024,
CAJA GENERICA a **56,02** contra 0,224).

En **2 la rara es la ficha**, y hay que arreglarla por ahí:

| Artículo | Ficha | Mediana de sus recepciones | |
|---|---:|---:|---|
| **Humus** | 0,00001 €/g | 0,00647 €/g | ×900 · 3 de 4 fuera |
| **Tapa Salsero 120 Cc** | 0,00446 €/ud | 0,03556 €/ud | ×8 · 2 de 3 fuera |

## Paso 2 · El antes/después, clavado con el ensayo

```
                  filas  sin coste  negativo  cambian  valor antes   valor después
Alcalá             196    65 → 39    11 → 0     154    34.566,95 €   38.486,15 €
Carabanchel        139    36 →  8    23 → 0     106     2.551,01 €    6.233,60 €
Plaza Castilla     118    19 →  2    16 → 0      79     4.324,47 €    5.016,23 €
TOTAL              453   120 → 49    50 → 0     339    41.442,43 €   49.735,98 €
```

## Paso 3 · Las diez migraciones, aplicadas

Aplicadas por orden de nombre, de `conteo_p1_use_in_count` a
`conteo_p10_contexto_de_revision`. Comprobado después:

- `use_in_count`: Foodint **275 activos → 189 true / 86 false**; Folvy Interno
  **306 → 206 / 100**. Clavado con el ensayo del §2.1.
- Todas las columnas y la tabla: `inventory_count_entry`, las 6 columnas nuevas
  de `inventory_count_line`, las 6 de `supply_settings`, las 2 de `recipe_item`,
  el CHECK `otro_con_nota` y el disparador `trg_ripf_invalida_revision`.
- Las cuatro funciones nuevas **nacen privadas**: `anon` no puede ejecutar
  ninguna. Y `save_count_line` tiene **una sola firma** `(uuid, jsonb, numeric)`
  — sin sobrecarga, que es la regla 2.

**Sin deriva entre el repo y lo desplegado.** Las migraciones se aplicaron por
el MCP, transcribiendo el SQL a mano, así que se comprobó: md5 del cuerpo
literal de cada función (`prosrc`, sin comentarios y con los espacios
colapsados) contra el del fichero del repo. **11 de 11 idénticas.** Regla 1: no
hay nada que viva sólo en el desplegado.

La rama se fusionó a `main` en el mismo tramo (commit `3bb2722`), como pedía el
orden: las migraciones sin el front nuevo dejarían al móvil de hoy escribiendo
`counted_qty` a mano contra el disparador simétrico.

## Paso 4 · La verificación, sobre las líneas reales de hoy

**§4.1 · Patatas Bastón, 2 bolsas + 750 g** (línea de INV-00218, Alcalá). Va en
DOS pasos porque el teórico vivo son 120.000 g y el freno salta:

```
1er guardado {"attempt":1,"counted":5750,"entries":2,"verdict":"recount", …}
             → 2 bolsas × 2.500 + 750 = 5750, 2 entradas, y la línea NO se sella
2º guardado  {"attempt":2,"counted":5750,"entries":2,"verdict":"ok","confirmed":true, …}
             → counted_qty = 5750
entradas     intento 1: 2 filas (5750 g) · intento 2: 2 filas (5750 g)
```

Demuestra §4.1 y de paso el §2.3 entero: la suma en servidor, el freno que
frena UNA vez, y «confirmado 2 veces» al repetir el mismo total.

**§4.2 · «0 donde el último aprobado son 9 kg, sin entradas».** Hoy no hay línea
de Peperoni en Alcalá, así que se probó el MISMO caso con **Kebab Pollo
Loncheado** (INV-00218): último aprobado 9.000 g por Natacha el 09/09, ninguna
entrada desde entonces.

```
{"attempt":1,"counted":0,"entries":1,"verdict":"recount","confirmed":false, …}
```

`recount`, y **la respuesta no contiene ni 9000 ni 8875**. La línea no se sella
(`counted_qty` sigue NULL, `recount_asked_at` puesto) **pero el intento sí se
guarda**: una entrada, que es lo que hace que el segundo guardado pueda saber si
repite.

**§4.3 · El solomillo, «25» contra 35 kg** (INV-00218, teórico 35.000 g):

```
{"attempt":1,"counted":25,"entries":1,"verdict":"recount", …}
```

`recount` **y sin excepción FV001**. Es la contradicción del encargo resuelta
por el orden, comprobada en producción: el freno se adelanta a la red.

**§4.5 · «Otro» sin nota.** Rechazado por la BBDD:
`violates check constraint "inventory_count_line_otro_con_nota"`. Con nota, entra.
Y `uso_sin_apuntar` y `error_conteo` están en el CHECK.

**§4.7 · `git grep` de escrituras directas a `counted_qty` desde el front:**
sólo lecturas y comentarios. **Ninguna escritura.**

**§4.9 · `tsc -b` exit 0** sobre `main` fusionado.

### El ensayo no dejó nada escrito

Cuatro líneas se tocaron y las cuatro se deshicieron. Estado final:

```
INV-00217  14 líneas · 0 contadas · 0 entradas · 0 recount pedido · 0 motivos
INV-00218  35 líneas · 0 contadas · 0 entradas · 0 recount pedido · 0 motivos
inventory_count_entry en TODA la BBDD: 0 filas
movimientos de stock creados hoy: 0
```

**Y hubo un tropiezo que hay que contar.** El primer intento del §4.2 cogió «la
línea viva más reciente de Peperoni» y le tocó una de **INV-00206** (Carabanchel,
un conteo rezagado del 06/09). Ahí el teórico vivo es 0 y el último aprobado
también, así que contar 0 salió `ok` — correcto, pero no era el caso que se
quería probar. Peor: mi deshacer borró las entradas y `recount_asked_at` **pero
se dejó `counted_qty = 0`** en una línea que estaba sin contar. Se detectó al
mirar los datos en vez de creerse el resultado, y se revirtió con
`clear_count_line`. La línea `4608bf2a` volvió a `counted_qty` NULL, `counted_at`
NULL, 0 entradas.

La lección, que es la de siempre: **elegir la fila del ensayo con una consulta
que no mira los datos es escribir a ciegas.** La segunda vuelta miró primero las
35 líneas de INV-00218 con su teórico y su último aprobado, y eligió sobre
hechos.

## Lo que NO se ha hecho, y por qué

**§4.4 · `needs_review` no la aplica `autoclose_daily_count`.** No se ha
probado. Para probarlo de verdad hay que ejecutar `autoclose_daily_count` sobre
un conteo, y eso **cierra el conteo y mueve stock**. No hay conteo de prueba, y
usar uno real (INV-00204 o INV-00201, rezagados de Carabanchel) sería una
operación con efectos que no se ha pedido. Lo que sí está comprobado es que el
código desplegado es el del repo, y ese código cuenta las `needs_review` en
`v_missing` y las excluye del bucle en modo parcial. **La prueba de verdad
queda pendiente y hace falta decidir sobre qué conteo se hace.**

**§4.6 · 0 filas con coste medio negativo.** La función nueva está desplegada,
pero las 453 filas **siguen con el coste viejo**: recalcularlas es el PASO 1 del
guion del coste, que es el punto 6 del orden y no estaba en lo de hoy. Hasta que
se ejecute, el ensayo del PASO 2 sigue midiendo 50 negativos.

**Puntos 5, 6 y 7 del §5**, tal cual quedaron:

5. `npm run types:gen`, y quitar el ayudante `rpc()` de `countEntryService.ts`.
6. PASO 1 del recálculo del coste (y después el PASO 2, `variance_value`).
7. Abrir **Almacén › Cómo se cuenta** y decidir los formatos de Pulled Pork y
   los otros seis de la tabla del §2.1.

## Un hallazgo que no es de hoy y no se ha tocado

`apply_inventory_count`, `autoclose_daily_count`, `close_inventory_count` y
`tg_inventory_count_line_sanity` son **ejecutables por `anon`**. No lo he abierto
yo: `CREATE OR REPLACE` conserva los permisos de la función anterior, y se
comprobó contra siete funciones de escritura que **no** se han tocado hoy
—`register_adjustment`, `register_waste`, `register_transfer`,
`build_inventory_count`, `generate_daily_count`, `post_pending_receipt_line`,
`void_goods_receipt`— y todas están igual.

Es sistémico y anterior. La migración del 09/09
(`cerrar_a_anon_de_verdad_revocando_public`) no llegó a estas. **No se toca
porque no es lo de hoy**, pero queda escrito.

---

# INCIDENTE Y CIERRE DE LA PUERTA · 10/09/2026, 12:34–12:43

## Lo que pasó, medido

La pantalla nueva se publicó a las **11:39**. A las **12:34** empezaron a
entrar líneas de INV-00218 (Alcalá) que **no habían pasado por
`save_count_line`**: doce líneas contadas, **cero filas** en
`inventory_count_entry`. Todas de la misma persona, Johanny Garzón Rodríguez,
entre las 12:34:37 y las 12:43:32 de Madrid. Un móvil con la versión vieja en
caché, escribiendo `counted_qty` por la puerta de atrás.

| Artículo | apuntado | teórico vivo | ref. anterior | ¿recepción? | qué habría dicho el freno |
|---|---:|---:|---:|:--:|---|
| Milanesa de Pollo Rebozado | 4 | 7,0 | 7,0 | no | **FRENO · contradice 43 %** |
| Solomillo de Pollo Prefrito Piri-piri | 25.000 | 35.000,0 | 35.000,0 | no | pasa (−29 %) |
| Queso Mozarela | 8.000 | 8.850,0 | 8.850,0 | no | pasa (−10 %) |
| Sweet Potato Fries | 12.500 | 14.700,0 | 14.700,0 | no | pasa (−15 %) |
| Focaccia XXL | 63 | 72,0 | 72,0 | no | pasa (−13 %) |
| Lechuga Romana | 1.950 | 2.534,2 | 2.534,2 | **sí** | pasa (el freno se calla a propósito) |
| Pepinillos Agridulce en Rodajas | 6.600 | 6.247,3 | 6.247,3 | no | pasa (+6 %) |
| Milanesa Ternera Rebozado | 33 | 32,0 | 32,0 | no | pasa (+3 %) |
| Coca-Cola Zero Lata | 0 | 0,0 | 0,0 | no | pasa |
| SALSA Yogur | 0 | 0,0 | 0,0 | no | pasa |
| Humus | 1.000 | −355,0 | −355,0 | no | **no lo mira** (ver abajo) |
| Lima | 0 | −360,7 | −360,7 | no | **no lo mira** (ver abajo) |

Replicado en lectura con los umbrales reales de la cuenta (factor 3,
contradicción 40 %), anclado por `account_id`.

**Una de las doce** habría parado a pedir un segundo vistazo. Las otras once
habrían pasado igual — pero no es eso lo que se perdió. Lo que se perdió en las
doce es **el cómo**: sin entradas no hay formatos, no hay marca de «a ojo», y
la pantalla de aprobación no puede decir «2 cajas + media bolsa». Se guardó el
número y se tiró el razonamiento.

### Y de rebote, un agujero que la puerta NO tapa

**Con el teórico en negativo, los dos frenos se apagan.** El primero exige
`teorico > 0`; el segundo exige `ref_anterior > 0`. Humus llegó apuntado con
1.000 g contra un teórico de −355 g, y **ningún freno lo mira**: justo el caso
en el que la ficha ya venía mal y más falta hacía preguntar. Lima igual.

No lo arreglo hoy porque no es lo que se ha pedido y cambia el umbral de
verdad, no la puerta. Queda escrito y con nombre propio: **Humus y Lima, y los
453 artículos del recálculo del coste están en la misma familia.**

## 1 · La puerta, cerrada con llave (migración p11)

**La lección es nueva y va al grano:** haber puesto una sola puerta de
escritura **en el código** no cierra la puerta vieja, la deja abierta y sin
vigilar. Mientras exista una versión del cliente en el caché de alguien, el
`UPDATE` directo sigue siendo una escritura válida para la BBDD. Una puerta que
sólo existe en el front no es una puerta: es una recomendación.

`save_count_line` y `clear_count_line` sellan la transacción con **el id de la
línea** justo antes de su `UPDATE` y lo quitan justo después. El disparador
`trg_a_count_line_solo_por_la_puerta` exige ese sello y, si no está, levanta
**FV002** con un mensaje escrito para quien está de pie delante de una cámara:

> Esta versión de Folvy es antigua y ya no puede guardar recuentos. Cierra la
> aplicación y vuelve a abrirla para actualizarla; lo que hayas contado no se ha
> perdido, vuelve a apuntarlo cuando se actualice.

El nombre empieza por `trg_a_` a propósito: Postgres los ejecuta por orden
alfabético, y así una app vieja oye «actualízate» y no «cantidad fuera de
escala» de la red de cordura.

**Lo que esta puerta no es.** No es una barrera criptográfica: quien pudiera
llamar a `set_config` a voluntad se la saltaría. No puede — PostgREST sólo
expone el esquema `public` y `set_config` vive en `pg_catalog`. Para lo que
está es para lo que pasó hoy, y de eso protege del todo.

**La válvula, dicha en voz alta.** Una migración que necesite tocar
`counted_qty` a mano pone el sello `'mantenimiento'`. Es ruidoso a propósito:
quien lo escriba está diciendo «sé que me salto el freno».

### Antes de aplicar: quién más escribe `counted_qty`

Preguntado a la BBDD, no supuesto. Cinco funciones tocan
`inventory_count_line`; de ésas, **sólo `save_count_line` y `clear_count_line`
asignan `counted_qty`**. `close_inventory_count` lo nombra dos veces pero las
dos son **comparaciones** dentro de `within_tolerance`. Los dos caminos que
crean conteos —`_generate_daily_count_core` y `build_inventory_count`— insertan
`counted_qty` **NULL** explícito. En el front no queda ni un escritor: los once
usos que quedan de `counted_qty` son lecturas.

### El ensayo, revertido a propósito

Ocho comprobaciones sobre una línea real de INV-00217 (*Mezcla de Mix de
Setas*), todas dentro de un bloque que aborta al final para no dejar nada:

| # | Prueba | Resultado |
|---|---|---|
| 1 | `UPDATE` directo, como el móvil de las 12:34 | ✓ RECHAZADO `FV002`, con el mensaje literal |
| 2 | Sello **de otra línea** | ✓ RECHAZADO `FV002` — el sello es por línea, no un «sí» genérico |
| 3 | Válvula `'mantenimiento'` | ✓ pasa, a propósito |
| 4 | `save_count_line` | ✓ veredicto `ok`, `counted_qty` = 4, 1 entrada |
| 4b | `UPDATE` directo **después** de `save_count_line` | ✓ RECHAZADO `FV002` — el sello no se queda pegado |
| 5 | `clear_count_line` | ✓ deshace: `counted_qty` NULL, 0 entradas |
| 6 | `INSERT` con `counted_qty` NULL | ✓ pasa — crear conteos sigue intacto |
| 7 | `INSERT` ya contado por la puerta de atrás | ✓ RECHAZADO `FV002` |
| 8 | Orden de disparadores | `trg_a_count_line_solo_por_la_puerta` → `trg_inventory_count_line_sanity` |

Los dos primeros intentos de 4 y 5 fallaron con «sin acceso a la cuenta»:
`belongs_to_account()` decía la verdad, no había JWT. Se repitieron con las
claims de un usuario real de la cuenta.

**Y comprobado después, mirando los datos y no fiándome del rollback:**
INV-00217 sigue con 14 líneas, 0 contadas, 0 entradas, 0 frenos, y su
`position` máxima vuelve a ser 14 — las dos filas de prueba (9998 y 9999) no
están.

### Sin drift entre repo y desplegado

md5 de los tres cuerpos, repo contra producción, **3 de 3 iguales**:

| Función | md5 | chars |
|---|---|---:|
| `tg_count_line_solo_por_la_puerta` | `cba16212274dcb41c3499c89598aa43b` | 1.441 |
| `clear_count_line` | `aef3bd7b105c326693bc4732a4bf8e2e` | 1.189 |
| `save_count_line` | `b6133e37f7fe243c81eac7061046fdfa` | 11.965 |

Importa más de lo que parece: `save_count_line` son doscientas líneas de las
que **sólo cambian dos** (las dos de `set_config`). El cuerpo se generó desde el
fichero de la p4, no se volvió a teclear, y el md5 es lo que demuestra que no se
coló ningún cambio que nadie ha decidido.

## 2 · Que el móvil se entere de que hay versión nueva

`__BUILD_ID__` se inyecta en el build y el móvil compara contra
`/version.json` pidiéndolo con `cache: 'no-store'`. Si no coinciden, recarga.

**Pero no recarga encima de alguien que está escribiendo.** Un registro de
trabajo en curso (`trabajoEnCurso.ts`) hace que el vigía espere mientras haya
algo tecleado sin guardar; en los formularios largos —APPCC, recepción,
cambios, inventario— no recarga sola: avisa. Y si la BBDD contesta `FV002`
igualmente, `MiAutoinventario` entra en la pantalla `'caducada'`, con **un solo
botón**: «Actualizar y seguir contando».

El mensaje de esa pantalla y el que levanta el disparador son **literalmente el
mismo texto**, y hay una prueba que falla si alguien cambia uno sin el otro.

## Lo aplicado y lo que queda

**Aplicado hoy:** migración p11 (`conteo_p11_puerta_cerrada`), sobre las diez
de esta mañana. **Front:** ya estaba fusionado antes de la p11 — el orden
importaba, porque la puerta cerrada sin el vigía de versión habría dado FV002 a
gente sin manera de actualizarse.

**Sigue pendiente, igual que esta mañana:** los puntos 5, 6 y 7 del §5, el §4.4
y las dos fichas malas (Humus, Tapa Salsero 120 Cc) — a las que hoy se les suma
Lima y el agujero del teórico en negativo.
