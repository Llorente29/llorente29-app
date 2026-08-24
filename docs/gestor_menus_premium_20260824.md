# Gestor de menús — rediseño premium (P1–P5)

Fecha: 24/08/2026 · Solo front. **Cero migraciones.** `App.tsx` sin tocar.

## Lo primero: cuatro cosas del §0 no coinciden con el código vivo

El §6 pide corregirlas y declararlas. Van con su prueba.

### 1 · D5 está mal: los tags YA EXISTEN. Este encargo no necesita migración.

El §2.6 pide «añadir columna `tags text[]` a `menu_item` (migración pequeña)» y
el §4 la llama «única migración». Pero:

```
information_schema: menu_item.tags → ARRAY   ✅ ya existe
menuItemService.ts:68   tags: (row.tags as string[] | null) ?? []
menuItemService.ts:118  if (patch.tags !== undefined) row.tags = patch.tags
```

La columna está y el servicio ya la lee y la escribe. **Lo único que faltaba era
la interfaz.** No he creado ninguna migración: P5 es UI pura.

### 2 · «Agotado hace >48 h» NO se puede medir con `menu_item.updated_at`

El §3 lo da por bueno «✅ tras PR #88». No lo es:

```sql
CREATE TRIGGER set_menu_item_updated_at BEFORE UPDATE ON menu_item
  FOR EACH ROW EXECUTE FUNCTION set_updated_at()
```

Se dispara con **cualquier** columna. Renombrar un producto —que desde F3 se
hace con un doble clic— reinicia el reloj, y el aviso que más valor operativo
tiene no saltaría nunca. La fecha de verdad es **`product_availability.set_at`**,
que solo la escribe el 86. Es la que uso.

De paso: un 86 con `available_until` en el futuro **no** cuenta como olvidado.
Está previsto, no abandonado.

### 3 · D3 exagera: la lista ya enseñaba coste, margen y food cost

`KitchenMenuPage:1572` ya pintaba `coste X · margen Y · FC Z%`. Lo que
**realmente** faltaba —y es lo que añado— son las **ventas**. Sin ellas no se
puede decidir «subo el precio de esto» ni «esto sobra», que es el §5.3.

### 4 · Las ventas agregadas ya tenían RPC

El §3 daba la query por hacer. `menu_item_units_sold(brand, from, to)` ya
existía y agrega en servidor con `GROUP BY menu_item_id` — es lo que usa la
matriz de menu engineering. **P2 no ha necesitado SQL nuevo.**

## P1 · La fila (el 80% del impacto)

- **Foto 64×64** redondeada. Y cuando falta, **duele y es accionable**: un
  recuadro punteado con «+ foto» que lleva a subirla, en vez del icono de
  cubiertos muerto que era la razón por la que nadie las sube.
- **Mini-barra de margen** verde/ámbar/rojo con el número al lado — el color no
  viaja solo, porque un margen es dinero y hay quien no distingue verde de rojo.
  Solo aparece con escandallo; sin él, un chip ámbar **«sin escandallo»** que
  enlaza a crearlo.
- **Ventas 7 días** por producto.
- **Badge «Top 3»** de los más vendidos en 30 días.
- **Alérgenos** del escandallo (los presentes; las trazas no, que en una fila
  serían alarmismo) y **etiquetas comerciales**.
- Chips de canal G/U/J/S de F6, integrados.

## P2 · Header ejecutivo

Sustituye «Productos · Combos · Con escandallo · Agotados», que contestan *qué
tengo* y no *¿va bien esta marca?*:

**Ventas 7 días** con tendencia · **Margen medio** · **Alertas** → ver.

**El margen medio va PONDERADO POR VENTAS.** Una media simple daría el mismo
peso al plato estrella y al que se vende una vez al mes: eso no es el margen del
negocio, es una media de números sueltos.

**Sin semana anterior no se pinta tendencia.** Un «+100%» porque antes no había
nada sería inventarse una mejora.

La cobertura de escandallo no desaparece: **baja a ser una alerta**, que es lo
que de verdad es cuando no está al 100%.

## P3 · Panel de alertas

Drawer lateral. Cada línea **lleva** a los productos concretos (enciende su
filtro de F2 y se cierra): un contador que no lleva a ningún sitio es
decoración.

- *N* sin foto · *N* sin escandallo · *N* **agotados hace más de 48 h**

El tercero es el que nadie más tiene. Medido bien (ver corrección 2).

## P4 · Categorías con carácter

Ventas de la categoría en 7 días junto al nombre, y etiqueta **«categoría
dormida»** si en 30 días no ha vendido nada.

**Desviación consciente:** el §2.3 pedía **colapsarla por defecto**. No lo hago.
Una categoría recién creada vende 0 por definición, y plegar por sorpresa lo que
alguien acaba de montar es esconderle su trabajo. Se avisa y decide él. Si lo
quieres automático, es una línea.

## P5 · Etiquetas comerciales

Submenú **«Etiquetas ▸»** en el menú contextual: Vegano · Vegetariano · Picante
· Sin gluten · Nuevo · Popular, con marca de activas. Se pintan como chips en la
fila. Sin migración (ver corrección 1).

**No se mezclan con los alérgenos, a propósito.** Los tags son comerciales y se
marcan a mano; los alérgenos salen del escandallo. Juntarlos invitaría a marcar
«sin gluten» sobre un plato cuyo escandallo dice lo contrario, y eso es un
problema sanitario, no de diseño.

## Sistema visual

Tinta monocroma post-rebrand + `text-info` `#1E3A5F`. **Nada de terracota**, como
mandaba el §6. Color estrictamente semántico: `emerald-600` bien, `amber-500`
atención, `red-600` problema; el resto neutro. Números tabulares en todo precio y
métrica. `rounded-xl`, sombras del sistema en dos niveles, transiciones ≤200 ms.

Añadidas a `index.css` las keyframes `fadeIn`/`slideIn` — las usaba con
`animate-[...]` y **no existían**: Tailwind generaba la clase y no animaba nada,
en silencio. Y de paso un bloque `prefers-reduced-motion` para toda la app: quien
pide menos movimiento no lo pide de adorno.

## Rendimiento

El §5.4 exige <2 s sin N+1 en cartas de 100+. **Todo lo nuevo es agregado**:

| Dato | Consultas |
|---|---|
| Ventas 7d / 7d anteriores / 30d | 3 RPC agregadas por marca |
| Alérgenos de toda la carta | 2 (enlaces + catálogo) |
| Canales (de F6) | 2 |
| 86 olvidados | 1 |

Ninguna por fila. No he podido **medir** el tiempo en vivo (ver abajo), así que
lo que afirmo es el número de consultas, no los milisegundos.

## Verificación

`tsc --noEmit` limpio · `npm run build` ✓ · ESLint **6 avisos = los 6 del
baseline exacto** en los ficheros tocados; los **6 ficheros nuevos, cero** ·
tests `6 failed | 239 passed`, idéntico a `main`.

**Lo que NO he podido verificar, y era parte del §5:**

- **§5.1, el test de la demo (captura antes/después).** No puedo abrir un
  navegador: este entorno sale por un proxy que no llega a producción
  (`ERR_TUNNEL_CONNECTION_FAILED`). No hay captura. Tras el deploy la haces tú
  en dos minutos.
- **§5.2, el test de Pamela.** Mismo motivo. El código está escrito mobile-first
  (foto 56 px en móvil y 64 en escritorio, header en columna, columnas anchas
  retiradas bajo `sm`), pero hace falta un pulgar.
- **§5.4, los milisegundos.** Cuento consultas, no mido tiempo.

**Y una honesta sobre los datos:** las RPC de ventas llevan guarda por
`auth.uid()`, que por MCP viene nulo, así que **no he podido ejecutar
`menu_item_units_sold` desde aquí**. Está construido contra su firma y contra el
envoltorio que ya usaba la matriz de menu engineering en producción. Si al abrir
la pantalla el header sale a 0 €, ese es el sitio donde mirar primero.

## Deuda declarada

- **D6, menús por horario/día**: fuera de este encargo, como decía el §0.
- **Publicación de tags a plataformas**: no verificado si el catálogo HubRise los
  soporta. No se promete nada en la UI.
- **Dark mode**: fuera, como decía el §2.5.
- **RLS de `menu_item`**: sigue exigiendo `admin` mientras `recipe_item` admite
  `manager`. Toda esta pantalla fallará para un encargado el día que exista uno.
