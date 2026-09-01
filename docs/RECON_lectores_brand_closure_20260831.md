# RECON — Lectores de `brand_closure` en el front

**Fecha:** 31/08/2026 · **Encargo:** «El banner de Orders enseña (y deja reabrir) cierres de OTRO local»
**Residual de:** `brand_closure_por_local` (29/08, migración `20260829T1802`)
**Rama:** `claude/orders-banner-location-filter-sbyzuz`

---

## 0. Lo que se verificó en BBDD antes de tocar nada

Regla 5 (verificar con la query, no con la afirmación). Ejecutado el 31/08 contra producción:

```sql
select bc.brand_id, b.name, bc.location_id, l.name, bc.resume_at, bc.set_at, bc.surface
from brand_closure bc
join brand b on b.id = bc.brand_id
join locations l on l.id = bc.location_id
order by b.name, l.name;
```

| marca | local | `location_id` | `resume_at` | `set_at` |
|---|---|---|---|---|
| Meraki Pita | Foodint Carabanchel | `92d7656e-082e-452a-8ebc-236b2d6ebf5f` | **null** | 30/08 20:51 UTC |
| Milanesa House | Foodint Carabanchel | `92d7656e-082e-452a-8ebc-236b2d6ebf5f` | **null** | 31/08 11:10 UTC |

Dos filas, las dos de Carabanchel, las dos sin hora de reapertura. **El dato está bien.**
Es exactamente lo que Julio vio en el banner de Alcalá: el lector no filtraba.

Y las firmas en producción (`pg_proc`), que deciden qué puede hacer el front:

```
closed_brands            (p_account_id uuid, p_token text)                 ← SIN local
anomalous_brand_closures (p_account_id uuid, p_token text)                 ← SIN local
brand_status             (p_brand_id uuid, p_token text, p_location_id uuid)
set_brand_status         (p_brand_id, p_mode, p_location_id, …)            ← local obligatorio
set_brand_status_by_token(p_device_token, p_brand_id, p_mode, …)           ← local del dispositivo
```

**Consecuencia de diseño:** las dos RPC de lista devuelven la cuenta entera cuando se llaman con
sesión, y no hay dónde pasarles un local. Pero **ya devuelven `location_id` y `location_name` en
cada fila** (verificado en `prosrc`), así que el front tiene todo lo que necesita para decidir qué
es suyo. **Este arreglo no toca la base de datos: no hay migración que ejecutar, ni acoplamiento
entre desplegar el front y aplicar SQL.** Filtrar en el lector es donde faltaba la decisión.

---

## 1. Barrido: lectores de `brand_closure` en el front

Criterio del encargo: **cada lector o filtra por local, o enseña el local en la fila.**
Ninguno puede pintar un cierre sin decir de qué local es.

### 1.a Capa de servicio — `src/modules/kds/services/kdsService.ts`

| # | Función | RPC | Antes | Veredicto | Ahora |
|---|---|---|---|---|---|
| S1 | `getClosedBrandsByScope` | `closed_brands` | ❌ era `getClosedBrands(accountId, token)`: lista plana de toda la cuenta | **CORREGIDO** | `locationId` obligatorio; devuelve `{ aqui, otrosLocales }` |
| S2 | `getAnomalousBrandClosuresByScope` | `anomalous_brand_closures` | ❌ era `getAnomalousBrandClosures(accountId, token)`: idem | **CORREGIDO** | `locationId` obligatorio; devuelve `{ aqui, otrosLocales }` |
| S3 | `getBrandStatus` | `brand_status` | ✅ ya pasaba `locationId` (arreglado el 29/08) | **FILTRA** | sin cambios |
| S4 | `setBrandStatus` (escritura) | `set_brand_status` | ✅ `locationId` obligatorio sin default | **FILTRA** | sin cambios |
| S5 | `setBrandStatusByToken` (escritura) | `set_brand_status_by_token` | ✅ el local sale del dispositivo | **FILTRA** | sin cambios |

**La garantía estructural:** las funciones planas `getClosedBrands` / `getAnomalousBrandClosures`
**ya no existen** — no están exportadas, no hay forma de llamarlas. Un lector nuevo no puede
"olvidarse" de filtrar porque no existe la firma sin filtrar. `locationId` va **sin default**, por
la misma razón que en `set_brand_status`: un opcional con default `null` volvería a significar
«todos los locales», que es justo el fallo. Escribir `null` es una decisión que se ve en el
código y significa «no hay local con el que contrastar» (consolidado, o token — ahí la RPC ya
acotó por el dispositivo).

### 1.b Componentes

| # | Componente | Dónde vive | Antes | Veredicto | Ahora |
|---|---|---|---|---|---|
| C1 | `ClosuresChip` | Pedidos (el banner del incidente) | ❌ `getClosedBrands` sin local: el titular contaba los cierres de toda la cuenta | **CORREGIDO** | titular = solo este local; lo de fuera, línea gris aparte |
| C2 | `ClosedBrandsCard` | Disponibilidad (web + tablet) y detalle del chip | ❌ listaba toda la cuenta **con botón Reabrir**. Sí enseñaba `location_name`, pero eso no basta cuando hay un botón al lado | **CORREGIDO** | `locationId` obligatorio; dos bloques, botón solo en el de aquí |
| C3 | `ClosureAnomalyAlarm` | Pedidos (alarma roja) | ❌ `getAnomalousBrandClosures` sin local: un olvido de Carabanchel hacía sonar la alarma en Alcalá, con Reabrir | **CORREGIDO** | la alarma roja solo por lo de aquí; lo de fuera, bloque gris sin botón |
| C4 | `BrandCloseControl` | Disponibilidad (modal «Cerrar marca») | ✅ ya usaba `resolvedLocationId` y bloqueaba en consolidado; ya enseñaba «Cerrada en X (N de M locales)» por regla 7 | **FILTRA + ENSEÑA LOCAL** | sin cambios |
| C5 | `LocationStatusCard` | Disponibilidad / detalle del chip | ✅ no lee `brand_closure` (lee `location_status`), y ya va por local | **NO APLICA** | sin cambios |
| C6 | `AvailabilityBoard` | layout compartido | pasaba `accountId`/`token` a C2 pero no el local | **CORREGIDO** | pasa `locationId` a `ClosedBrandsCard` |
| C7 | `OrdersFeed` | Pedidos | pasaba `accountId`/`token` a C3 pero no el local | **CORREGIDO** | pasa `locationId` a `ClosureAnomalyAlarm` |

### 1.c Fuera del front (comprobado, no tocado)

| Lector | Veredicto |
|---|---|
| `supabase/functions/availability-watchdog/index.ts` | Cuenta cierres rancios para la alarma por email a operaciones. Es un **contador de backend**, no pinta filas ni ofrece botón: no aplica el criterio de pantalla. Sin cambios. |
| `brand.closure_mode` y las otras 4 columnas obsoletas | **Ningún lector del front las usa.** Solo aparecen en dos comentarios (`ClosureAnomalyAlarm`, `kdsService`). Esto cierra la condición (2) del disparador de borrado escrito en la migración del 29/08. |

### 1.d Rutas de escritura — «no existe camino que reabra otro local»

Los cinco sitios desde los que se puede disparar una reapertura, y por qué ninguno puede
apuntar al local equivocado:

| Camino | Local que viaja | Por qué no puede descuadrar |
|---|---|---|
| `ClosedBrandsCard` · sesión | `b.location_id` de **la fila** | La fila solo existe en el bloque `aqui`, que es el local seleccionado |
| `ClosedBrandsCard` · token | el del dispositivo | Con token la RPC ya devolvió solo su local: `otrosLocales` viene vacío |
| `ClosureAnomalyAlarm` · sesión | `c.location_id` de **la fila** | Idem: solo el bloque `aqui` tiene botón |
| `ClosureAnomalyAlarm` · token | el del dispositivo | Idem |
| `BrandCloseControl` | `resolvedLocationId` | Bloquea en consolidado con mensaje explícito |

Los bloques «en otros locales» **no tienen botón**: no hay `onClick` que los alcance.
Ver no es tocar.

---

## 2. Los cinco puntos del encargo

1. **El banner filtra por el local seleccionado.** `ClosuresChip` cuenta solo `aqui`. Con Alcalá
   elegido y los dos cierres en Carabanchel, el titular ya no dice «2 marcas cerradas».
2. **Barrido completo.** Tablas 1.a–1.d: 5 funciones de servicio + 7 componentes + 2 lectores
   fuera del front, con veredicto uno a uno.
3. **Reabrir lleva el local dentro y a la vista.** El botón dice «Reabrir en Foodint Carabanchel»
   y, en dos pasos, la confirmación dice la frase entera: «¿Reabrir Meraki Pita en Foodint
   Carabanchel?». Antes era un «Reabrir» mudo a un toque.
4. **«indefinido» → «sin fecha de reapertura».** `resume_at` null no es un dato que falta: es una
   de las duraciones que ofrece el propio selector («Hasta que reabra a mano»). El texto vive en
   `textoReapertura` y está probado.
5. **Otros locales, en sección aparte y sin acción.** Bloque separado, etiquetado con el nombre
   del local, sin botón, con el pie «Se gestionan desde su propio local».

### Regla 7, aplicada a los dos niveles

Esta pantalla tiene un aviso que **interrumpe** y un detalle que **se abre a propósito**, y la
regla 7 los trata distinto:

- **`ClosureAnomalyAlarm` (interrumpe)** → el banner rojo que grita **filtra**: solo salta por los
  olvidos de este local. Ahí filtrar es respeto por la atención de quien está en el pase; la
  cocina de Alcalá no puede resolver —ni debe resolver— un olvido de Carabanchel.
- **`ClosuresChip` + `ClosedBrandsCard` (se abren a propósito)** → **no ocultan ninguna fila.**
  Lo de otros locales se ve, etiquetado, sin botón.
- **El contador nunca miente en verde.** Si no hay nada cerrado aquí pero sí fuera, la píldora
  **no desaparece**: se pinta en gris —«Aquí todo abierto · 2 marcas cerradas en otros locales»—
  y se despliega a la lista. Sin nota al pie del tipo «y además hay N que no te enseño»: si hace
  falta esa nota, el filtro está en el sitio equivocado.

---

## 3. Verificación

| # | Exigido | Cómo queda |
|---|---|---|
| 1 | Alcalá NO lista los 2 cierres de Carabanchel como propios; Carabanchel sí | `partirPorLocal` con los ids reales de producción: 6 casos en `tests/unit/modules/kds/closureScope.test.ts`, incluido el caso mixto y el «ninguna fila se pierde ni se duplica» |
| 2 | Reabrir desde Carabanchel reabre SOLO Carabanchel, y el empuje lleva ese `location_id` | El front pasa `b.location_id` de la fila a `set_brand_status(p_location_id)`. De ahí en adelante es el núcleo del 29/08, ya en producción: `_set_brand_closure_core` borra `where brand_id = … and location_id = v_loc` y manda `'location_id', v_loc` a `availability-dispatch`. **Comprobación en vivo pendiente de Julio** (pulsar Reabrir con Carabanchel seleccionado y verificar que la fila desaparece de `brand_closure`) |
| 3 | No existe camino que reabra otro local | Tabla 1.d: los cinco caminos, con el local que viaja en cada uno. Los bloques de otros locales no tienen `onClick` |
| 4 | Barrido documentado | Este fichero |
| 5 | build + tsc + lint limpios | `tsc -b` sin salida · `vite build` ✓ en 9,80 s · `eslint` sobre los ficheros tocados: **los mismos 3 hallazgos que ya había en main** (dos en `OrdersFeed`, uno en `ClosedBrandsCard`, todos preexistentes y solo desplazados de línea), **cero nuevos**. Suite: 13 tests nuevos, todos verdes; los 6 fallos restantes son los mismos que fallan en main |

### La comprobación que Julio tiene que hacer en pantalla

1. Selector en **Foodint Alcalá** → Pedidos. La píldora **no** dice «2 marcas cerradas». Dice
   «Aquí todo abierto · 2 marcas cerradas en otros locales», en gris. Al desplegar: las dos, con
   «Foodint Carabanchel» al lado y **sin botón Reabrir**.
2. Selector en **Foodint Carabanchel** → Pedidos. Píldora roja: «2 marcas cerradas · sin fecha de
   reapertura». Al desplegar: las dos con «Reabrir en Foodint Carabanchel».
3. Pulsar Reabrir en Milanesa House → sale «¿Reabrir Milanesa House en Foodint Carabanchel?».
   Confirmar. Comprobar en BBDD que queda una sola fila:
   ```sql
   select b.name, l.name from brand_closure bc
   join brand b on b.id = bc.brand_id join locations l on l.id = bc.location_id;
   ```

---

## 4. Deuda que queda anotada

- **Las dos RPC siguen devolviendo la cuenta entera.** Se filtra en el cliente porque cada fila ya
  trae su `location_id`, y porque así el arreglo se despliega solo, sin SQL que ejecutar. Si algún
  día una cuenta tiene tantos locales que la lista pese, el paso siguiente es un `p_location_id`
  en `closed_brands` / `anomalous_brand_closures` — y por la regla 2, eso es **DROP + CREATE**,
  nunca `CREATE OR REPLACE`. No es urgente: hoy son dos filas.
- **Condición (2) del borrado de `brand.closure_*` cumplida:** el front no lee ninguna de las cinco
  columnas obsoletas (ver 1.c). Faltan la (1) —ninguna función de BBDD las nombra— y la (3) —30
  días sin llamadas de 5 argumentos—, que se comprueban con las queries escritas en la migración
  del 29/08.
- **`border-default` es una clase muerta** (encontrado de paso). El token del theme se llama
  `border-default`, así que la clase correcta es `border-border-default`; `border-default` a secas
  no existe en Tailwind y se ignora **en silencio** — el mismo caso que el `text-text-tertiary`
  documentado en `tailwind.config.js`. Los bloques nuevos de este encargo usan
  `border-border-default`. Queda al menos un uso muerto preexistente en `OrdersFeed.tsx`
  (`border-b border-default`, la barra de filtros): **no se toca aquí** porque arreglarlo cambia
  el aspecto de una pantalla en producción y eso es otro encargo. `grep -rn "border-default"`
  filtrando los `border-border-default` da el inventario.
