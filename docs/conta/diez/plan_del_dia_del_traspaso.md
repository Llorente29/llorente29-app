# El día del traspaso a Diez: qué pulsa Julio, en qué orden

> B01r·26 (13/11). Una página. Diez real es la **C0008**. Lo de antes (el
> diseño y por qué) está en `traspaso_con_pdf.md`.

## Antes de ese día (una vez)

| | Quién | Qué | Cuánto |
|---|---|---|---|
| A | Julio | En Diez **C0008**, cargar las configuraciones de los Excel: la de recibidas del 24/10 y **la de emitidas ampliada** (ingresos 3, Grupo y Nivel3; y en recibidas, la fecha del asiento), las mismas que se prueben en la C0009. | 10 min |
| B | Julio | Fusionar el #661 (liberar octubre), el #662 (`conta-pdf`) y el #663 (los Excel), cada uno **después de su real en verde** y comprobando que Vercel dice READY. | — |
| C | D | Meter en Sumied el **4/3155** (28,00 €, compras pagadas por Julio, DL1_28) y los duplicados del IVA del 1T al 3T. | — |

## El día

| Paso | Dónde | Qué pulsa | Cómo se sabe que ha ido bien | Cuánto |
|---|---|---|---|---|
| 1 | **Diez (C0008)** | **Borrar todo lo que hay desde el 01/10** (217 asientos: 109 de la serie 1, 94 de la serie 2 y 14 de la serie 4; ninguno de noviembre). Antes, comprobar que el 4/3155 ya está en Sumied. | Diez no tiene nada con fecha desde el 01/10. | 15 min |
| 2 | **GitHub › Actions › «Aplicar SQL en PRODUCCIÓN»** (desde `main`) | `confirmo` = produccion · `tanda` = `claude-b01-paso-a-diez` · `autorizo` = `20261113T1745_b01r26_liberar_octubre.sql`. Primero **ensayo**, después **real**. | El job **guarda-diez** lee la C0008 y dice `guarda.asientos_desde = 0`; si no es 0, el real **para solo**. Después, el informe: 215 envíos en «rechazado», y los validados de octubre que el traspaso no lleva, 0. | 10 min |
| 3 | **Sumied › Libros › Cierre del mes › Traspasar a Diez**, mes **octubre** | «Traspasar octubre a Diez» → leer el resumen → **«Traspasar»** (vale como la autorización para escribir en la C0008). | Va mandando el banco, los asientos a mano y las liquidaciones: «Lo que va por la API ya está en Diez: N asientos. Faltan las M facturas, por Excel». | 20–30 min (unos 3 s por asiento) |
| 4 | La misma pantalla, **paso 2** | **«Preparar los Excel»**. Si dice que faltan subcuentas: **«Crearlas en Diez»** → «Crearlas». Después, **«Descargar emitidas»** y **«Descargar recibidas»**. | «Las N subcuentas están en Diez. Listos: X emitidas e Y recibidas». La lista «van por la API» dice cuáles no van por Excel y por qué. | 5 min |
| 5 | **Diez (C0008)** › Importaciones › Importación desde fichero › Facturas | Importar el de **emitidas** con la configuración de emitidas, y el de **recibidas** con la de recibidas. | Diez enseña las facturas, cada una con su PDF (lo descarga del enlace de Sumied). | 10 min |
| 6 | Sumied, **paso 3** | **«Ya lo he importado»**. | «N de N facturas encontradas en Diez y enlazadas» y, después, **«Cuadra»** (las ventas sumadas, grupo 700, y el resto cuenta a cuenta). Si cuadra y llegó todo, **octubre se cierra**. Si no, dice qué cuenta difiere y por cuánto. | 2 min |
| 7 | Lo mismo con **noviembre** | Pasos 3 a 6, cuando noviembre haya terminado (la pantalla no deja traspasar un mes sin acabar). | «Cuadra», y noviembre cerrado. | 45 min |

Los **13 asientos de enero a junio** (las correcciones de noviembre) **van solos en el traspaso de octubre**: están marcados en `conta_mes_cambio` y la lista del traspaso los lleva. **Si octubre se confirma después del 01/12, van en el de noviembre.** No entran en el «Cuadra» de octubre, porque el cuadre mira las fechas del mes.

## Lo que se queda sin PDF en Diez

- Lo que va por la API: **banco, asientos a mano y liquidaciones**, que no llevan PDF, y **las recibidas que no caben en el Excel** (las de 3 tipos de IVA, la autoliquidada y las de la 76900000: 7 en octubre y noviembre). Diez no admite adjuntos por la API («container does not exist», probado el 13/11 en la C0009).
- **Las facturas sin PDF en Sumied** (13 recibidas en octubre y noviembre, el 13/11) **no salen** ni por Excel ni por la API: la pantalla las lista con su enlace. Las de Just Eat las arregla S.

## Si algo falla

- **El paso 2 para con «Guarda de Diez»**: queda algo en la C0008 desde el 01/10. Se borra y se relanza.
- **«No cuadra»**: la pantalla dice la cuenta y la diferencia. «Volver a comprobar con Diez» se puede repetir; nada se manda dos veces.
- **Una factura «no está en Diez»** después de importar: se mira en Diez si la importación la rechazó (subcuenta, fecha) y se vuelve a importar solo esa.

## Diez → el programa de la gestoría (Cegid): ¿llevan las plantillas la «Url documento»?

**Sin confirmar.** No he encontrado documentación pública de las plantillas de migración de Cegid con una columna «Url documento» (búsqueda del 13/11). Lo más cercano es una guía de terceros: la importación en Cegid Diez va en un ZIP con las facturas, el plan de cuentas y una guía en PDF con la configuración del Excel. Esa guía es donde mirarlo. Si la plantilla no la admite, los PDF tendrían que ir aparte (un ZIP con cada PDF nombrado con su número de factura). Julio lo comprueba en la plantilla que le dé la gestoría.
