// Las capturas del móvil de quien cuenta, para ponerlas AL LADO de la maqueta
// (§4.8 del encargo del 10/09: pantallas 1, 2 y 3 a 390 px, en vertical).
//
// MISMO MÉTODO QUE LA CAPTURA DEL RESUMEN: las piezas REALES de la pantalla con
// el CSS del build, nunca un HTML escrito para la foto. Por eso las piezas
// salieron de `MiAutoinventario.tsx` a `ConteoMovilPiezas.tsx`: una foto que
// inventa su propio marcado enseña una pantalla que no existe.
//
// DATOS REALES, de la BBDD el 10/09/2026:
//   Patatas Bastón (Foodint Alcalá) · Bolsa 2.500 g · Caja 10.000 g (4 bolsas)
//     · Caja 12,5 kg. Ids reales.
//   Peperoni Loncheado · Paquete 1.000 g, que es el único que no choca.
//
// La pantalla 3 usa el caso del peperoni tal cual pasó: Natacha marcó «no queda
// nada» el 04/09 a las 20:39 donde Pamela había contado 9 kg la noche anterior.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  Marco, Cabecera, Tarjeta, Pie, BotonPrincipal, BotonSecundario,
  FilaFormato, FilaAbierto, HojaVuelveAMirarlo,
} from '@/modules/supply/components/ConteoMovilPiezas'
import { desglose, type Abierto } from '@/modules/supply/lib/conteoMovilTexto'
import { fmtQty, type CountFormat } from '@/modules/supply/services/countFormatService'

const CUENTA = '51ad1792-6629-4ef7-833a-b57b09a86710'

function fmt(
  id: string, name: string, qtyInBase: number, extra: Partial<CountFormat> = {},
): CountFormat {
  return {
    id, accountId: CUENTA, itemId: 'x', name, qtyInBase,
    parentFormatId: null, qtyPerParent: null, parentName: null,
    isPiece: false, isWeighted: false, source: 'manual', aiConfidence: null,
    needsReview: false, isActive: true, archivedAt: null,
    createdAt: '', updatedAt: '', createdBy: null, createdByName: null,
    useInCount: true, ...extra,
  }
}

// Los formatos de Patatas Bastón que salen en el móvil, de mayor a menor —el
// orden que devuelve `listCountFormats`.
const PATATAS: CountFormat[] = [
  fmt('69d98209-43b1-4b55-ad8c-236b17c3d24e', 'Caja', 10000, { qtyPerParent: 4, parentName: 'Bolsa' }),
  fmt('ccc5e019-b47a-4f3e-8f09-229d7bf34e70', 'Bolsa cerrada', 2500),
]
const PEPERONI: CountFormat[] = [
  fmt('4ac61d1c-4536-4197-9f54-60a212324783', 'Paquete cerrado', 1000),
]

/** El cuerpo de la pantalla, tal cual lo compone `MiAutoinventario`. */
function Pantalla({
  local, producto, instruccion, formats, cuenta, abierto, paso, de, pct, hoja,
}: {
  local: string
  producto: string
  instruccion: string
  formats: CountFormat[]
  cuenta: Record<string, number>
  abierto: Abierto
  paso: number
  de: number
  pct: number
  hoja?: boolean
}) {
  const baseUnit = 'g'
  const refAbierto = formats.length > 0 ? formats[formats.length - 1] : null
  let total = 0
  for (const f of formats) total += (cuenta[f.id] ?? 0) * f.qtyInBase
  if (abierto.modo === 'peso') total += Number(abierto.gramos || 0)
  else if (abierto.fraccion != null && refAbierto) total += abierto.fraccion * refAbierto.qtyInBase
  const aOjo = abierto.modo === 'ojo' && abierto.fraccion != null
  const hayAlgo = total > 0

  return (
    <Marco>
      <Cabecera title="Autoinventario de hoy" onBack={() => {}} paso={paso} de={de} pct={pct} />
      <div className={`flex-1 overflow-y-auto ${hoja ? 'opacity-40 pointer-events-none' : ''}`}>
        <div className="px-4 pt-4 pb-3 flex flex-col gap-1">
          <span className="text-[11px] font-bold tracking-[.08em] uppercase text-cocina-tinta-3">{local}</span>
          <span className="text-[26px] font-extrabold tracking-[-.02em] leading-[1.15] text-cocina-tinta">{producto}</span>
          <span className="text-[14px] text-cocina-tinta-2 leading-[1.4]">{instruccion}</span>
        </div>
        <Tarjeta>
          {formats.map((f, i) => (
            <FilaFormato key={f.id} formato={f} baseUnit={baseUnit}
              valor={cuenta[f.id] ?? 0} rayada={i % 2 === 1} onChange={() => {}} />
          ))}
          <FilaAbierto abierto={abierto} setAbierto={() => {}} formatoRef={refAbierto}
            baseUnit={baseUnit} soloBase={formats.length === 0} />
        </Tarjeta>
        {hayAlgo && (
          <div className="mx-4 mt-3 rounded-cocina-md bg-cocina-acento-bg px-4 py-3.5 flex justify-between items-baseline gap-3">
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[12px] font-bold tracking-[.06em] uppercase text-cocina-acento-ink">Total contado</span>
              <span className="text-[13px] text-cocina-acento-ink leading-snug">
                {desglose(formats, cuenta, abierto, refAbierto, baseUnit)}
              </span>
            </div>
            <span className="num text-[26px] font-bold tracking-[-.02em] text-cocina-acento-ink whitespace-nowrap">
              {aOjo ? '≈ ' : ''}{fmtQty(total, baseUnit)}
            </span>
          </div>
        )}
      </div>
      {!hoja && (
        <Pie>
          <BotonPrincipal>Guardar y seguir</BotonPrincipal>
          <BotonSecundario>No queda nada de este producto</BotonSecundario>
        </Pie>
      )}
      {hoja && (
        <HojaVuelveAMirarlo
          producto={producto} formats={formats} baseUnit={baseUnit}
          cuenta={{}} setCuenta={() => {}}
          abierto={{ modo: 'peso', gramos: '' }} setAbierto={() => {}}
          formatoRef={refAbierto} hayAlgo={false} saving={false} error=""
          onGuardar={() => {}} onLoMismo={() => {}}
        />
      )}
    </Marco>
  )
}

const PANTALLAS = [
  {
    fichero: '1_contar_por_formatos',
    titulo: 'Pantalla 1 · Contar por formatos',
    nodo: (
      <Pantalla
        local="Foodint Alcalá" producto="Patatas Bastón"
        instruccion="Cuenta lo cerrado por formato. Lo abierto, a la báscula."
        formats={PATATAS}
        cuenta={{ 'ccc5e019-b47a-4f3e-8f09-229d7bf34e70': 2 }}
        abierto={{ modo: 'peso', gramos: '750' }}
        paso={4} de={12} pct={33}
      />
    ),
  },
  {
    fichero: '2_sin_bascula_a_ojo',
    titulo: 'Pantalla 2 · Sin báscula: a ojo',
    nodo: (
      <Pantalla
        local="Foodint Alcalá" producto="Patatas Bastón"
        instruccion="Sin báscula a mano: di cuánto queda en lo que está abierto."
        formats={PATATAS}
        cuenta={{ 'ccc5e019-b47a-4f3e-8f09-229d7bf34e70': 2 }}
        abierto={{ modo: 'ojo', formatId: 'ccc5e019-b47a-4f3e-8f09-229d7bf34e70', fraccion: 0.5, otros: '' }}
        paso={4} de={12} pct={33}
      />
    ),
  },
  {
    fichero: '3_no_cuadra',
    titulo: 'Pantalla 3 · Vuelve a mirarlo',
    nodo: (
      <Pantalla
        local="Foodint Alcalá" producto="Peperoni Loncheado"
        instruccion="Has marcado: no queda nada."
        formats={PEPERONI} cuenta={{}} abierto={{ modo: 'peso', gramos: '' }}
        paso={7} de={12} pct={58} hoja
      />
    ),
  },
]

describe('capturas del móvil a 390 px', () => {
  it('escribe el HTML de las tres pantallas con el CSS del build', () => {
    const raiz = resolve(__dirname, '../../../..')
    const dist = resolve(raiz, 'dist/assets')
    if (!existsSync(dist)) {
      // Sin `npm run build` no hay CSS compilado. No se inventa uno: la captura
      // sin el CSS de verdad enseñaría una pantalla que no es la que se
      // despliega, que es justo lo que estas capturas existen para descartar.
      expect.fail('Falta `dist/assets`: ejecuta `npm run build` antes de generar las capturas.')
    }
    const css = readFileSync(
      resolve(dist, readdirSync(dist).filter(f => f.startsWith('index-') && f.endsWith('.css'))[0]),
      'utf8',
    )

    const salida = resolve(raiz, 'dist/capturas-conteo')
    mkdirSync(salida, { recursive: true })

    for (const p of PANTALLAS) {
      const cuerpo = renderToStaticMarkup(p.nodo)
      // 390 px de ancho y 844 de alto: el mismo lienzo que la maqueta.
      const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style>
<style>html,body{margin:0;background:#EAEEF1}
.movil{width:390px;height:844px;overflow:hidden;position:relative}
.movil>div{height:844px}</style></head>
<body><div class="movil">${cuerpo}</div></body></html>`
      writeFileSync(resolve(salida, `${p.fichero}.html`), html)

      // Se mide el MARCADO, no el fichero: el CSS del build lleva compiladas
      // TODAS las clases de la app, así que buscarlas en `html` da positivo
      // siempre. Es el error de medir sobre el sitio equivocado.
      expect(cuerpo).not.toMatch(/text-text-primary|border-border-default|bg-card|bg-page/)
      expect(cuerpo).toContain('cocina')
    }

    // Y lo que NO puede salir en ninguna de las tres: la cantidad esperada.
    // 8875 y 9000 son el teórico y el recuento anterior del peperoni. Si
    // aparecieran, el freno a ciegas habría dejado de ser ciego.
    const tres = PANTALLAS.map(p => renderToStaticMarkup(p.nodo)).join('')
    expect(tres).not.toMatch(/8\.?875|8,875/)
    expect(tres).not.toMatch(/9\.000\s*g|8,9\s*kg/)
  })
})
