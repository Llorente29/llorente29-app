# Las tablets · lo medido el 13/09, y en qué contradice al encargo

Encargo de Julio (09:15): «Quitar el bloqueo de las tablets». Su §1 dice «lo
que ya está medido no se vuelve a medir: se comprueba que sigue siendo verdad».
Se comprobó. Tres cosas no lo eran.

---

## 1 · El horario NO es 13:00 → 23:45. Hay turno partido

El encargo dice «los tres locales de Foodint, 13:00 → 23:45. De ahí sale la
ventana 00:30 → 12:15». Medido en `business_hours` (`brand_id is null`, cuenta
Foodint):

| local | L–J | V | S | D |
|---|---|---|---|---|
| Alcalá | 13:00→16:30 · 20:00→23:45 | 13:00→23:45 | **13:45**→23:45 | 13:00→23:45 |
| Carabanchel | 13:00→**15:45** · 20:00→23:45 | 13:00→16:30 · 20:00→23:45 | **17:00**→23:45 | 13:00→**23:30** |
| Plaza Castilla | 13:00→16:30 · 20:00→23:45 (todos los días) | | | **LUNES: no hay fila** |

**El número 00:30 → 12:15 es correcto, pero es un caso particular.** Por eso el
código no lo lleva escrito: lleva la REGLA que Julio describió —fuera del
horario del local, 45 minutos de margen por los dos lados— aplicada al horario
real. Comprobado sobre una semana entera, en tramos de 15 minutos:

```
Alcalá         L–J  00:30→12:15  y  17:15→19:15
               V    00:30→12:15
               S    00:30→13:00      (abre a las 13:45)
               D    00:30→12:15
Carabanchel    L    00:15→12:15  y  16:30→19:15   (el domingo cierra a las 23:30)
               S    00:30→16:15      (abre a las 17:00)
Plaza Castilla M–D  00:30→12:15  y  17:15→19:15
               L    NINGUNA          (ver punto 2)
```

**La ventana de tarde de 17:15 a 19:15 no estaba en el encargo.** Sale de la
regla sobre el dato real. La segunda llave (`safe`) la sigue guardando: con un
pedido vivo o un ticket en cola, no se aplica nada. Va dicha para que Julio
decida si la quiere.

## 2 · Un día sin horario NO es un día libre

A Plaza Castilla le falta el lunes. Por la regla, un día sin tramos sería
ventana las 24 horas. **Se hace lo contrario:** sin horario declarado hoy, no
hay ventana (`sin_horario_declarado_hoy`). La ausencia de un dato no prueba que
el local cierre, y la duda va a favor de esperar. La pantalla de oficina lo
pinta en rojo, porque eso sí pide que alguien lo arregle.

## 3 · Plaza Castilla no está operando

Última venta el **12/07**. Cero en 60 días. Su tablet («Tablet J») está
revocada y no se ve desde el 20/07. Los locales en servicio son **dos**, no
tres, y las tablets vivas **tres**: Pase y Cocina (Alcalá) y camichi4
(Carabanchel), las tres en el paquete 285, vistas al minuto.

---

## 4 · El grafo de `/estacion`, que era lo único sin medir

Recorriendo los imports estáticos desde cada entrada de ruta:

| | ficheros | fuente |
|---|---:|---:|
| Toda la app desde `main.tsx` | 694 | 10.209 KB |
| `/estacion` (`TabletStationRoute`) | 68 | 1.373 KB |
| `/cocina-tv` (`KdsKioskRoute`) | 17 | 778 KB |
| **Unión: todo lo que ve una tablet** | **69** | **1.379 KB** |
| Solo oficina, nunca alcanzable desde una tablet | 625 | 8.830 KB |

**El 90 % de los ficheros de la app no los carga ninguna tablet.** Y lo que
decide de verdad, los commits reales de los últimos 60 días que tocan `src/`:

| | commits | |
|---|---:|---:|
| tocan algo que la tablet SÍ carga | 7 | 11 % |
| **solo oficina** | **54** | **89 %** |

### Propuesta: huella por área, no dos paquetes

**Con una huella de los 69 ficheros publicada en `bundle.json`, 54 de las 61
publicaciones de los últimos dos meses no habrían tocado las tablets** — ni
descarga, ni espera, ni ventana. Nada.

Dos paquetes separados dan el mismo resultado y cuestan mucho más: dos
canalizaciones, dos manifiestos, dos caminos de rollback y la posibilidad de
que deriven — para una superficie de 69 ficheros. La huella es un número en el
manifiesto que ya existe.

**El aviso que va con la propuesta:** estas 69 salen de un recorrido de imports
ESTÁTICOS con expresión regular. No ve `import()` dinámico, ni CSS, ni assets.
La implementación de verdad tiene que sacar el grafo del propio empaquetador
—Rollup lo conoce exacto— y no de un script como este. El número sirve para
decidir; no sirve para construir.
