# Folvy — Estudio de demanda para previsión de personal

**Fuente:** histórico real de tickets (tspoon/Last export `tabs-report-*.csv`), CloudTown / marcas
Llorente29, canales Glovo + Uber.
**Muestra:** 28.685 tickets · 1.035 días con datos · junio 2023 → julio 2026 (~3,1 años).
**Fecha del estudio:** 2026-07-10.

> Este documento es la **fuente de verdad** de los coeficientes que alimentan la previsión de
> demanda del cuadrante (Capa 3). Se recalcula cuando entren más datos (p. ej. 20-30 locales) —
> el motor no cambia, solo los números.

---

## 1. Modelo de previsión

```
previsión_del_día = base_local × índice_día_semana × índice_mes × factor_tendencia
```

- **base_local**: media reciente de la carga del local (platos/día o tickets/día).
- **índice_día_semana**: cuánto pesa cada día respecto a la media (tabla §2).
- **índice_mes**: estacionalidad (tabla §3).
- **factor_tendencia**: peso a lo reciente (el negocio crece, §4).

Todos los índices están **normalizados a media 1,0**: multiplicar por 1,45 = "un 45 % por encima
de un día medio"; por 0,65 = "un 35 % por debajo".

---

## 2. Índice por día de la semana (patrón muy estable, 3 años)

| Día | Índice | Lectura |
|-----|--------|---------|
| Lunes     | 0,83 | flojo |
| Martes    | 0,65 | **el más flojo** |
| Miércoles | 0,77 | flojo |
| Jueves    | 0,87 | medio-bajo |
| Viernes   | 1,20 | fuerte |
| Sábado    | 1,22 | fuerte |
| Domingo   | 1,45 | **el rey** |

Un domingo mueve **~2,2× un martes**. Se repite los 3 años → coeficiente fiable.

---

## 3. Índice de estacionalidad (mes) — alto impacto

| Mes | Índice | | Mes | Índice |
|-----|--------|--|-----|--------|
| Ene | 0,92 | | Jul | 0,74 |
| Feb | 0,97 | | **Ago** | **0,65** |
| Mar | 1,21 | | Sep | 0,98 |
| Abr | 1,25 | | Oct | 0,92 |
| May | 1,24 | | Nov | 1,15 |
| Jun | 0,93 | | Dic | 1,05 |

**Hallazgo crítico:** agosto (0,65) carga como un martes cualquiera. La primavera (mar-may, ~1,25)
es el pico. Dotar igual en agosto que en abril = quemar ~un 45 % de personal de más en verano.

---

## 4. Tendencia (crecimiento del negocio)

| Año | Tickets/día medio |
|-----|-------------------|
| 2023 | 10,3 |
| 2024 | 19,4 |
| 2025 | 38,1 |
| 2026 | 36,8 (normalizado) |

Casi 4× en dos años. La previsión debe **ponderar lo reciente** (media móvil ponderada), o
subestima. No usar media plana de todo el histórico.

---

## 5. Patrón horario

- **Hora punta: 21h todos los días** (cena delivery).
- Segundo pico: comida ~14h.
- Mezcla comida/cena: entre semana 52-60 % cena; fin de semana entra más comida (26-27 %).
- Úsase para decidir si reforzar mediodía o solo noche.

---

## 6. Qué es fiable y qué no (honestidad)

**Fiable YA (medido, cero humo):** índice día-semana, estacionalidad mensual, tendencia. Con esto
la previsión ya iguala la base de los líderes (Workforce.com, R365) — con datos propios.

**Aún NO fiable — clima:** con 1 operación no hay muestra para medir el efecto del clima diario
aislado. Además, la varianza la explican sobre todo **mes + día de la semana**; el clima es un
ajuste fino encima, no el motor. Se deja como **gancho apagado**. Se medirá cuando haya datos de
muchos locales (20-30) → decenas de miles de días-clima, suficiente para calibrarlo como hacen los
líderes. Regla: no encender hasta poder medirlo; empujón conservador y etiquetado cuando se active.

**Aún NO fiable — eventos (fútbol, festivos locales):** igual que el clima. Preparado, apagado.

---

## 7. Ventaja competitiva

- Los líderes predicen demanda en **€**; Folvy en **platos de cocina reales** (excluye bebida/postre).
  Para dotar cocina, platos > euros (un ticket de 3 refrescos ≠ uno de 4 hamburguesas).
- Ciclo cerrado: Folvy cruza previsión con **coste real de nóminas + escandallo** → recomienda
  reforzar/recortar con **margen real**, no estimado.

---

## 8. Coeficientes (JSON para el código)

```json
{
  "dow_index":   {"0":0.828,"1":0.654,"2":0.769,"3":0.868,"4":1.204,"5":1.224,"6":1.454},
  "month_index": {"1":0.92,"2":0.972,"3":1.205,"4":1.247,"5":1.242,"6":0.927,
                  "7":0.742,"8":0.653,"9":0.975,"10":0.915,"11":1.148,"12":1.055},
  "muestra": {"dias":1035,"tickets":28685,"desde":"2023-06","hasta":"2026-07"}
}
```

> dow: 0=Lunes … 6=Domingo. month: 1=Enero … 12=Diciembre. Ambos normalizados a media 1,0.
