// Agotar extras desde la tablet de cocina, a tamaño de tablet (1280×800).
//
// Los datos son los REALES de Foodint el 11/09/2026, medidos en
// `modifier_option`: «Salsa Yogur» son 13 copias en 2 marcas, 4 de ellas sin
// referencia de canal; «Salsa Harissa (Picante)» otras 13; «Salsa Tzatziki
// (Recomendada)» 11.
//
// La foto usa las MISMAS clases que la pestaña y el modal (tema oscuro de la
// Estación) con el CSS del build. Lo que enseña es lo que se despliega.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

type Extra = { name: string; opciones: number; agotadas: number; marcas: number; sinRef: number }

const AGOTADOS: Extra[] = [
  { name: 'Salsa Yogur', opciones: 13, agotadas: 9, marcas: 2, sinRef: 4 },
  { name: 'Salsa Tzatziki (Recomendada)', opciones: 11, agotadas: 7, marcas: 2, sinRef: 4 },
]

const BUSCADOS: Extra[] = [
  { name: 'Salsa Harissa (Picante)', opciones: 13, agotadas: 0, marcas: 2, sinRef: 4 },
  { name: 'Salsa Yogur', opciones: 13, agotadas: 0, marcas: 2, sinRef: 4 },
  { name: 'Salsa Tzatziki (Recomendada)', opciones: 11, agotadas: 0, marcas: 2, sinRef: 4 },
  { name: 'Salsa de Sésamo (Tarator) - Recomendada', opciones: 2, agotadas: 0, marcas: 1, sinRef: 0 },
  { name: 'Salsa coreana.', opciones: 2, agotadas: 0, marcas: 2, sinRef: 0 },
]

function TarjetaAgotado({ e }: { e: Extra }) {
  return (
    <div className="bg-zinc-900 ring-1 ring-zinc-800 rounded-xl p-3 flex flex-col gap-2">
      <div>
        <p className="font-semibold text-zinc-100">{e.name}</p>
        <p className="text-xs text-zinc-500">
          Agotado en {e.agotadas} de {e.opciones} sitios · {e.marcas} marcas
        </p>
        {e.sinRef > 0 && (
          <p className="text-xs text-amber-400 mt-0.5">
            {e.sinRef} sin referencia de canal: siguen vendiéndose fuera
          </p>
        )}
      </div>
      <div className="w-full py-2.5 rounded-lg bg-success text-white font-bold text-center">Reactivar</div>
    </div>
  )
}

it('genera la captura de Extras en la tablet a 1280×800', () => {
  const cuerpo = renderToStaticMarkup(
    <div className="bg-zinc-950 text-zinc-100" style={{ width: 1280 }}>

      {/* ── La pestaña, a pantalla completa de tablet ── */}
      <div className="flex flex-col" style={{ width: 1280, height: 800 }}>
        <div className="flex items-center gap-3 px-5 py-3 border-b border-zinc-800 shrink-0">
          <div className="flex items-center gap-2 text-zinc-300">
            <span className="text-amber-400 text-xl">⊘</span>
            <span className="text-base font-semibold">Disponibilidad</span>
            <span className="text-sm text-zinc-500">· Foodint Alcalá</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="p-2.5 rounded-lg bg-zinc-900 ring-1 ring-zinc-800 text-zinc-400">⟳</div>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-amber-500 text-zinc-950 font-bold">
              + Agotar producto
            </div>
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-zinc-900 ring-1 ring-amber-500/60 text-amber-300 font-bold">
              + Agotar extra
            </div>
          </div>
        </div>

        <div className="mx-5 mt-3 rounded-lg bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-500/40 px-3 py-2 text-sm shrink-0">
          Salsa Yogur agotado en 9 sitios de la carta. 4 copias se quedan fuera por no tener referencia de canal.
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <section>
            <div className="flex items-baseline gap-3 mb-3">
              <h3 className="text-base font-bold text-zinc-200">Productos agotados ahora</h3>
              <span className="text-sm text-zinc-500">0</span>
            </div>
            <div className="rounded-xl bg-zinc-900/60 ring-1 ring-zinc-800 px-4 py-6 text-center text-zinc-600">
              Ningún producto agotado en Foodint Alcalá.
            </div>
          </section>

          <section className="mt-6">
            <div className="flex items-baseline gap-3 mb-3">
              <h3 className="text-base font-bold text-zinc-200">Extras agotados ahora</h3>
              <span className="text-sm text-zinc-500">{AGOTADOS.length}</span>
            </div>
            <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(260px,1fr))]">
              {AGOTADOS.map(e => <TarjetaAgotado key={e.name} e={e} />)}
            </div>
          </section>
        </div>
      </div>

      {/* ── El mismo sitio, con «Agotar extra» abierto ──
           Va en su propio marco de 1280×800 y no al lado: en la tablet es una
           CAPA sobre la pestaña, y enseñarlo en una columna estrecha mostraría
           un apretujón que la pantalla no tiene. */}
      <div className="relative bg-zinc-950" style={{ width: 1280, height: 800 }}>
        <div className="absolute inset-0 bg-black/70" />
        <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="w-full max-w-2xl bg-zinc-950 rounded-2xl ring-1 ring-zinc-800 overflow-hidden flex flex-col max-h-full">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-zinc-800 shrink-0">
          <span className="text-amber-400 text-xl">⊘</span>
          <span className="text-lg font-bold text-zinc-100">Agotar extra</span>
          <span className="text-sm text-zinc-500">· Foodint Alcalá</span>
        </div>
        <div className="px-5 py-4 shrink-0">
          <div className="flex items-center gap-3 bg-zinc-900 ring-1 ring-zinc-800 rounded-xl px-4">
            <span className="text-zinc-500">⌕</span>
            <div className="flex-1 py-4 text-lg text-zinc-100">salsa</div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          <div className="grid gap-2">
            {BUSCADOS.map((e, i) => (
              <div key={e.name}
                   className={`text-left px-4 py-3 rounded-xl ring-1 ${
                     i === 1 ? 'bg-amber-500/15 ring-amber-500/60' : 'bg-zinc-900 ring-zinc-800'}`}>
                <p className="font-semibold text-zinc-100 text-lg">{e.name}</p>
                <p className="text-sm text-zinc-500">
                  {e.opciones} sitios de la carta · {e.marcas} {e.marcas === 1 ? 'marca' : 'marcas'}
                  {e.sinRef > 0 && <span className="ml-2 text-amber-400">· {e.sinRef} sin referencia de canal</span>}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-zinc-800 px-5 py-4 shrink-0 space-y-3">
          <div className="flex gap-2 flex-wrap">
            <div className="px-4 py-2.5 rounded-lg text-sm font-semibold ring-1 bg-zinc-100 text-zinc-950 ring-zinc-100">Hasta que lo reactive</div>
            <div className="px-4 py-2.5 rounded-lg text-sm font-semibold ring-1 bg-zinc-900 text-zinc-300 ring-zinc-800">2 horas</div>
            <div className="px-4 py-2.5 rounded-lg text-sm font-semibold ring-1 bg-zinc-900 text-zinc-300 ring-zinc-800">Fin del servicio (4 h)</div>
          </div>
          <p className="flex items-start gap-2 text-sm text-amber-300">
            <span className="shrink-0">⚠</span>
            4 de las 13 copias no tienen referencia de canal y seguirán vendiéndose en las plataformas. Avisa a oficina.
          </p>
          <div className="w-full py-4 rounded-xl bg-amber-500 text-zinc-950 text-lg font-bold text-center">
            Agotar Salsa Yogur en 9 sitios
          </div>
        </div>
        </div>
        </div>
      </div>
    </div>,
  )

  const dist = resolve(__dirname, '../../../../dist/assets')
  if (!existsSync(dist)) {
    expect.fail('Falta `dist/assets`: ejecuta `npm run build` antes de generar las capturas.')
  }
  const css = readdirSync(dist).filter(f => f.startsWith('index-') && f.endsWith('.css'))[0]
  const hoja = readFileSync(resolve(dist, css), 'utf8')

  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${hoja}</style>
<style>html,body{margin:0;background:#09090b;font-family:Archivo,system-ui}
.marco{width:1280px}</style></head>
<body><div class="marco">${cuerpo}</div></body></html>`

  writeFileSync(resolve(__dirname, '../../../../dist/captura_extras_tablet.html'), html)
})

describe('la captura y la pantalla dicen lo mismo', () => {
  const leer = (r: string) => readFileSync(resolve(__dirname, r), 'utf8')
  it('los textos que importan están en los dos sitios', () => {
    const tab = leer('../../../../src/modules/tablet/TabletAvailabilityTab.tsx')
    const modal = leer('../../../../src/modules/tablet/AgotarExtraModal.tsx')
    const foto = leer('./capturaExtrasTablet.test.tsx')
    for (const t of ['Agotar extra', 'Extras agotados ahora']) {
      expect(tab + modal).toContain(t)
      expect(foto).toContain(t)
    }
    expect(tab).toContain('sin referencia de canal')
    expect(modal).toContain('sin referencia de canal')
    expect(foto).toContain('sin referencia de canal')
  })
})
