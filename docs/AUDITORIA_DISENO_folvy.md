# AUDITORÍA DE DISEÑO — Folvy (producto completo)

*Director de diseño de producto (externo). 04-ago-2026.*
*Material: 5 capturas reales de escritorio (Sales, Team, Safety, Kitchen-lista, Kitchen-ficha) + repositorio completo (18 módulos, ~104 páginas, `tailwind.config.js`, `src/index.css`, `src/components/ui.tsx`, `src/shell/`). Ampliado después con 5 capturas de trabajador/Pedidos — ver anexo aparte.*

> **Regla de honestidad aplicada.** Donde tengo captura, **manda la captura** (lo digo). Donde no —KDS de cocina, repartidor, tablet estación, tienda cara-al-cliente, estados vacíos— juzgo solo el markup y lo señalo como "no verificado en pantalla". Y una corrección que me debo a mí mismo: en mi lectura previa **solo del código** dije que el producto "parece joven en lo visual". **Con las capturas delante, eso era injusto: se ve bastante más maduro y coherente de lo que el código sugiere.** La razón es importante y la explico en §3.

---

## 1. VEREDICTO EN 5 LÍNEAS

1. **Maduro, no prototipo — y por un margen mayor del que yo esperaba.** Las 5 pantallas de escritorio tienen chrome consistente, aire bien medido, tarjetas KPI limpias y una jerarquía que se lee. Al lado de Toast/Square no da vergüenza; al lado de Mapal, compite.
2. La ficha de escandallo (Kitchen) es **producto de verdad**: foto a sangre, coste en vivo desglosado, "usado en 2 productos de venta", aviso de casado sin confirmar. Esa pantalla sola vende Folvy.
3. Lo que lo delata **no es fealdad sistémica, son ~6 detalles puntuales y visibles**: barras violeta huérfanas en Sales, un gráfico de APPCC que parece un electrocardiograma plano, separador decimal mezclado (`15.22%` junto a `2,36 €`), spanglish en la pantalla estrella (`Plate cost` / `Packaging`), y etiquetas de dato sucio (`Desconocido`, `Sin categoría`) a la vista.
4. La incoherencia real del código (tres "dialectos" de color, 11% de adopción de los primitivos) **casi no se ve**, porque todos los tokens resuelven al mismo negro-tinta. Es deuda de mantenimiento, no de percepción — con una excepción cara: el violeta de Sales.
5. Aplicando tu regla: en **escritorio de gerente ganas o empatas**; en **móvil/tablet —tu caso de uso principal— no puedo declararte ganador porque no tengo capturas, y el código dice que la tablet cae en una grieta (§4)**. Ahí es donde está la deuda no declarada. *(Actualizado en el anexo: las capturas de trabajador que llegaron después SÍ se ven y suben la nota.)*

---

## 2. LOS 5 PROBLEMAS VISUALES MÁS GRAVES (por impacto, con pantalla y qué hacer)

### #1 — El violeta huérfano del dashboard de Sales. *(Captura 1. Percepción en demo. 1 día.)*
En "Ventas", **"Ranking de locales" y "Mapa de calor horario" se pintan en violeta** (`#534AB7`/`#7F77DD`), mientras que justo encima **"Ventas por canal" usa barras negras**. Dos gráficos contiguos, dos idiomas de color. El violeta no aparece en ningún otro sitio del producto ni en la marca — es el único color que grita "esta pantalla la hizo otra mano". Es, además, la primera pantalla de la demo comercial. En código: `VentasDashboardPage.tsx` vive fuera del sistema de tokens (paleta `stone-*` + violeta + verdes/ámbares hex crudos; el agente contó decenas de hex ad-hoc). **Qué hacer:** repintar rankings y heatmap con la escala de marca (tinta + acento), unificar con las barras negras de "por canal".

### #2 — El gráfico "Cumplimiento diario" de APPCC parece una catástrofe. *(Captura 3. Real + demo. 1 día.)*
La línea de cumplimiento **cae a 0% todos los días y sube a 100% solo 3 veces** (los días de auditoría). Visualmente lee como "este local no cumple casi nunca" — exactamente lo contrario del 93% que dice la tarjeta de al lado. El problema es de representación: entre auditorías no hay dato, y "sin dato" se dibuja como 0. Ante un CEO, ese electrocardiograma plano es alarmante y **falso**. **Qué hacer:** no interpolar a 0 los días sin control; mostrar puntos de auditoría (o media móvil), o cambiar a barras solo en días con actividad.

### #3 — Separador decimal y spanglish en la pantalla estrella. *(Captura 5. Percepción en demo. 10 min c/u.)*
En la ficha de plato conviven **`2,36 €` (coma, es-ES) y `15.22%` (punto, formato inglés)** en la misma línea de KPIs. Y el panel "COSTE EN VIVO" mezcla idiomas: **`Plate cost`, `food cost`, `Packaging`** junto a `Comida`, `coste del plato`, `PVP sin IVA`. Es la pantalla que mejor vende Folvy, y es donde más se nota el "hecho por ingenieros". **Qué hacer:** formatear el porcentaje con `Intl.NumberFormat('es-ES')` (coma); traducir los tres literales ingleses. Media hora en total, impacto alto.

### #4 — Datos sucios expuestos al comprador. *(Capturas 1 y 3. Percepción en demo. 10 min–1 día.)*
En Sales: **"Desconocido −31,70 € · 1 ped."** como canal, con barra negativa. En APPCC: **"Sin categoría"** como barra dominante de incidencias. En Team: **"KEILYMAR"** en mayúsculas junto a nombres en capitalización normal, y **"(Sin contrato)"** como categoría. Ninguno es un bug, pero los cuatro le dicen a un CEO "el dato no está domado". **Qué hacer:** agrupar residuales bajo "Otros", ocultar categorías vacías, normalizar capitalización de nombres al mostrarlos.

### #5 — Colores semánticos inconsistentes entre gráficos. *(Capturas 2 y 3. Percepción. 10 min.)*
El donut "Incidencias por severidad" (APPCC) usa **rojo/ámbar/amarillo genéricos de Tailwind** (`#DC2626`/`#F59E0B`), no los semánticos de tu marca (`danger #E0492E` / `warning #C2890F`) — se ve un rojo distinto al del resto de la UI. Y en Team, **tres gráficos de barras contiguos usan tres colores** (local en oscuro, contrato en ámbar, puesto en verde) sin criterio semántico compartido. **Qué hacer:** pasar los colores de gráficos a los tokens de marca; fijar un criterio (p.ej. barras neutras salvo que codifiquen estado).

*(Mención aparte, no top-5 pero fácil: en la lista de Recetas —captura 4— **los 105 platos comparten el mismo icono de gorro** en gris; la ficha sí tiene foto. Poner miniatura real cuando exista sube mucho la sensación de producto. 1 día.)*

---

## 3. COHERENCIA — ¿un sistema o nueve dialectos?

**En pantalla: parece un sistema.** Y esto es lo que corrige mi lectura previa. El chrome (top-nav de 10 módulos, sidebar de 2º nivel, franja "Estás gestionando", tarjetas KPI, tabs) es **idéntico módulo a módulo** en las 5 capturas. Un gerente que salta de Sales a Team a Kitchen ve **el mismo producto**. Eso es lo que importa comercialmente, y está conseguido.

**En código: hay deuda real que hoy es casi invisible.** Los datos son contundentes: la librería de primitivos (`src/components/ui.tsx`: Button, Card, Badge, Tabs, Modal) **solo la importan 33 de 300 ficheros (~11%)**; hay **1.522 `<button>` inline**, **1.023 hex hardcodeados**, tres paletas de gris crudas (`gray-*` 577, `stone-*` 326, `zinc-*` 239) agrupadas por módulo (Kitchen=gris, Shop=naranja viejo `#FF5436`, Social=navy `#1E3A5F`), y una migración de color `terracota→accent` **congelada a medias** (189 usos legacy que renderizan negro por herencia). **Por qué casi no se ve:** todos esos tokens y alias resuelven al **mismo negro-tinta `#15171A`**, así que los "dialectos" pintan el mismo color. La bomba está desactivada… hasta el día que alguien cambie el valor del token `terracota` o del acento: entonces 189 sitios se despintan a la vez.

**Qué falta para que sea un sistema de verdad (no solo parecerlo):**
- **Terminar la migración de color** (renombrar los 17 ficheros `terracota`, ~1 día) y **sacar `#FF5436` del storefront del cliente** (1 día). Es lo único con riesgo visible a futuro.
- **Adoptar los primitivos que ya existen**, módulo a módulo, empezando por Ventas (el peor) y Kitchen. Rediseño incremental, semanas — pero es higiene, no urgencia.
- **Tres tokens fantasma que hoy rompen en silencio** (correctitud, no estética): `text-text-tertiary` (usado 50×, no existe → la jerarquía de gris se aplana), y `bg-background-info`/`text-text-info` (el chip de "merma" en Almacén sale **invisible**). Añadirlos al config arregla decenas de sitios: **10 min, alta palanca.**

**Nota de marca:** el brief dice navy `#1E3A5F` + terracota + Fraunces. En el producto real **no hay navy** (`bg-navy` = 0 usos; el primario es tinta casi negra) y la display es Space Grotesk, no Fraunces. No es un defecto —la tinta monocroma se ve bien y actual en las capturas— pero conviene que **decidas** si esa es la marca (y actualices el brief) en vez de arrastrar tres paletas muertas en el código.

---

## 4. MÓVIL / TABLET — la deuda que sí te debo declarar

**No tengo ni una captura de móvil, tablet de cocina, KDS ni repartidor.** *(Actualizado en el anexo: llegaron después las del portal del trabajador y Pedidos — se ven bien. Siguen faltando KDS terminal, repartidor, tablet estación y shop.)* Así que aquí no puedo venderte un veredicto visual; te doy lo que garantiza el código y lo marco como tal.

- **Bien resuelto (código):** los terminales dedicados —`/cocina-tv` (KDS), `/estacion` (tablet), `/repartidor`— son **pantalla completa y NO pasan por el shell** (`fixed inset-0`), así que la tablet de cocina **nunca ve la sidebar**. Buena decisión de arquitectura. El repartidor tiene objetivos táctiles correctos (`py-3` ≈44px), y la barra inferior móvil está pensada (alcanzable con pulgar, `safe-area-inset`).
- **Deuda confirmada en el rango tablet (768–1024px):** el shell tiene **un solo breakpoint en 767,98px** (`useIsMobile.ts:21`). Cualquier viewport ≥768px —iPad vertical, iPad horizontal, la mayoría de tablets de gestión— cae en el layout de **escritorio con sidebar fija de 208px** (`ModuleSidebar.tsx`, sin una sola clase responsive), que se come 20–27% del ancho. Y el `<main>` no lleva `min-w-0` (`Shell.tsx`), la condición que provoca scroll horizontal con tablas anchas. **Para un producto cuyo caso de uso principal es la tablet, esto está por debajo del mercado.**
- **Ergonomía táctil del KDS (código):** el botón "Listo" (bump de estación, la acción más repetida del cocinero) mide **~24px** (`px-3 py-1 text-xs`) — muy por debajo de los 44px. Un KDS profesional usa barras de bump de fila entera. **Probable problema real de uso, pero no verificado en pantalla.**

**Para cerrar esta sección de verdad necesito capturas de:** KDS de cocina, tablet de estación (disponibilidad/86), app de repartidor, y la tienda del comensal. Es la mitad del producto donde más se juega tu diferenciación y donde hoy voy a ciegas.

---

## 5. LO COMERCIAL

**La 1 captura para vender Folvy:** la **ficha de escandallo** (captura 5). Foto apetecible + `2,36€ coste · 15,22% food cost · 15,50€ PVP` + "COSTE EN VIVO" desglosado + "usado en 2 productos de venta". Dice en dos segundos lo que Folvy hace que nadie más: **control de margen plato a plato dentro de la operación**. (Arregla antes el punto decimal y el spanglish — captura limpia.)

**Capturas que SÍ van a la web:** la ficha de escandallo; el dashboard de **Ventas** (una vez repintado el violeta) por sus KPIs "Propias vs cedidas" —ese insight es muy vendible—; la lista de **Recetas** (limpia y creíble, con "105 platos · Validado/Revisar"); y el **Dashboard APPCC** *solo si* arreglas el gráfico plano.

**Capturas que NO, hoy:** cualquier cosa con el violeta huérfano, el electrocardiograma de APPCC, el `15.22%`/`Plate cost`, o etiquetas `Desconocido`/`Sin categoría`. Y nada con la cuenta de demo llamada **"Foodint"** si vas a vender la marca Folvy — el switcher pone "Foodint / Foodint Alcalá" (tu marca vieja) sobre el chrome "folvy"; a un CEO le chirría el doble nombre.

**Qué transmite hoy sin querer:** "software de operaciones potente y honesto, con un equipo pequeño que aún no ha pasado el peine de diseño por el 20% de las pantallas". Competente y creíble — el techo está en pulir esos detalles, no en rehacer nada.

---

## 6. QUÉ ARREGLARÍA ESTA SEMANA (por orden, con esfuerzo)

1. **Separador decimal `es-ES` en porcentajes** (`15.22%` → `15,22 %`). Global. — **10 min.**
2. **Traducir el spanglish de "COSTE EN VIVO"** (`Plate cost`/`Packaging`/`food cost`). Es la pantalla estrella. — **10 min.**
3. **Tokens fantasma** (`text-tertiary`, `background-info`, `text-info`) al `tailwind.config.js` → arregla el chip de merma invisible y aplana-de-jerarquía en decenas de sitios. — **10 min.**
4. **Falso 100% verde en cuenta vacía** (`trainingComplianceService.ts:102`, `applicable===0 → 100`): devolver "sin datos" en vez de verde. En cuenta nueva de demo es un tiro en el pie. — **10 min.**
5. **Ocultar dato sucio de la vista de demo**: agrupar `Desconocido` bajo "Otros", esconder `Sin categoría`, normalizar mayúsculas de nombres. — **10 min–1 día.**
6. **Repintar el violeta de Sales** (rankings + heatmap) con la paleta de marca; unificar el patrón KPI de los dos dashboards. — **1 día.**
7. **Arreglar el gráfico "Cumplimiento diario" de APPCC** (no interpolar 0 entre auditorías). — **1 día.**
8. **Colapsar la sidebar en el rango tablet + `min-w-0` en el `<main>`** — el arreglo de mayor impacto para tu caso de uso principal. — **1 día.**
9. *(Rediseño, no esta semana)* terminar `terracota→accent`, sacar `#FF5436` del storefront, y adoptar los primitivos de `ui.tsx` módulo a módulo empezando por Ventas.

**Regla del CEO, aplicada al cierre:** en escritorio de gerente, **ganas o empatas** y con una semana de pulido puntual quedas claramente por encima del pelotón. En **móvil/tablet no puedo declararte ganador** —ni perdedor— sin capturas, pero el código señala una deuda real en tablet que hoy está sin declarar. No la vendas como resuelta hasta verla.
