// Aprobar recuento, antes y después del 11/09. Dos arreglos en la misma foto:
//
//   · 01:00 — la pantalla ofrecía «Aprobar los 28 que cuadran» y la base
//     contestaba «13 línea(s) a revisar sin motivo» (una sola regla, p18).
//   · 08:15 — al aprobar, Folvy devolvía a la tabla vieja, la de «El sistema
//     cree: No atribuible · Es esto · Otra…». Julio: «¿Me manda a la pantalla
//     que se supone que cambiamos?».
//
// NO reescribe el marcado de la pantalla nueva: usa sus MISMOS componentes
// (`CifraCocina`, `BotonCocina`, `PanelCocina`, `PastillaCocina`) con el CSS
// del build. El bloque de ANTES sí copia el marcado de la hoja vieja, con sus
// clases de verdad (`bg-accent-bg`, `text-text-primary`…), porque el objetivo
// es justo enseñar las dos pantallas al lado.
//
// Los datos son los de INV-00218 de Foodint Alcalá, aprobado por Julio el
// 11/09 a las 08:02 de Madrid: 35 productos, 28 contados, 12 con motivo,
// 25 ajustes, −148,41 € a coste medio, 2 movimientos sin coste.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PanelCocina, RotuloDePanel, CifraCocina, PastillaCocina, BotonCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { MOTIVOS_DE_COCINA } from '@/modules/supply/services/countApprovalService'

const nfEur = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })
const nfPct = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 })
const nb = ' '

type Fila = {
  nombre: string; quien: string; hora: string; como: string
  esperaba: string; contado: string; pct: number | null; eur: number | null
  motivo: string; pastilla?: string
}

// Las doce que llevan motivo, tal y como están en `inventory_count_line`.
const REVISADAS: Fila[] = [
  { nombre: 'Coca-Cola Original Lata', quien: 'Pamela Guzman Velásquez', hora: '20:00',
    como: '4 unidades', esperaba: `240${nb}ud`, contado: `4${nb}ud`, pct: -98.3, eur: -139.46,
    motivo: 'robo_desconocido', pastilla: 'No cuadró dos veces' },
  { nombre: 'Solomillo de Pollo Prefrito Piri-piri', quien: 'Johanny Garzón Rodríguez', hora: '12:38',
    como: '25 bolsas de 1 kg', esperaba: `35${nb}kg`, contado: `25${nb}kg`, pct: -28.6, eur: -69.38,
    motivo: 'error_conteo' },
  { nombre: 'Carne de Birria', quien: 'Pamela Guzman Velásquez', hora: '20:30',
    como: '6,921 kg pesados', esperaba: `4,96${nb}kg`, contado: `6,921${nb}kg`, pct: 39.5, eur: 37.55,
    motivo: 'error_conteo' },
  { nombre: 'Caldo de Birria', quien: 'Natacha del Valle Rondón', hora: '17:29',
    como: '13,9 kg pesados', esperaba: `9,067${nb}kg`, contado: `13,9${nb}kg`, pct: 53.3, eur: 26.16,
    motivo: 'error_recepcion' },
  { nombre: 'Milanesa de Pollo Rebozado', quien: 'Johanny Garzón Rodríguez', hora: '12:42',
    como: '4 unidades', esperaba: `7${nb}ud`, contado: `4${nb}ud`, pct: -42.9, eur: -5.55,
    motivo: 'uso_sin_apuntar' },
  { nombre: 'Humus', quien: 'Johanny Garzón Rodríguez', hora: '12:35',
    como: '1 bote de 1 kg', esperaba: `−355${nb}g`, contado: `1${nb}kg`, pct: -381.7, eur: 0,
    motivo: 'error_recepcion', pastilla: 'Folvy no tenía referencia' },
  { nombre: 'Mantequilla con ajo', quien: 'Pamela Guzman Velásquez', hora: '19:52',
    como: 'No queda nada', esperaba: `−10${nb}g`, contado: `0${nb}g`, pct: -100, eur: 0,
    motivo: 'error_conteo', pastilla: 'Folvy no tenía referencia' },
  { nombre: 'Relish Pepinillo y Cebolla 900 ml', quien: 'Pamela Guzman Velásquez', hora: '19:52',
    como: '1 bote de 900 ml', esperaba: `−100${nb}g`, contado: `900${nb}g`, pct: -1000, eur: 0,
    motivo: 'error_conteo', pastilla: 'Folvy no tenía referencia' },
  { nombre: 'SALSA Yogur', quien: 'Johanny Garzón Rodríguez', hora: '12:34',
    como: 'No queda nada', esperaba: `0${nb}g`, contado: `0${nb}g`, pct: null, eur: 0,
    motivo: 'error_recepcion' },
  { nombre: 'Lima', quien: 'Johanny Garzón Rodríguez', hora: '12:35',
    como: 'No queda nada', esperaba: `−360,7${nb}g`, contado: `0${nb}g`, pct: -100, eur: 0,
    motivo: 'error_conteo' },
  { nombre: 'Colorador amarillo alimenticio', quien: 'Natacha del Valle Rondón', hora: '17:01',
    como: 'No queda nada', esperaba: `−0,8${nb}g`, contado: `0${nb}g`, pct: -100, eur: 0,
    motivo: 'merma' },
  { nombre: 'Albahaca', quien: 'Natacha del Valle Rondón', hora: '17:01',
    como: 'No queda nada', esperaba: `−11,8${nb}g`, contado: `0${nb}g`, pct: -100, eur: 0,
    motivo: 'robo_desconocido' },
]

function etiquetaMotivo(v: string): string {
  return MOTIVOS_DE_COCINA.find(m => m.value === v)?.label ?? v
}

function FilaLeida({ f }: { f: Fila }) {
  const falta = (f.pct ?? 0) < 0
  return (
    <tr className="border-b border-cocina-linea-suave">
      <td className="px-4 py-3 align-top">
        <div className="text-[14px] font-bold text-cocina-tinta leading-tight">{f.nombre}</div>
        <div className="text-[12px] text-cocina-tinta-3 mt-0.5">{f.quien} · {f.hora}</div>
      </td>
      <td className="px-3 py-3 align-top text-[12.5px] text-cocina-tinta-2 max-w-[220px]">
        <div>{f.como}</div>
        {f.pastilla && (
          <div className="flex gap-1.5 mt-1 flex-wrap">
            <PastillaCocina tono={f.pastilla === 'No cuadró dos veces' ? 'rojo' : 'ambar'}>{f.pastilla}</PastillaCocina>
          </div>
        )}
      </td>
      <td className="px-3 py-3 align-top num text-[13px] text-right text-cocina-tinta-2 whitespace-nowrap">{f.esperaba}</td>
      <td className="px-3 py-3 align-top num text-[15px] text-right font-bold text-cocina-tinta whitespace-nowrap">{f.contado}</td>
      <td className={`px-3 py-3 align-top num text-[13px] text-right whitespace-nowrap ${falta ? 'text-cocina-rojo' : 'text-cocina-verde'}`}>
        {f.pct == null ? '—' : `${f.pct > 0 ? '+' : '−'}${nfPct.format(Math.abs(f.pct))} %`}
      </td>
      <td className="px-3 py-3 align-top num text-[13px] text-right text-cocina-tinta-2 whitespace-nowrap">
        {f.eur === 0 ? <span className="text-[11px] text-cocina-tinta-3">sin coste</span> : nfEur.format(Math.abs(Math.round(f.eur ?? 0)))}
      </td>
      <td className="px-3 py-3 align-top">
        <div className="min-w-[150px]">
          <div className="text-[12.5px] font-semibold text-cocina-tinta">{etiquetaMotivo(f.motivo)}</div>
        </div>
      </td>
      <td className="px-4 py-3 align-top" />
    </tr>
  )
}

function Cabecera({ children }: { children?: React.ReactNode }) {
  return (
    <thead>
      <tr className="bg-cocina-superficie-2 text-[11px] font-bold tracking-[.06em] uppercase text-cocina-tinta-3">
        <th className="text-left px-4 py-2 font-bold">Producto · quién contó</th>
        <th className="text-left px-3 py-2 font-bold">Cómo se contó</th>
        <th className="text-right px-3 py-2 font-bold">Esperaba</th>
        <th className="text-right px-3 py-2 font-bold">Contado</th>
        <th className="text-right px-3 py-2 font-bold">Dif.</th>
        <th className="text-right px-3 py-2 font-bold">€</th>
        <th className="text-left px-3 py-2 font-bold">Motivo</th>
        <th className="px-4 py-2">{children}</th>
      </tr>
    </thead>
  )
}

it('genera la captura de Aprobar recuento a 1280, antes y después', () => {
  const cuerpo = renderToStaticMarkup(
    <div className="cocina min-h-full">

      {/* ── ANTES ─────────────────────────────────────────────────────── */}
      <div className="cocina-pagina">
        <div>
          <h2 className="text-[15px] font-bold text-cocina-tinta">ANTES · lo que salía al aprobar</h2>
          <p className="text-[12.5px] text-cocina-tinta-2 mt-1">
            La hoja vieja, con la atribución automática dentro del paso de aprobar.
            Detrás de «Es esto» estaban los 212 «otro» del RECON del 10/09.
          </p>
        </div>
        <div className="rounded-lg border border-border-default overflow-hidden bg-card">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-page text-[11px] uppercase text-text-tertiary">
                <th className="text-left px-3 py-2 font-medium">Artículo</th>
                <th className="text-right px-3 py-2 font-medium">Sistema</th>
                <th className="text-right px-3 py-2 font-medium">Contado</th>
                <th className="text-right px-3 py-2 font-medium">Dif.</th>
                <th className="text-left px-3 py-2 font-medium">Causa</th>
              </tr>
            </thead>
            <tbody>
              {[['Coca-Cola Original Lata', '240', '4', '−98,3%'],
                ['Solomillo de Pollo Prefrito', '35.000', '25.000', '−28,6%']].map(([n, s1, c, d]) => (
                <tr key={n} className="border-t border-border-default">
                  <td className="px-3 py-2 text-sm text-text-primary">{n}</td>
                  <td className="px-3 py-2 text-sm text-right tabular-nums text-text-secondary">{s1}</td>
                  <td className="px-3 py-2 text-sm text-right tabular-nums text-text-primary">{c}</td>
                  <td className="px-3 py-2 text-sm text-right tabular-nums text-warning">{d}</td>
                  <td className="px-3 py-2 min-w-[240px]">
                    <div className="rounded-md border border-accent/20 bg-accent-bg/40 px-2.5 py-1.5 space-y-1">
                      <div className="text-[12px] text-text-primary">El sistema cree: <b>No atribuible</b></div>
                      <p className="text-[11px] text-text-secondary leading-snug">
                        La cobertura del consumo no llega para proponer una causa.
                      </p>
                      <div className="flex items-center gap-2 pt-0.5">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] rounded bg-accent text-text-on-accent font-medium">Es esto</span>
                        <span className="px-1.5 py-0.5 text-[11px] border border-border-default rounded bg-card text-text-secondary">Otra…</span>
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── DESPUÉS ───────────────────────────────────────────────────── */}
      <div className="cocina-pagina">
        <div>
          <h2 className="text-[15px] font-bold text-cocina-tinta">DESPUÉS · la misma pantalla, en solo lectura</h2>
          <p className="text-[12.5px] text-cocina-tinta-2 mt-1">
            INV-00218 tal y como queda tras aprobarlo. Sin botones de aprobar, recontar ni desplegables.
          </p>
        </div>

        <div className="flex justify-between items-end gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[24px] font-bold tracking-[-.015em] leading-[1.2] text-cocina-tinta">
              Recuento del jueves 10
            </h1>
            <p className="text-[12.5px] text-cocina-tinta-2 mt-1.5">
              INV-00218 · contado por Johanny Garzón Rodríguez, Natacha del Valle Rondón y Pamela Guzman Velásquez · 35 productos
            </p>
            <p className="text-[13px] text-cocina-verde font-semibold mt-1.5">
              ✓ Aprobado por Julio el jueves 11 a las 08:02 · 25 productos ajustados · −148{nb}€ a coste medio (2 sin coste, fuera de esa suma)
            </p>
          </div>
          <BotonCocina peso="borde">Ver los 16 que cuadran</BotonCocina>
        </div>

        <div className="grid grid-cols-4 gap-px bg-cocina-linea-suave border border-cocina-linea rounded-cocina-md overflow-hidden shadow-cocina">
          <CifraCocina titulo="Cuadran" valor="16" tono="bueno" pie="Se aplicaron sin motivo" />
          <CifraCocina titulo="Revisadas" valor="12" pie="Llevan motivo puesto a mano" />
          <CifraCocina titulo="Sin contar" valor="7" pie="No entraron en el ajuste" />
          <CifraCocina titulo="Valor ajustado" valor="−148" sufijo="€" tono="malo"
                       pie={<>A coste medio · <b>2</b> sin coste, fuera de esta suma</>} />
        </div>

        <PanelCocina>
          <RotuloDePanel derecha="Ordenado por valor">Lo que se revisó · 12</RotuloDePanel>
          <table className="w-full border-collapse">
            <Cabecera />
            <tbody>{REVISADAS.map(f => <FilaLeida key={f.nombre} f={f} />)}</tbody>
          </table>
        </PanelCocina>
      </div>
    </div>,
  )

  const dist = resolve(__dirname, '../../../../dist/assets')
  if (!existsSync(dist)) {
    // Sin el CSS del build la foto enseñaría una pantalla que no es la que se
    // despliega, que es justo lo que estas capturas existen para descartar.
    expect.fail('Falta `dist/assets`: ejecuta `npm run build` antes de generar las capturas.')
  }
  const css = readdirSync(dist).filter(f => f.startsWith('index-') && f.endsWith('.css'))[0]
  const hoja = readFileSync(resolve(dist, css), 'utf8')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${hoja}</style>
<style>html,body{margin:0;background:#EAEEF1}
.marco{width:1280px;background:#EAEEF1;padding:18px 0}</style></head>
<body><div class="marco">${cuerpo}</div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_aprobar_recuento.html'), html)
})

// La foto no puede enseñar lo que la pantalla no tiene (B84.2).
describe('la captura y la pantalla dicen lo mismo', () => {
  const pagina = () => readFileSync(
    resolve(__dirname, '../../../../src/modules/supply/components/AprobarRecuento.tsx'), 'utf8')
  const foto = () => readFileSync(resolve(__dirname, './capturaAprobarRecuento.test.tsx'), 'utf8')

  it('los cuatro títulos de las cifras en solo lectura', () => {
    for (const t of ['Cuadran', 'Revisadas', 'Sin contar', 'Valor ajustado']) {
      expect(pagina()).toContain(`titulo="${t}"`)
      expect(foto()).toContain(`titulo="${t}"`)
    }
  })

  it('el rótulo del panel aprobado', () => {
    expect(pagina()).toContain("'Lo que se revisó'")
    expect(foto()).toContain('Lo que se revisó · 12')
  })
})
