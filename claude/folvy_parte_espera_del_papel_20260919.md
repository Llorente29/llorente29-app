# PARTE · La espera del papel — una cifra, y por qué no sale esta noche

**19/09/2026, 19:40.** **ESCRITO Y SIN PUBLICAR.** Entra mañana por la mañana,
con la cocina parada. Decidido de común acuerdo a las 19:30.

---

## 1 · El cambio: una sola cifra

`src/native/print/printWorker.ts`

```diff
- idleAfter: 20
+ idleAfter: 200
```

`normalIntervalMs` (3 s) y `idleIntervalMs` (45 s) **no se tocan**.

**Vuelta atrás:** la misma cifra al revés, `200 → 20`. Nada más. No hay base,
no hay datos que revertir, no hay nada que limpiar.

## 2 · Dónde estaban los dos números

| | |
|---|---|
| **El sondeo** | `printWorker.ts:260` — `normalIntervalMs: 3000` (de `opts.pollMs \|\| 3000`), `idleIntervalMs: 45_000`, `idleAfter: 20` |
| **El canal de aviso inmediato** | **no existe.** Cero `realtime`, cero `postgres_changes`, cero `notify` sobre `print_job`. Comprobado por grep, no supuesto |

## 3 · Lo que no era, y costó descartarlo

- **No es la impresora**: imprime en 1,2 s.
- **No es saturación**: a las 21:00, con 500 trabajos, la espera es la más
  baja (12,4 s). Justo al revés de una cola llena.
- **No es un canal roto.** El 21,7 % que sale en menos de 2 s **no** es un
  empujón inmediato que falla cuatro de cada cinco veces: son los trabajos
  que llegan **mientras el bucle está en su modo rápido de 3 s** — media a
  3 s = 1,5 s, que es exactamente ese tramo.

**Lo que era: la rampa.** El máximo clavado en 43-45 s no es un sondeo de
45 s: es `idleIntervalMs`, el techo. La distribución plana de 0 a 45 s no es
la firma de un sondeo fijo, es la de una rampa **3 → 6 → 12 → 24 → 45 s** que
arranca a los 60 s de silencio y vuelve a 3 s en cuanto hay trabajo. Por eso
en la hora punta la espera baja: ahí el bucle nunca sale de los 3 s.

## 4 · Por qué 200, y no bajar el sondeo

A 3 s el **p90 ya es ~2,7 s**. Bajar `normalIntervalMs` mejora el tramo que ya
va bien, **no toca la cola de 20-45 s —que es la que duele—** y triplica las
consultas. Lo caro es **cuándo arranca la rampa**: hoy, a los 60 s de silencio,
y en servicio un hueco de más de un minuto es de lo más normal.

**200 ciclos ≈ 10 min de silencio.** Medido sobre los huecos reales entre
trabajos consecutivos, 13:00-23:59, 7 días:

| local | huecos | mediana | de más de 10 min |
|---|---|---|---|
| **Alcalá** | 1.534 | 0,4 min | **53 — 3,5 %** |
| Carabanchel | 731 | 0,0 min | 98 — **13,4 %** |

En **Alcalá**, que es donde duele, el bucle no saldría de 3 s en el **96,5 %**
de los huecos. **Esperado: p90 ≈ 2,7 s**, que es el criterio.

**En Carabanchel no tanto, y queda escrito:** uno de cada siete huecos pasa de
diez minutos, así que allí seguirá rampando a menudo. Hoy da igual —ese local
no imprime pegatinas y su bolsa sale al entrar—, pero **si algún día duele
allí, 200 no es suficiente y hará falta otra cosa: un aviso de verdad, no un
número más grande.**

## 5 · El coste, dicho antes

- **En servicio:** 20 consultas/min por tablet que reclama × 2 = **40/min**.
  Son las mismas de hoy en hora punta, porque hoy ya está a 3 s cuando hay
  trabajo. Lo que cambia es que deja de ramparse en los huecos.
- **Cocina en silencio:** sondea a 3 s durante 10 min en vez de 1 → **+180
  consultas** por hueco.
- **El guardarraíl del 13/08 sigue entero:** a los 60 min sin trabajo el bucle
  cae a 5 min (`CLOSED_AFTER_MS` / `CLOSED_INTERVAL_MS`). Eso es lo que
  protege de verdad a una cocina cerrada — no `idleAfter`.

## 6 · Lo que este cambio NO arregla

**Los 34 trabajos de más de 60 s** (máximos de 292 s, 241 s y 630 s en días
distintos) **no son cadencia**: son el agente caído o reconectando. **Este
cambio no los toca y no los cuento como arreglados.**

## 7 · Por qué no sale esta noche

**El worker viaja en el paquete de la tablet.** Medido en `kds_device`:

| local | dispositivo | plataforma | bundle |
|---|---|---|---|
| Alcalá | Cocina | **android** | 306 |
| Carabanchel | Tablet camichi4 | **android** | 306 |

Y un paquete **solo se aplica fuera del horario del local y con la cocina en
calma** (`station_update_window`: `enVentana` = fuera de servicio con 45 min de
margen, más `safe`). A las 21:00 no se cumple ninguna de las dos: llegaría
mañana igual, como el 13/09 con los paquetes 291 y 292.

**La instalación a mano queda descartada**, y de común acuerdo: reiniciar las
estaciones del pase en plena noche de sábado para ahorrar quince segundos de
papel pone en riesgo justo la tablet que costó la mañana del 16/09, a cambio
de poco.

**Y no se toca el circuito de impresión dos veces el mismo día.** Lo de las
17:50 aún tiene media prueba pendiente.

## 8 · Comprobado

| | |
|---|---|
| `npm run build` exacto y en limpio | ✓ |
| Pruebas | ✓ |
| Lint de `printWorker.ts`, misma vara sobre `origin/main` | **8 → 8** |

## 9 · Verificación, cuando entre

La misma consulta del encargo, **agrupada por local**, solo con trabajos
posteriores a que la tablet aplique el bundle (no a que se publique):

```sql
select l.name, count(*),
       round(avg(extract(epoch from (pj.sent_at - pj.created_at))))::int as media,
       round((percentile_cont(0.9) within group (
         order by extract(epoch from (pj.sent_at - pj.created_at))))::numeric)::int as p90
from print_job pj join locations l on l.id = pj.location_id
where pj.sent_at is not null and pj.created_at > '<hora en que la tablet aplicó>'
group by 1;
```

**Cifras de salida:** media 15 s, p90 38 s, máximo clavado en 43-45 s.
**Criterio: p90 por debajo de 3 s.**

**Y el momento que cuenta es cuándo lo APLICA la tablet**, no cuándo se
publica: `kds_device.bundle_applied` / `bundle_applied_at` lo dicen.
