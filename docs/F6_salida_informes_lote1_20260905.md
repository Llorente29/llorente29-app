# F6 · Consecuencia esperada — Generador de informes, lote 1 (la consulta)

Escrito **ANTES** del push. **05/09/2026, 23:57 Madrid — fuera de la banda 12:15 → 23:45.**

---

## 1 · Qué sale, y qué NO dispara

Cuatro ficheros de migración y este documento. **Nada bajo `src/`**, así que
`build-apk.yml` **no** se dispara y **no se publica bundle OTA**. Tampoco
`supabase/functions/`, así que `deploy-edge-functions.yml` tampoco. Comprobado en
los dos workflows antes de empujar: `build-apk` ignora `supabase/**`, `docs/**` y
`**/*.md`; el de edge functions sólo dispara con `supabase/functions/**`.

**Las cuatro migraciones ya están aplicadas a la base** (23:50–23:54). Este commit
las lleva al repositorio con **su misma versión** (regla 17). No ejecutan nada
nuevo al llegar.

| versión | qué hace |
|---|---|
| `20260905215055_report_sales_motor` | `_report_sales_rows`: el motor, sin guarda |
| `20260905215145_report_sales_frontera` | `report_sales`: la frontera que autoriza |
| `20260905215301_report_sales_regla_de_ventanas` | `_report_ventanas_validas`: la regla, extraída para poder probarla |
| `20260905215405_report_sales_frontera_delega_la_regla` | la frontera deja de tener su copia y delega |

## 2 · Qué cambia hoy para alguien que use la app

**Nada.** Las tres funciones son nuevas y **no las llama ni una línea de `src/`**.
El lote 1 es la consulta; la pantalla es el lote 2. Se publica ahora porque una
función viva sin commit es una corrección con fecha de caducidad (regla 1).

## 3 · Las decisiones que lleva dentro, y por qué

- **Bruto := neto + descuentos**, del cabecero. Única definición con la que
  bruto − descuentos = neto en todos los canales. **Convenio de signo escrito en
  la cabecera del motor**: `desviación := cabecero − líneas`; negativa = las
  líneas suman más. Con ese convenio, lastapp·glovo de la semana 24→30/08 da
  **−992,71 €**. La suma de líneas no se pinta (B75).
- **Motor sin guarda, frontera con guarda** (principio 5). No es un atajo: es lo
  que convierte la prueba de inquilino en algo que **se ejecuta**. Dos funciones
  de este proyecto (`preview_modifier_impact_cost`, `sales_dashboard`) no se
  pueden verificar desde SQL justo por no tener esa separación.
- **Las dos ventanas se reciben, no se deducen.** `p_from − (p_to − p_from)`
  desalinea una hora la semana del cambio de hora — medido: esa semana dura
  `7 days 01:00:00`. El huso ya está resuelto en `src/lib/fechas.ts`.
- **La frontera se niega** a comparar ventanas de distinta duración sin declarar
  periodo de calendario, con ±1 h de margen por el cambio de hora.
- **Ejes por `id`, nunca por nombre ni por slug.** `Foodint Alcalá` existe en dos
  cuentas y `slug='uber'` en tres.
- **El hueco se etiqueta, no se tira**: `(sin local)`, `(sin canal)` (regla 7).
- **La cobertura va en dos niveles con sus cuatro porcentajes y su unidad**, más
  la advertencia de B73 **en texto**: un sesgo no tiene porcentaje que enseñar.

## 4 · Verificaciones, con su salida

| | resultado |
|---|---|
| **V1** caso literal | 94 ped. · neto **1.979,11** · dto **1.387,16** · bruto **3.366,27**; espejo recortado **58** · **1.153,50** ✅ |
| **V2** §5 | Alcalá **7.552,60** (332) / **9.714,62** (438) · Carabanchel **5.682,33** (243) / **5.948,17** (258) ✅ |
| **V3** inquilino | Foodint sus 2 locales; Kitchen Grill sus **53** pedidos; Folvy Interno nada. Cero cruce ✅ |
| **V4** huso | El 31/08 sale **0** en la semana 24→30 y **62 ped. · 1.523,36 €** en la que empieza el 31 ✅ |
| **V5** parcial | Aborta: «5 days 22:58:00 vs 7 days». Pasan: espejo recortado, dos semanas, semana del cambio de hora y meses declarados ✅ |
| **V7** cobertura | A **479** / **83,3 %** / **11.258,79 €** / **85,1 %** · B **443** / **77,0 %** / **10.325,80 €** / **78,0 %** · **42** con modificador cobrado sin impacto ✅ |

**Repo = base:** las cuatro migraciones tienen la **misma huella de código** que
lo que corrió, comparadas con la misma normalización a los dos lados. La única
diferencia son los comentarios, y la versión documentada es la que se guarda.

## 5 · Riesgo residual, declarado

1. **`report_sales` no se ha podido ejecutar de punta a punta desde aquí:** su
   guarda de cuenta rechaza a este rol, que es lo correcto. Lo verificado es el
   **motor** —que es donde están todas las cifras— y **la regla de ventanas**, ya
   extraída para poder probarla. Lo único no ejecutado es el ensamblado del JSON.
   **Queda como deuda hasta el lote 2**, que la llamará desde la app con sesión.
2. **El `p_calendario` es una declaración, no una comprobación.** Quien pide
   «este mes» tiene que marcarlo; si no lo marca, la frontera aborta — falla del
   lado seguro, pero falla.
3. **B74 sigue abierto**: mientras la pantalla de Ventas reste el descuento dos
   veces, el generador y esa pantalla **no van a cuadrar**. Va antes del lote 2.
4. **B75 queda esquivado, no resuelto.** El porte está en el cabecero y no en las
   líneas, distinto según pasarela.

## 6 · Cómo saber si ha ido mal

`select count(*) from pg_proc where proname in ('report_sales','_report_sales_rows','_report_ventanas_validas')`
tiene que dar **3**, una firma cada una. Si diera más, hay sobrecarga (regla 2) y
las llamadas se vuelven ambiguas. Comprobado tras aplicar: 1 · 1 · 1.
