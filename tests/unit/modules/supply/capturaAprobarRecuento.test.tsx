// La franja de cifras y el pie de «Revisa antes de aprobar», antes y después
// del arreglo del 11/09 («No me deja aprobar», INV-00218).
//
// NO reescribe el marcado: usa los MISMOS componentes que la pantalla
// (`CifraCocina`, `BotonCocina`, `PanelCocina`) y les pone encima el CSS del
// build. Si escribiera HTML propio para la foto, la foto no probaría nada
// (regla 31: la prueba se escribe contra lo real).
//
// Los datos son los de INV-00218 de Foodint Alcalá el 10/09/2026, medidos en
// `inventory_count_line`: 35 productos, 28 contados, 7 líneas que piden motivo
// según `count_lines_requiring_reason`, 21 que cuadran.

import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PanelCocina, RotuloDePanel, CifraCocina, BotonCocina,
} from '@/modules/kitchen/components/PatronDeKitchen'
import { MOTIVOS_DE_COCINA } from '@/modules/supply/services/countApprovalService'

const nfEur = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 })

function Cifras({ cuadran, revisar }: { cuadran: number; revisar: number }) {
  return (
    <div className="grid grid-cols-4 gap-px bg-cocina-linea-suave border border-cocina-linea rounded-cocina-md overflow-hidden shadow-cocina">
      <CifraCocina titulo="Cuadran" valor={String(cuadran)} tono="bueno" pie="Se aprueban de una vez" />
      <CifraCocina titulo="Para revisar" valor={String(revisar)} tono={revisar > 0 ? 'malo' : undefined}
                   pie="Diferencia de un 25 % o más y 5 € o más" />
      <CifraCocina titulo="Contradicen al recuento anterior" valor="4" pie="Sin entradas de por medio" />
      <CifraCocina titulo="Valor de lo que hay que revisar" valor={`−${nfEur.format(139)}`} sufijo="€" tono="malo"
                   pie={<>A coste medio del local</>} />
    </div>
  )
}

function Pie({ sinMotivo, aprobables }: { sinMotivo: number; aprobables: number }) {
  return (
    <div className="px-6 py-3 bg-cocina-superficie border-t border-cocina-linea
                    flex items-center justify-between gap-4 flex-wrap">
      <p className="text-[12px] text-cocina-tinta-2 leading-[1.5] min-w-0 flex-1">
        <b className="text-cocina-tinta">Motivos:</b>{' '}
        {MOTIVOS_DE_COCINA.map(m => m.label).join(' · ')}
        {sinMotivo > 0 && (
          <> — <b className="text-cocina-ambar">{sinMotivo} sin motivo</b>, y sin motivo no se aplican.</>
        )}
      </p>
      <div className="flex gap-2 shrink-0">
        <BotonCocina peso="borde">Pedir recuento de 7</BotonCocina>
        {sinMotivo > 0 ? (
          <BotonCocina peso="borde">{`Faltan ${sinMotivo} motivo${sinMotivo === 1 ? '' : 's'}`}</BotonCocina>
        ) : (
          <BotonCocina peso="relleno">{`Aprobar los ${aprobables} que cuadran`}</BotonCocina>
        )}
      </div>
    </div>
  )
}

function Bloque({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) {
  return (
    <div className="cocina-pagina">
      <div>
        <h2 className="text-[15px] font-bold text-cocina-tinta">{titulo}</h2>
        <p className="text-[12.5px] text-cocina-tinta-2 mt-1">{nota}</p>
      </div>
      {children}
    </div>
  )
}

it('genera la captura de Aprobar recuento a 1280, antes y después', () => {
  const cuerpo = renderToStaticMarkup(
    <div className="cocina min-h-full">
      <Bloque
        titulo="ANTES · 11/09, 01:00"
        nota={'La pantalla ofrecía «Aprobar los 28 que cuadran» y la base contestaba con 13 líneas '
            + 'que la pantalla ni siquiera enseña. Sin forma de arreglarlo desde aquí.'}
      >
        <Cifras cuadran={21} revisar={7} />
        <div className="rounded-cocina px-3.5 py-3 text-[13px] bg-cocina-rojo-bg text-cocina-rojo border border-cocina-rojo/35">
          apply_inventory_count: 13 línea(s) a revisar sin motivo. Asigna un motivo antes de aprobar.
        </div>
        <PanelCocina>
          <RotuloDePanel derecha="Ordenado por valor">Revisa antes de aprobar · 7</RotuloDePanel>
          <Pie sinMotivo={0} aprobables={28} />
        </PanelCocina>
      </Bloque>

      <Bloque
        titulo="DESPUÉS · faltan motivos"
        nota={'La misma regla en los dos sitios. El botón no ofrece aprobar lo que la base va a '
            + 'rechazar: dice cuántos faltan y lleva a la primera fila que lo espera.'}
      >
        <Cifras cuadran={21} revisar={7} />
        <PanelCocina>
          <RotuloDePanel derecha="Ordenado por valor">Revisa antes de aprobar · 7</RotuloDePanel>
          <Pie sinMotivo={2} aprobables={26} />
        </PanelCocina>
      </Bloque>

      <Bloque
        titulo="DESPUÉS · con los siete motivos puestos"
        nota="Lo que ve Julio en INV-00218 ahora mismo: los siete rellenados, nada pendiente."
      >
        <Cifras cuadran={21} revisar={7} />
        <PanelCocina>
          <RotuloDePanel derecha="Ordenado por valor">Revisa antes de aprobar · 7</RotuloDePanel>
          <Pie sinMotivo={0} aprobables={28} />
        </PanelCocina>
      </Bloque>
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

// La foto no puede enseñar botones que la pantalla no tiene (B84.2).
describe('la captura y la pantalla usan los mismos textos de botón', () => {
  const textos = (ruta: string) =>
    [...readFileSync(resolve(__dirname, ruta), 'utf8')
      .matchAll(/Faltan \$\{sinMotivo\} motivo|Aprobar los \$\{aprobables\} que cuadran/g)].map(m => m[0]).sort()

  it('los dos botones del pie, en los dos ficheros', () => {
    const enLaFoto = textos('./capturaAprobarRecuento.test.tsx')
    const enLaPagina = textos('../../../../src/modules/supply/components/AprobarRecuento.tsx')
    expect(enLaPagina.length).toBe(2)
    expect(enLaFoto).toEqual(enLaPagina)
  })
})
