# F6 · Consecuencia esperada — Generador de informes, lote 2 (la pantalla)

Escrito **ANTES** del push. **06/09/2026, 01:05 Madrid — fuera de la banda 12:15 → 23:45.**

---

## 1 · 🔴 Este push SÍ publica OTA a las tres estaciones

Toca `src/`, así que `build-apk.yml` dispara y **se publica bundle OTA**. Sin
`[force-update]`, o sea **mandatory = false**: las tablets lo cogen en su próxima
ventana segura, nunca en mitad de un pedido. No hay gatillo nativo, así que **no
se rebuildea APK ni se reescribe `version.json`**.

**Es una sola publicación a propósito.** El servicio y las fechas llevaban desde
las 00:40 en la rama `informes-lote2` sin bajar a `main`, justamente para no
publicar una OTA por código que todavía no llamaba nadie. Ahora bajan juntos, y
lo que sale ya tiene quien lo use.

## 2 · Qué sale

| fichero | qué es |
|---|---|
| `src/pages/InformesPage.tsx` | **nuevo.** La pantalla |
| `src/modules/ventas/module.tsx` | la ruta `ventas/informes` y su entrada de barra lateral |
| `src/routes.ts` · `src/types/index.ts` | la clave `ventas_informes` |
| `src/modules/ventas/services/periodoInforme.ts` | **nuevo.** Periodo y espejo |
| `src/modules/ventas/services/reportSalesService.ts` | **nuevo.** La llamada a `report_sales` |
| `src/lib/descargaXlsx.ts` | **nuevo.** Hermano de `descargaCsv.ts` |
| `src/lib/fechas.ts` | +4 exportaciones de calendario. Sólo se añade |
| `tests/unit/modules/ventas/*` | 27 pruebas |

## 3 · Qué cambia en pantalla

Una entrada nueva en Ventas → **Informes**. No se toca ninguna pantalla
existente: ni una clase, ni un píxel.

- **Los dos ejes se eligen a la vez**, y el elegido se rotula **dentro del chip**
  (`filas · Local`, `columnas · Canal`). Nunca hay que adivinar cuál es cuál.
- **Bruto · Descuentos · Neto · Pedidos · Ticket medio**, siempre separados.
  Descuentos lleva su tasa sobre el bruto y **se pone en rojo a partir del 20 %**.
- **La banda de medida**, arriba y sin desplegar: intervalo exacto de las dos
  ventanas, filtro y regla de medida.
- **Día a día contra el espejo**, y un día por debajo del **55 %** del suyo se
  pinta en rojo. Pulsar una fila de la tabla lo abre para esa fila.
- **Coste y margen sólo con `show_costes`**, con los dos niveles de cobertura,
  sus cuatro porcentajes con unidad, la aclaración de la resta, y **el aviso de
  B73 en texto**, al lado y no en otro sitio.
- **«Programar por correo» apagado**, con el motivo escrito debajo.

## 4 · Lo que hace falta decir porque no está en la maqueta

La maqueta rotula el día a día como **«Alcalá»** mientras el filtro dice «todos
los locales»: un dibujo estático no puede expresar de dónde sale esa elección.
**Lo he resuelto haciendo la fila pulsable** — por defecto se ve el conjunto
filtrado, y al pulsar una fila el día a día se abre para ella, con el rótulo
diciendo cuál. No cambia ninguna cifra ni ninguna regla; rellena una interacción
que el dibujo implicaba. **Si no es lo que se quería, es un cambio de una línea.**

## 5 · Riesgo residual, declarado

1. **NADIE HA VISTO ESTA PANTALLA FUNCIONANDO.** No tengo sesión en la app: está
   probada por tipos, por `npm run build` y por sus 27 pruebas, y las cifras
   vienen de una RPC verificada siete veces anoche — pero **el render no lo ha
   ejecutado nadie**. Es el riesgo real de este push y no lo tapo: la primera vez
   que se abra puede haber un fallo de pintado que ninguna prueba de estas caza.
2. **`report_sales` se ejecuta hoy por primera vez de punta a punta.** Anoche
   quedó verificado el motor y la regla de ventanas, pero el ensamblado del JSON
   de `meta` sólo se puede probar con sesión — que es justo lo que pasa al abrir
   esta pantalla. **Si algo falla, será ahí**, y el mensaje de la frontera se
   enseña tal cual en vez de taparse con un «no se pudo cargar».
3. **Las 6 pruebas rojas de siempre siguen rojas** (`routes` 1, `brandsService`
   2, `salesChannelsService` 3). No son de este cambio: fallan igual en
   `origin/main`. **681 verdes de 687.**
4. **Lint: cero problemas** en los cuatro ficheros tocados, medido sólo sobre
   ellos. Hay un `eslint-disable` declarado con su motivo en el efecto que lanza
   el informe, porque el análisis estático no puede ver que la función sale del
   cuerpo síncrono antes de tocar estado.
5. **Guardar configuración es el lote 3** y el botón está apagado, no escondido.

## 6 · Cómo se verá si ha salido bien

- GitHub Actions: **una** ejecución de `Build & publish Android APK + OTA bundle`
  en verde y **ninguna** de `Desplegar edge functions`.
- Ventas → Informes, con `Semana pasada (completa)`, tiene que dar
  **13.234,93 €** de neto, **15.681,84 €** de bruto y **2.446,91 €** de
  descuentos, con Alcalá en **7.552,60 €** (332) y Carabanchel en **5.682,33 €**
  (243) — y esa cifra de neto **cuadra con la pantalla de Ventas**, porque B74
  se arregló antes justamente para eso.
- La cobertura tiene que decir **479 / 83,3 % / 11.258,79 € / 85,1 %** y
  **443 / 77,0 % / 10.325,80 € / 78,0 %**, con los **42**.

## 7 · Si sale mal

El bundle anterior sigue publicado y `mandatory = false`: ninguna tablet lo coge
en servicio. Revertir es un push que deshaga estos ficheros; **ninguna pantalla
existente depende de nada de esto**, así que quitarlo no arrastra nada.
