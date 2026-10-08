# C05 · Comprobaciones previas (tarea 1)

> Encargo C05 — Libros y balances (`docs/conta/encargos/encargo_C05_libros_y_balances.md`).
> Hecho el 08/10/2026. Producción **solo leída** (`xzmpnchlguibclvxyynt`, SELECT);
> toda cifra de producción va filtrada por la cuenta de Foodint
> (`account_id = 51ad1792-…`) salvo que diga otra cosa (regla 9). Nada aplicado.

## 0. Lo que cambia el plan, en cinco líneas

1. **En producción no hay ni un asiento.** `journal_entry` y `journal_line` tienen
   **0 filas en todas las cuentas**. No hay «claves de libro registro en los apuntes
   reales de octubre» que mirar: el libro empieza vacío y todo lo del C05 se va a
   estrenar con la semilla de staging y, después, con lo que traiga el C04b.
2. **Las columnas del formato AEAT no caben hoy en `journal_line`.** Faltan, entre
   otras, el tipo de factura (F1/F2/F4/R1…), el número final del resumen, la
   fecha de operación, la clave y la calificación de la operación, el recargo de
   equivalencia y la actividad. Lista completa en §3.
3. **El resumen diario de tiques es F4 en el formato de la AEAT, no F2** como pone
   la maqueta N15 («F2 · resumen · art. 63.4»). Decisión de Julio (§3.3).
4. **El mapeo del PGC deja 53 de las 657 plantillas de Foodint sin sitio**: 31
   son cuentas de 3 cifras que el modelo reparte a 4 (p. ej. 160, 240, 510, 530,
   795), 20 son partidas que el PGC manda *crear* cuando hay saldo o que se
   cancelan al cierre (473), y 678/778 van a «Otros resultados». Regla 2 obliga a decidirlo antes de migrar (§5.3).
5. **Los límites del modelo abreviado son LSC arts. 257–258, no CCom.** La LSC
   (bajada) dice 4 M / 8 M / 50 para el balance; el art. 2 del RD 1515/2007
   consolidado sigue en 2,85 M / 5,7 M / 50. Decisión de Julio (§6).

## 1. `conta_sumas_saldos` y `conta_resultado_por_local`, hoy

Definiciones leídas de `pg_proc` en producción (iguales a
`supabase/migrations/20261010T0130_c04_lectura.sql` y anteriores del C04).

**`conta_sumas_saldos(p_company, p_desde, p_hasta)`** → `company_account_id, code,
name, template_code, debe, haber, saldo`. SQL plano sobre `journal_ledger`
(vista `security_invoker`, solo asientos `validado` y `anulado`: el anulado y su
contraasiento se compensan) agrupado por cuenta, entre dos fechas.

Lo que le falta para el C05 (regla 5 y sección 5 del encargo):
- **Sin niveles**: devuelve solo cuentas de la empresa; grupo/subgrupo/cuenta los
  tendría que sumar el front (la lección del C02: cada nivel suma sus hijos).
- **Sin saldo inicial ni arrastre**: «entre dos fechas» no es «a una fecha».
- **Sin las opciones de Diez**: saldos a 0, apertura, PyG (regularización) y
  cierre no se pueden incluir/excluir porque no distingue `source_type`.
- **Sin local ni marca.**

La usa `libroService.sumasYSaldos` (pantalla del plan, C02 R5).

**`conta_resultado_por_local(p_company, p_desde, p_hasta, p_repartir)`** →
`location_id, brand_id, ingresos, gastos, resultado, nota`. Suma 7 (haber−debe) y
6 (debe−haber) **por `template_code`**, agrupado por local y marca; lo común (sin
local) lo reparte por `allocation_rule` si las reglas vigentes suman 100 %, y el
último local se lleva el redondeo. La usa `diarioService.resultadoDelMes`.

Lo que le falta o hay que vigilar:
- **No excluye la regularización.** En cuanto exista un asiento que lleve 6 y 7 a
  la 129, un periodo que lo incluya da resultado 0. Hoy no pasa (no hay cierres);
  en el C05 sí (regla 7). Hay que excluir `source_type` de regularización y cierre.
- **Toda cuenta 6/7 de Foodint tiene plantilla** (comprobado, abajo), así que hoy
  no se escapa ninguna por `template_code` nulo.
- El reparto es por local; **la marca no se reparte** (lo común va a locales).

```
grupo | cuentas | sin_plantilla | plantilla_de_otro_grupo      (company_account, Foodint)
1     |   76    |      0        |   0
2     |  101    |      0        |   0
3     |   30    |      0        |   0
4     |  147    |      0        |   0
5     |  139    |      0        |   0
6     |  147    |      0        |   0
7     |  111    |      0        |   0
```

**Qué devuelven hoy en producción: nada**, porque no hay apuntes (§2).

## 2. Claves de libro registro en los apuntes de octubre, y volúmenes

```
-- journal_entry / journal_line por cuenta, TODA la tabla (todas las cuentas)
t                 | account_id (Foodint) | count
channel_settlement| 51ad1792-…           | 247
company_account   | 51ad1792-…           | 751
fiscal_year       | 51ad1792-…           | 1
journal_entry     | —                    | (ninguna fila en ninguna cuenta)
journal_line      | —                    | (ninguna fila en ninguna cuenta)
allocation_rule   | —                    | (ninguna fila en ninguna cuenta)
```

Ejercicio de Foodint: `2026`, `origin = mixed`, `origin_program = diez`,
`imported_until = 2026-09-30`, abierto, plantilla media 6 fijos.

**Lo que generará asientos (para dimensionar)**, Foodint, fecha de Madrid:

```
q                              | mes     | n
días de venta × local          | 2026-06 | 57
                               | 2026-07 | 74
                               | 2026-08 | 61
                               | 2026-09 | 59
                               | 2026-10 | 16   (1.031 ventas, 2 locales, 01–08/10)
channel_settlement             | 2026-04 | 68
                               | 2026-05 | 71
                               | 2026-06 | 108
supplier_invoice               | 2026-08 | 1
```

Orden de magnitud con lo que hace el generador del C04 en staging (un asiento
de ventas por local y día con ~3,5 apuntes; un apunte de IVA por tipo, con
`tax_documents` = nº de tiques): **~60 asientos y ~220 apuntes de ventas al mes**,
más liquidaciones y facturas. Lo grande vendrá del C04b (2023–2026 de Diez), que
hoy no se puede medir. Con estos números no hace falta nada materializado: vistas
sobre `journal_line` con índice por `(company_id, entry_date)` bastan; se revisa
cuando entre el C04b.

**Cómo marca hoy el C04 los apuntes** (staging, toda la tabla, para ver el
generador, no datos de nadie):

```
source_type        | vat_book | deducible | con tipo | retención | apuntes | asientos
channel_settlement | received | yes       | true     |           | 1       | 1
sales_day          | issued   |           | true     |           | 2       | 2   (tax_documents medio 109)
supplier_invoice   | received | yes       | true     |           | 2       | 2
supplier_invoice   |          |           |          | 115       | 1       | 1
payroll            |          |           |          | 111       | 1       | 1
```

`vat_book` admite `issued`, `received`, `investment`, `not_subject`
(`journal_line_vat_book_check`). No hay clave de intracomunitarias.

## 3. Formato AEAT de los libros registro

Fuentes bajadas por el workflow y citadas en `docs/conta/fuentes/registro.json`:

| Clave | Qué es | URL | Huella |
|---|---|---|---|
| `aeat-formato-libros-registro` | PDF «Formatos de los Libros Registro de IVA e IRPF», V.18.02.2026, especificaciones 2025–2026 | sede.agenciatributaria.gob.es/…/Formato_Electronico_Comun_Libros_Registro_IVA_IRPF.pdf | `6f31ee218560…` |
| `aeat-disenos-libros-registro` | XLSX «Diseños de registro normalizados…» (el enlace de la página de la AEAT) | sede.agenciatributaria.gob.es/static_files/AEAT/LSI.xlsx | `4217c718f6ff…` |

Lo que dice el PDF (literal en `textos/aeat-formato-libros-registro.txt`): fichero
**XLSX**, ≤ 4 MB; **cada libro en su hoja**, con nombre fijo (`EXPEDIDAS`,
`EXPEDIDAS_INGRESOS`, `RECIBIDAS`, `RECIBIDAS_GASTOS`, `BIENES-INVERSIÓN`);
**acumulado desde el 1 de enero hasta el final del trimestre**, sin fraccionar.
Las columnas exactas están en el XLSX: **36 en expedidas, 42 en recibidas, 40 en
bienes de inversión** (`textos/aeat-disenos-libros-registro.txt`). **No hay hoja
de intracomunitarias**: esas operaciones van en expedidas/recibidas con su clave
(el libro de determinadas operaciones intracomunitarias del RIVA art. 66 queda
como libro propio, «ninguno» en Foodint).

### 3.1 Expedidas: columna AEAT ↔ lo que hay

| Columna AEAT | Hoy | Falta |
|---|---|---|
| Autoliquidación (ejercicio, periodo) | sale de `entry_date` | — |
| Actividad (código, tipo, epígrafe IAE) | en la empresa (`company_activity`), no en el apunte | actividad por apunte si hay más de una |
| Tipo de factura (F1, F2, F3, F4, R1–R5…) | **no** | columna |
| Fecha expedición / **fecha operación** | `document_date` (una sola) | fecha de operación |
| Serie / Número / **Número final** | `document_ref` (texto) | serie, número y número final (rango del resumen) |
| NIF destinatario (tipo, país, identificación), nombre | `party_id` → `party.tax_id` | tipo de identificación y país |
| Clave de operación (01 general, 02 exportación, 07 caja…) | **no** | columna |
| Calificación (S1, S2, N1, N2) / Operación exenta (E1–E6) | `vat_book = not_subject` (parcial) | columnas |
| Total, base, tipo, cuota | `tax_base`, `tax_rate_id`, importe | total por factura |
| Tipo y cuota de recargo de equivalencia | **no** | columnas |
| Cobro (criterio de caja: fecha, importe, medio) | **no** | (criterio de caja: fuera de Foodint) |
| Retención IRPF (tipo, importe) | `withholding_*` | — |
| Inmueble (situación, ref. catastral) | **no** | para alquileres (115) |

### 3.2 Recibidas y bienes de inversión

Recibidas añade: fecha y número de **recepción** (y número final), **bien de
inversión S/N** (hay `vat_book = investment`), **inversión del sujeto pasivo**,
**deducible en periodo posterior** y periodo de deducción, **cuota deducible**
(hoy solo `vat_deductible` yes/no/prorrata, sin importe).

Bienes de inversión (40 columnas): descripción, fecha de inicio de uso, valor
de adquisición, amortización, factura, prorrata y **regularización anual**, baja.
**No existe nada de bienes de inversión** en producción: ni tabla ni columna
salvo `vat_book = 'investment'` (búsqueda en `pg_class` e
`information_schema.columns` por invest/asset/activo/amortiz/depreci/inmoviliz:
solo `journal_line.vat_book` y `journal_ledger.vat_book`). `investment_good` se
crea.

### 3.3 Decisión para Julio: el resumen de tiques

N15 pinta el asiento resumen como «F2 · resumen · art. 63.4». En el formato de la
AEAT (nota 9 del XLSX): **F2** es «factura sin identificación del destinatario»
(una simplificada); **F4** es «asiento resumen de facturas», con *Número* y
*Número final*. Propongo **F4** con el rango de tiques del día, y el texto «art.
63.4» como explicación. Cambia la maqueta, no el diseño.

## 4. Orden JUS de depósito vigente

| Clave | Qué es | Huella |
|---|---|---|
| `orden-jus-616-2022` | Orden JUS/616/2022, de 30 de junio (BOE-A-2022-10975): modelos de presentación en el Registro Mercantil de las cuentas anuales | `356f9aa43a00…` |
| `res-dgsjfp-2026-cuentas` | Resolución de 19/05/2026 de la DGSJFP (BOE-A-2026-11581): modifica esos modelos para lo que se presente desde el 01/06/2026 | `a6fed55f4862…` |
| `rdl-1-2010-lsc` | Ley de Sociedades de Capital (BOE-A-2010-10544): arts. 257, 258 y 363.1.e | `26ffde45a577…` |

No hay Orden JUS de 2026: la última orden es la de 2022 y, desde entonces, los
modelos se actualizan cada año por resolución de la DGSJFP (la de 2026 sustituye
a la de 26/05/2025). Tres cambios en 2026, según su propio texto: quita la CNAE
2009 y deja solo la CNAE 2025; ajusta activos por impuesto diferido; y añade en
el modelo normal el informe país por país (> 750 M, no aplica a Foodint). El
depósito (ficheros del anexo II) va en el C05b.

## 5. Mapeo línea ↔ cuentas desde el texto del PGC

`scripts/conta/modelos-pgc.mjs` lee el texto del BOE ya bajado
(`rd-1514-2007.txt`, `rd-1515-2007.txt`), toma la **última versión** de cada
bloque y saca cada línea con su código, texto oficial, nivel y cuentas con signo
(«(2801)» resta; «*» con los dos signos). Resultado en
`docs/conta/referencia/modelos-cuentas-anuales.json`, con la huella de cada texto.

| Modelo | Estado | Vigente desde | Líneas | Con cuentas |
|---|---|---|---|---|
| normal | balance | 2021-01-31 (RD 1/2021) | 119 | 90 |
| normal | PyG | 2021-01-31 | 55 | 35 |
| normal | ingresos y gastos reconocidos | 2021-01-31 | 17 | 9 |
| abreviado | balance | 2010-09-25 (RD 1159/2010) | 56 | 43 |
| abreviado | PyG | 2008-01-01 | 21 | 17 |
| abreviado | ingresos y gastos reconocidos | 2008-01-01 | 13 | 9 |
| pymes | balance | 2016-12-18 (RD 602/2016) | 52 | 39 |
| pymes | PyG | 2016-12-18 | 21 | 17 |

El **estado total de cambios en el patrimonio neto** (y el ECPN de pymes) es una
matriz sin columna de cuentas: se calcula de los movimientos del grupo 1 y la
129, no de un mapeo.

Tres rarezas del texto del BOE que el lector trata a propósito (comentadas en el
guion): una celda de cuentas partida por el texto de su línea (PyG normal 13.b),
cuentas puestas después de su línea antes de un encabezado (pymes, A-2), y el
texto de una línea partido en dos párrafos.

### 5.1 Cobertura del cuadro de cuentas (regla 2)

Cada cuenta hoja del cuadro del C02 (`supabase/conta/pgc/serie.json`, 714 del
general y 615 de pymes) contra su estado (1–5 balance, 6–7 PyG, 8–9 ingresos y
gastos reconocidos):

```
modelo    estado   una línea  dos (por signo)  ninguna
normal    balance  385        4                29
normal    pyg      249        0                3
normal    igrpn    31         1                12
abreviado balance  389        4                25
abreviado pyg      249        0                3
abreviado igrpn    31         1                12
pymes     balance  351        4                20
pymes     pyg      238        0                2
```

- **Dos líneas, por signo** (lo que en Diez son las cuentas con asterisco): 551,
  5523, 5524, 5525 (activo si deudor, pasivo si acreedor) y 8301. Es el «si
  saldo deudor va a X, si acreedor a Y» del encargo: el mapeo lleva signo.
- **Ninguna línea**: no es un fallo del lector, es el PGC. Son partidas que sus
  normas de elaboración mandan **crear si hay saldo** (tercera parte, I, p. ej.
  «Investigación» 200/2800/2900, «Deuda con características especiales» 15x/502/
  507, «Diferencia de conversión» 135, «Otros resultados» 678/778), cuentas que
  se cancelan antes del cierre (**473** retenciones y pagos a cuenta, contra la
  4752) y cuentas de situaciones raras (550 titular de la explotación, 5530–5533
  fusiones, 554 UTE, 5585, 1370/1371, 195/197/199). Lista completa por modelo en
  el JSON y en la salida de la medida.

### 5.2 La población real: las cuentas de Foodint (plan pymes)

Foodint tiene **751 cuentas** con **657 plantillas distintas**, todas del plan
pymes. Contra el modelo pymes:

```
estado   una línea  dos (por signo)  ninguna
balance  356        4                50
pyg      244        0                3
```

Las 53 sin sitio, una cuenta de Foodint cada una:
- **31 cuentas de 3 cifras que el modelo reparte a 4** (las crea el C02 como
  `kind = own`, código `XXX00000`): 153, 154, 160, 161, 162, 163, 240, 241, 242,
  249, 293, 294, 295, 510–514, 530–535, 539, 552, 556, 593, 594, 595 y **795**.
  Ejemplo: el modelo pone 1603/1604 en «Deudas con empresas del grupo» y 1605 en
  «Deudas con entidades de crédito»; una 160 a secas no se puede colocar sin
  saber cuál es.
- **20 partidas «a crear» o canceladas al cierre**: 1370, 1371, 150, 1533–1536,
  1543–1546, 195, 197, 199, 473, 502, 507, 550, 554, 5585.
- **678 y 778** (gastos e ingresos excepcionales → «Otros resultados»).

Hoy ninguna tiene saldo (no hay apuntes), así que **no hay nada mal presentado**;
pero la regla 2 dice que una cuenta con saldo sin línea sale en rojo, y con el
C04b alguna lo tendrá (la 473 casi seguro si hay retenciones).

### 5.3 Decisión para Julio: cómo se colocan

Propuesta, para que la migración de la tarea 2 nazca completa:
1. **Partidas «a crear»**: se cargan de serie como líneas opcionales con el texto
   que da la norma de elaboración y su cita; aparecen solo si tienen saldo.
2. **473**: con la Hacienda deudora — en pymes, «B.II.3 Otros deudores» (donde
   el modelo pone 470, 471 y 472); en normal, «B.III.5 Activos por impuesto
   corriente» (4709) —, con la cita de la norma de registro del impuesto
   corriente; el agente avisa si queda saldo al cierre (debería haberse
   cancelado contra la 4752).
3. **Cuentas de 3 cifras repartidas a 4**: van a la línea de su hija «otras»
   (p. ej. 160 → 1605) y la pantalla lo marca «colocada por defecto» con un
   «Completar» para elegir; nunca se omiten.

### 5.4 Contraste con la configuración de Diez del benchmark

**No lo he podido hacer.** El benchmark con las capturas de Diez de «Configuración
de cuentas anuales» no está en el repositorio (busqué «benchmark», «Diez»,
«configuración de cuentas anuales», «asterisco», «cargar por defecto» en todo
`docs/` y la raíz) ni en el Drive conectado. Para listar las diferencias necesito
las capturas o la exportación de esa pantalla para el modelo de pymes (que es el
de Foodint). Lo único que ya se puede decir con el encargo delante: Diez usa
cuentas con asterisco para el signo, igual que las cinco «por signo» de §5.1.

## 6. Normas: lo que hay que corregir en las citas del encargo

- **«CCom arts. 257–258»**: el Código de Comercio no tiene esos artículos sobre
  modelos abreviados (`codigo-comercio.txt` no tiene bloques `a257`/`a258`). Son
  los **arts. 257 y 258 de la Ley de Sociedades de Capital** (RDL 1/2010). Añadida
  como fuente (`rdl-1-2010-lsc`, BOE-A-2010-10544); también trae el art. 363.1.e
  que cita el encargo.
- **Los límites, literal de lo bajado** (dos de tres, dos ejercicios seguidos):

  | Norma (versión vigente) | Activo | Cifra de negocios | Plantilla media |
  |---|---|---|---|
  | LSC art. 257.1, balance y ECPN abreviados (desde 17/06/2016, Ley 22/2015) | ≤ 4.000.000 € | ≤ 8.000.000 € | ≤ 50 |
  | LSC art. 258.1, PyG abreviada (desde 01/09/2010) | ≤ 11.400.000 € | ≤ 22.800.000 € | ≤ 250 |
  | RD 1515/2007 art. 2.1, PGC de pymes (texto consolidado, versión de 2008) | ≤ 2.850.000 € | ≤ 5.700.000 € | ≤ 50 |

  **El art. 2 del RD 1515/2007 no se ha actualizado en el BOE** y sus cifras son
  las del art. 175 del TRLSA de 1989 al que se remitía; la LSC subió las del
  abreviado en 2013 y 2016. Que el ámbito de pymes siga a la LSC lo dice la
  doctrina, no el texto que tengo bajado. **Decisión de Julio** (o de su gestor):
  ¿Folvy propone pymes con los límites literales del art. 2 o con los de la LSC
  257? Propongo citar los dos en la frase de la regla 4 y, si una empresa queda
  entre ambos, decirlo en vez de decidir. Foodint (plantilla 6) cumple cualquiera
  de las dos con su tamaño; el activo y la cifra los traerá el C04b.
- **LSC art. 363.1.e** (bajado): «por pérdidas que dejen reducido el patrimonio
  neto a una cantidad inferior a la mitad del capital social…». Solo aviso.
- El resto de citas (CCom 25, 27, 28, 30; Ley 14/2013 art. 18; RIVA 62–70, 63.4,
  64.5, 69 bis; Ley 27/2014 arts. 10 y 124; ICAC 05/03/2019) se comprueban
  literal en `contraste.md` en la tarea 5.

## 7. Lo que queda en el PR como pendiente (fuera del C05)

- **La Ley del IVA, la del IRPF y su reglamento han cambiado hoy en el BOE**
  (huellas nuevas en la bajada del 08/10). Volver a bajarlos regenera
  `20261003T0130_c00_valores_de_serie.sql`, ya aplicada en producción, así que
  en esta rama se quedan como estaban; lo trae «Normativa al día», que avisa sin
  cambiar nada. El workflow de fuentes acepta ahora `solo` a mano para bajar
  únicamente lo nuevo.
- `orden-modelo-115` (404) y `eu-paises` (sin respuesta) fallaron en la bajada
  completa; se quedan las copias anteriores. No son del C05.
