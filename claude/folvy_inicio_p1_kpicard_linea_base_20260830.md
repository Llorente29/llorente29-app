# Línea base del refactor de `KpiCard` — capturada ANTES de tocar nada (30/08/2026)

Complemento al requisito de Julio: *«capturas antes/después de la página de
Disponibilidad — el refactor no puede cambiarle ni un píxel»*. Las capturas las hace
él (la de antes desde producción, la de después desde la preview del sub-lote 2).
Esto es la otra mitad: **el contrato exacto de los dos componentes antes del refactor**,
escrito antes para que el diff de después no se compare contra una base reconstruida
de memoria.

---

## 1. `KpiCard` — `src/modules/kitchen/pages/AvailabilityReportsPage.tsx:97`

Local, **no exportado**. Cuatro usos, todos en esa página (líneas 258, 262, 263, 265).

```ts
{
  label: string
  value: number | null
  prevValue: number | null
  betterWhen: 'up' | 'down'
  format: (v: number | null) => string
  note?: string
}
```

Lógica propia, que es justo la garantía (b) del encargo ya construida:

- `hasDelta` exige que **ambos** valores existan y sean finitos. Sin espejo no hay delta:
  no se pinta un «0%» que parecería «sin cambio».
- `improved` / `worsened` salen de `betterWhen`, no del signo: bajar el *downtime* es
  mejorar, y el color lo refleja.
- El icono es `Minus` cuando el delta es exactamente 0, no una flecha plana.
- Texto del delta: `` `${format(Math.abs(delta))} vs periodo anterior` ``.

**Envoltorio:** clases Tailwind — `bg-card border border-border-default rounded-xl p-4`.
Label `text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1.5`.
Valor `text-2xl font-semibold text-text-primary font-display`. Nota `text-[11px]
text-text-tertiary`.

---

## 2. `MetricCard` — `src/shell/home/widgets/MetricCard.tsx`

Exportado, con `MetricCardProps` y `MetricTone` públicos.

```ts
{
  label: string
  value: string                 // ya formateado por quien llama
  icon: LucideIcon              // OBLIGATORIO
  subtitle?: string
  subtitleTone?: 'neutral' | 'positive' | 'attention'
  accent?: boolean
}
```

**Envoltorio:** estilos en línea con variables CSS — `padding: 0.9375rem 1.0625rem`,
`border: 0.5px solid`, `borderRadius: var(--radius-xl)`. Label `0.8125rem` **con icono
en línea**. Valor `1.75rem`, `fontWeight 500`, `var(--font-display)`, `lineHeight 1.1`,
en `--color-terracota` si `accent`. Subtítulo `0.75rem`.

---

## 3. Lo que esto significa para el refactor

**No son el mismo componente con props distintas: son dos diseños distintos.**

| | `KpiCard` (kitchen) | `MetricCard` (shell) |
|---|---|---|
| estilo | clases Tailwind | estilos en línea + vars CSS |
| borde | `1px` (`border`) | `0.5px` |
| relleno | `p-4` (1rem) | `0.9375rem 1.0625rem` |
| valor | `text-2xl` | `1.75rem`, weight 500 |
| label | mayúsculas, sin icono | normal, **con icono** |
| valor de entrada | `number \| null` + `format` | `string` ya formateado |
| segunda línea | delta calculado del espejo | `subtitle` libre |

Consecuencias, por orden:

1. **Extraer `KpiCard` tal cual a compartido es seguro a nivel de píxel** para
   Disponibilidad: mismo JSX, mismas clases, mismas cuatro llamadas. Es lo que exige
   la condición de Julio y es lo que hará el sub-lote 2.
2. **Converger `MetricCard` NO es mecánico**: cambia el aspecto del Inicio (borde,
   relleno, tipografía, icono). No es un merge, es una decisión de diseño. Por eso
   Julio ya dejó la salida escrita: *«si converger MetricCard encarece este lote, se
   unifica solo el KpiCard ahora y MetricCard migra cuando sus tarjetas se cableen al
   catálogo»*. Se toma esa salida.
3. El `icon` obligatorio de `MetricCard` y el `format` de `KpiCard` son los dos puntos
   donde las firmas chocan de verdad. Cuando se converjan: `icon` pasa a opcional y
   `value: string` se admite como caso de `format` identidad — no al revés, porque
   perder `number | null` perdería el delta.

---

## 4. Qué se comprobará después

- Diff del JSX de `KpiCard` extraído contra el original: **debe ser vacío** salvo el
  `export` y los imports.
- Las cuatro llamadas de `AvailabilityReportsPage` (258, 262, 263, 265): mismos props,
  mismo orden, mismos valores.
- `MetricCard` **sin tocar** en este lote.
- Capturas de Julio, antes y después.
