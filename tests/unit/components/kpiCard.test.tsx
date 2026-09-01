import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import KpiCard from '@/components/KpiCard'

// EL CONTRATO DE PÍXEL, ESCRITO.
//
// Julio puso la condición al entregar la captura de «antes» de Disponibilidad →
// Informes: «al extraer el KpiCard local a componente común, esta pantalla tiene
// que quedar píxel a píxel igual; si algo cambia de aspecto, es un fallo del
// refactor, no una mejora».
//
// El refactor ya se comprobó con un diff del JSX contra el original, que salió
// vacío. Esto es la otra mitad, y la que dura: fija el MARCADO que sale, para
// que el día que alguien toque una clase «para mejorarlo» el test lo pare antes
// de que llegue a la pantalla de nadie.
//
// No hay jsdom en el proyecto (environment: 'node'), pero para esto no hace
// falta: renderToStaticMarkup da el HTML exacto sin DOM.

const pct = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)}%`)
const eur = (v: number | null) => (v === null ? '—' : `${Math.round(v)} €`)

describe('KpiCard · el marcado no cambia', () => {
  it('envoltorio, label y valor: las clases exactas de la pantalla de hoy', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Uptime del local" value={97.8} prevValue={96.6} betterWhen="up" format={pct} />,
    )
    expect(html).toContain('class="bg-card border border-border-default rounded-xl p-4"')
    expect(html).toContain('class="text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1.5"')
    expect(html).toContain('class="text-2xl font-semibold text-text-primary font-display"')
    expect(html).toContain('Uptime del local')
    expect(html).toContain('97.8%')
  })

  it('subir el uptime es MEJORAR: delta en verde', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Uptime del local" value={97.8} prevValue={96.6} betterWhen="up" format={pct} />,
    )
    expect(html).toContain('text-success')
    expect(html).toContain('1.2% vs periodo anterior')
  })

  // El color sale de `betterWhen`, no del signo: bajar el downtime es mejorar.
  it('bajar el downtime tambien es MEJORAR, con el mismo signo negativo', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Downtime" value={12.7} prevValue={14.5} betterWhen="down" format={v => `${v!.toFixed(1)} h`} />,
    )
    expect(html).toContain('text-success')
  })
  it('subir las perdidas es EMPEORAR: delta en rojo', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Pérdidas estimadas" value={5468} prevValue={4100} betterWhen="down" format={eur} />,
    )
    expect(html).toContain('text-danger')
    expect(html).toContain('1368 € vs periodo anterior')
  })

  // SIN ESPEJO NO HAY DELTA. No se pinta un «0%» que parecería «sin cambio»:
  // esa es la garantía que ya traía el componente y que el refactor conserva.
  it('sin valor anterior no se pinta delta ninguno', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Cierres" value={338} prevValue={null} betterWhen="down" format={v => String(v)} />,
    )
    expect(html).not.toContain('vs periodo anterior')
    expect(html).not.toContain('text-success')
    expect(html).not.toContain('text-danger')
  })
  it('un valor no finito tampoco cuenta como espejo', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Cierres" value={338} prevValue={Infinity} betterWhen="down" format={v => String(v)} />,
    )
    expect(html).not.toContain('vs periodo anterior')
  })

  it('delta exactamente 0: ni verde ni rojo, y el icono es el guion', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Cierres" value={338} prevValue={338} betterWhen="down" format={v => String(v)} />,
    )
    expect(html).toContain('text-text-secondary')
    expect(html).not.toContain('text-success')
    expect(html).not.toContain('text-danger')
    // El icono es el guión, no una flecha plana: lo dice la clase que pone
    // lucide, que es lo estable. (Su `d` es un path, no un <line>.)
    expect(html).toContain('lucide-minus')
    expect(html).not.toContain('lucide-trending')
  })

  it('la nota al pie usa su tamaño propio', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Uptime del local" value={97.8} prevValue={null} betterWhen="up" format={pct}
               note="Solo Cap. C (cierre local) — sin cerrar manualmente" />,
    )
    expect(html).toContain('class="mt-1 text-[11px] text-text-tertiary"')
    expect(html).toContain('Solo Cap. C')
  })

  it('sin nota no aparece el nodo de la nota', () => {
    const html = renderToStaticMarkup(
      <KpiCard label="Downtime" value={12.7} prevValue={null} betterWhen="down" format={v => `${v!.toFixed(1)} h`} />,
    )
    expect(html).not.toContain('text-text-tertiary')
  })
})
