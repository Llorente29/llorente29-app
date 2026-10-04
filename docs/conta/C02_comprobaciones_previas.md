# C02 · Plan contable — comprobaciones previas (tarea 1)

> 04/10/2026. Rama `conta/c02-plan-contable`, desde `main` en `10a90e24`.
> Producción y staging en **solo lectura** (SELECT). No se ha aplicado nada, no
> se ha escrito código de la pantalla: esto es el informe y **paro** aquí.
> Lo que va en negrita al final son decisiones de Julio antes de la tarea 2.

## 1. Qué hay hoy de cuentas contables

### Base (producción, solo lectura, 04/10; toda cifra lleva cuenta — regla 9)

| Dónde | Qué guarda | Datos hoy |
|---|---|---|
| `supplier.ledger_account_code` | Subcuenta del proveedor | **0 de 19** en Foodint; 0 de 23 en Folvy Interno |
| `company_tax_profile.chart_kind` / `account_digits` | Plan (pymes/general) y longitud | 1 empresa (Foodint): `pymes`, `8` |
| `tax_rate.pgc_input_hint` / `pgc_output_hint` | 472 / 477 (lo que enseña Tablas generales › Impuestos) | catálogo del C00 |
| `withholding_rate.pgc_hint` | 4751 | catálogo del C00 |
| `expense_category.pgc_account_hint` | 600, 602, 621–629 | catálogo del C00 |
| `treasury_account.pgc_hint` | 572 | Foodint: 1 cuenta |
| `payment_method.treasury_account_id` | Banco del medio de pago | 0 puestos |
| `general_row_setting` (pistas pgc) | Cuenta propia de una fila de tabla general | 0 |
| `analysis_account` | — | vacía |
| `recipe_family.accounting_category`, `ingredient_family_template.accounting_category` | Categoría contable de Cocina | todas a NULL |

Funciones que nombran cuentas: `conta_ia_campo_permitido`, `conta_sugerencias_calcular`.
Migraciones que las crean o tocan: C00 `0110`, `0120`, `0130` (32 menciones),
`0160`, `0170`, `0180`, `0200`; C01 `0100`.

**Clientes:** la tabla `customer` es de consumidores de Shop (teléfono, correo,
marca; Foodint 3). **No hay tabla de clientes fiscales hasta el C03**, así que la
«430 por cliente» no tiene a quién colgarse hoy (ver decisión D5).

### Código (`main`)

- `src/modules/conta/lib/pgc.ts`: `NOMBRE_CUENTA_PGC` (600–629, 129, 472, 477,
  4751, 570, 572), `cuentaPgc`, `DIGITOS_MINIMOS = 4`, `DIGITOS_MAXIMOS = 12`,
  `codigoDeApunte(codigo, digitos)` (rellena con ceros, 8 por defecto).
- Bloque «Detalle contable» de Tu empresa: `empresa/apartados.ts`,
  `ApartadosEmpresa.tsx`, `datosEmpresa.ts`, `services/empresaDatosService.ts`.
- Tablas generales (Detalle contable por fila): `tablas/TablaGeneral.tsx`,
  `tablas/registro.ts`, `tablas/usadas.ts`, `services/tablasService.ts`,
  `services/fichaTablasService.ts`.
- Ficha de proveedor: `proveedor/Contabilidad.tsx`, `services/proveedorService.ts`.
- Alta: `alta/ConversacionAlta.tsx`, `services/altaService.ts`; IA: `ia/tipos.ts`;
  `lib/opcionesFicha.ts`; `types.ts`.
- Fuera de conta: `kitchen/services/ingredientFamilyService.ts`
  (`accounting_category`), `multitenancy/services/analysisAccountsService.ts`.

### Edge functions

En el repositorio, **ninguna** nombra un campo de cuenta (grep sobre
`supabase/functions`). No he comparado contra lo desplegado: es medida del
repositorio, no de producción.

## 2. Fuentes oficiales

- **Ya se descargan desde Actions** (C00, `scripts/conta/fuentes.mjs`): texto
  consolidado del BOE por la API de datos abiertos, `BOE-A-2007-19965` (RD
  1514/2007, general) y `BOE-A-2007-19966` (RD 1515/2007, pymes), http 200,
  en `docs/conta/fuentes/textos/` y con huella en `registro.json`. El cuadro de
  cuentas (cuarta parte) va dentro, en texto: no hace falta PDF ni AEAT.
- **Formato:** bloques `## [grupoN]` con `### versión · vigente desde AAAA-MM-DD ·
  BOE-…`; manda la última versión. El código va solo en su línea («472.») y el
  título en la siguiente; 4 códigos van sin punto (`203`, `2804`, `406`, `485`):
  el lector tiene que aceptar las dos formas.
- **RD 1/2021:** el general trae versiones de 2021 en los grupos 1, 2, 5, 6, 7, 8
  y 9 (y 2016 en el 2). El de pymes **no** trae versión 2021 en ningún bloque del
  cuadro: su cuadro vigente es el de 2007.

## 3. Cuántas cuentas trae cada plan (versión vigente, contadas del texto)

| Plan | Total | 2 díg. | 3 díg. | 4 díg. | 5 díg. | Grupos |
|---|---|---|---|---|---|---|
| Pymes | 772 | 62 | 347 | 353 | 10 | 1–7 |
| General | 896 | 78 | 420 | 388 | 10 | 1–9 |

(Los 2 dígitos son subgrupos; los grupos de 1 dígito van aparte.)

- **Pymes no tiene grupos 8 ni 9**: confirmado, ni un código empieza por 8 o 9.
- Solo en pymes: **12** códigos. Solo en general: **133** (casi todo grupos 8 y 9).
  Mismo código con título distinto: **27**.
- **Cambio pymes → general:** las cuentas de pymes siguen existiendo en el general
  salvo 12; esas 12 hay que reasignarlas (propuesta con porqué, decide la persona)
  antes de cambiar, y las 27 cambian de título oficial (la subcuenta conserva el
  suyo). Se añaden los grupos 8 y 9. **General → pymes** es al revés y además
  deja sin sitio todo lo apuntado en 8/9: debe bloquearse si hay apuntes ahí.
  Antes del primer asiento, el cambio es libre; después, con datos y propuesta
  (lo que el encargo llama «cambio de plan con datos»).

### 3.1 Erratas del propio BOE — no se puede copiar «literal» a ciegas

El mismo texto trae el cuadro dos veces: la **cuarta parte** (cuadro) y la
**quinta** (definiciones y relaciones). No coinciden:

- **Pymes, 19 diferencias.** Graves: `232`, `233`, `237`, `239` salen todas como
  «Propiedad industrial» en el cuadro (la quinta parte da sus títulos reales);
  `606` sale como «Proveedores, otras partes vinculadas». Leves: «alargo»,
  «Gastor», «PRODUCTOSTERMINADOS», «CARÁCTERÍSTICAS».
- **General, 23 diferencias.** Grave: líneas pegadas en `500`/`501` que corren
  los títulos. Leves: «DETERIOROY», «DONACIONESY», etc.

Si la serie es «título oficial, literal» del cuadro, consagramos estas erratas.
Propuesta: el lector toma el cuadro, contrasta con la quinta parte y **una lista
de correcciones escrita en el repositorio**, cada una con su cita (sección y
texto de la quinta parte), es lo único que puede pisar el literal. El agente que
compara serie = BOE la usa como excepciones conocidas. (D1)

### 3.2 Rellenar con ceros choca padre e hijo

Con 8 dígitos, `470` y `4700` dan los dos `47000000`. Choques así: **53 en
pymes, 65 en general**. Si se quiere una subcuenta de serie por cada código, solo
caben las **hojas** (códigos sin hijos): **615 pymes, 712 general**. No sé de
dónde sale el «309 cuentas» de la maqueta (N6/N5): no coincide con ninguna de
estas medidas. (D2)

Y la longitud: el encargo dice 6–12; el código vigente admite 4–12
(`DIGITOS_MINIMOS = 4`). Con 4 dígitos no caben ni las cuentas de 4 del BOE más
una subcuenta. (D3)

## 4. Staging (cuentas de prueba)

| Cuenta | Empresas | Plan | Proveedores | Bancos | Tipos de gasto / impuestos / retenciones propios |
|---|---|---|---|---|---|
| A `c01a…000a` | 2 (Taberna de Prueba Norte S.L., «Pepeoto lopez, s.l.») | pymes · 8 | 5 | 1 («Cuenta principal», 572) | ninguno |
| B `c01b…000b` | 1 | pymes · 8 | 3 | 0 | ninguno |
| C `c01c…000c` | 0 | — | — | — | — |

Para que las semillas cubran todos los casos faltan: una empresa en **general**,
un banco en B (y uno con dos cuentas), medio de pago con banco, alguna fila de
tabla general con cuenta propia, proveedores con y sin subcuenta, y una empresa
con **numeración agotada** (99 proveedores con prefijo 400000 a 8 dígitos). Todo
inventado, nada de Folvy Interno.

## 5. Contraste (Odoo medido; Holded, Pennylane y Diez pendientes)

**Odoo 18, `l10n_es`** (descargado de su repositorio público):

- Plantilla `es_pymes` («SMEs (2008)») hereda de `es_common_mainland`;
  `account.account-es_common.csv` trae **588** cuentas (222 de 3 dígitos, 355 de
  4, 10 de 5, 1 de 6 = `572998`) y `es_pymes.csv` añade **44** propias.
- **No guarda el cuadro, guarda cuentas de apunte**: `4000` «Proveedores
  (euros)», `4100`, `4300`, en vez de `400`. Por defecto: a cobrar `4300`, a
  pagar `4100`, gasto `600`, ingreso `7000`; bancos con prefijo `572`, caja
  `570`, transferencias `57299`.
- **No es literal**: corrige erratas (232 bien, `6060` «… de mercaderías») y
  redacta a su manera («Hacienda Pública. IVA soportado»). No dice de dónde sale
  cada corrección. Nosotros sí podemos (3.1).
- No tiene «qué se apunta aquí» en lenguaje de la calle ni vigencia por norma.

**Holded y Pennylane:** sus páginas de ayuda no se alcanzan desde el contenedor
(el proxy las corta). Lo que hay es lo del C01b (`contraste.md`: plan y dígitos
bloqueados tras el primer asiento) y lo que trae el propio encargo.

**Cegid Diez:** las capturas de Julio («formato de cuentas», «dígitos del plan»,
«cambio de subcuentas», «renumerar») **no venían en este mensaje** (solo
`maqueta_C02_v3_2.zip` y el encargo). Sin ellas no puedo decir qué cubrimos de
cada una. (D6)

## 6. Maquetas

Copiadas en `docs/conta/maquetas/c02/` (N5Plan, N6Ajustes, N7FichaConta, con su
LEEME). Una discrepancia: **N5Plan aún enseña pestañas**, y el encargo y N6 usan
el índice lateral. Sigo N6 salvo que digas otra cosa. (D7)

## 7. Decisiones para Julio

- **D1 · Erratas del BOE.** ¿Serie = cuadro literal, o cuadro + lista de
  correcciones con cita de la quinta parte? Propongo lo segundo.
- **D2 · Qué entra de serie.** ¿Todos los códigos (con los 53/65 choques al
  rellenar) o solo las hojas (615/712)? ¿Qué cuenta el «309» de la maqueta?
- **D3 · Longitud.** ¿6–12 como el encargo (y subo el mínimo del código de 4 a
  6) o se mantiene 4?
- **D4 · Cambio de plan.** ¿Vale lo de 3: pymes → general con propuesta para las
  12, y general → pymes bloqueado si hay apuntes en 8/9?
- **D5 · 430 por cliente.** Sin clientes fiscales hasta el C03: ¿se deja la 430
  genérica ahora, o una subcuenta por plataforma (Glovo, Just Eat, Uber…)?
- **D6 · Capturas de Diez.** Pásamelas para cerrar el contraste.
- **D7 · N5Plan.** ¿Índice lateral como N6, confirmado?

**Pendientes de antes, que siguen aparte:** regeneración completa de
`src/types/database.ts` (encargo propio, vista a vista); `read_iban` lo rellena
la lectura de facturas; restyle de «Artículos que le compras»; entrada de menú
«Clientes y proveedores».
