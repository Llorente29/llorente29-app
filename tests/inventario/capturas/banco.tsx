// tests/inventario/capturas/banco.tsx
//
// BANCO DE CAPTURAS del autoconteo. Pinta las piezas DE VERDAD
// (ResumenAutoconteo, AvisoAutoconteosSinAplicar, ConteoMovilTerminado) con los
// estilos de la app, para la foto del informe: una foto con un HTML escrito
// para ella enseñaría una pantalla que no existe (ConteoMovilPiezas, 10/09).
// Lo sirve `npx vite` y lo fotografía tests/inventario/capturas/sacar.mjs.
//
// Las cifras son de líneas reales de autoconteos de Foodint
// (tests/inventario/diferencias-reales.json); los nombres, inventados: el
// repositorio es público.
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/index.css'
import '@/modules/kitchen/estilo/cocinaTokens.css'
import ResumenAutoconteo, { type LineaDelResumen } from '@/modules/supply/components/ResumenAutoconteo'
import AvisoAutoconteosSinAplicar from '@/modules/supply/components/AvisoAutoconteosSinAplicar'
import ConteoMovilTerminado from '@/modules/supply/components/ConteoMovilTerminado'

const l = (id: string, itemName: string, unitAbbr: string, s: number, c: number, vq: number, vv: number | null, ex = false): LineaDelResumen => ({
  id, itemName, unitAbbr, systemQty: s, countedQty: c, varianceQty: vq, varianceValue: vv,
  excludedAt: ex ? '2026-10-21T15:10:00Z' : null, excludedReason: ex ? 'se contó en el almacén de al lado' : null,
})
const lineas: LineaDelResumen[] = [
  l('1', 'Pan de hamburguesa', 'ud', 183, 132, -51, -63.85),
  l('2', 'Refresco de cola lata', 'ud', 68, 42, -26, -63.13),
  l('3', 'Patatas bastón', 'g', 3230, 2699, -531, -3.34),
  l('4', 'Queso cheddar loncheado', 'g', 22665.5195681511, 25000, 2334.48043184885, 6.11),
  l('5', 'Salsa barbacoa', 'ud', 7, 38, 31, 23.77),
  l('6', 'Bolsas de papel', 'ud', -31, 0, 31, 0),
  l('7', 'Servilletas', 'ud', 15, 15, 0, 0),
  l('8', 'Agua mineral 50 cl', 'ud', 900, 900, 0, 0),
  l('9', 'Cebolla morada', 'g', 0, 0, 0, 0),
  l('10', 'Carne picada mixta', 'g', 0, 18000, 18000, 111.63, true),
]

function Escena({ escena }: { escena: string }) {
  if (escena.startsWith('tablet-')) {
    const estado = escena === 'tablet-aplicado' ? { tipo: 'aplicado' as const, a: '2026-10-21T15:42:00Z' }
      : escena === 'tablet-faltan' ? { tipo: 'faltan' as const, faltan: 3 }
      : { tipo: 'error' as const, mensaje: 'No se pudo cerrar el conteo del día: la conexión se ha cortado.' }
    return <ConteoMovilTerminado title="Autoinventario de hoy" total={8} estado={estado} onBack={() => undefined} />
  }
  if (escena === 'aviso') {
    return (
      <div className="bg-page min-h-screen p-4 sm:p-6">
        <div className="space-y-4 max-w-5xl">
          <h1 className="text-xl font-display font-medium text-text-primary">Almacén</h1>
          <AvisoAutoconteosSinAplicar onOpen={() => undefined} items={[
            { countId: 'a', code: 'INV-00341', locationName: 'Foodint Carabanchel', createdAt: '2026-10-20T04:00:00Z', countedLines: 6,
              error: 'canceling statement due to lock timeout', failedAt: '2026-10-21T03:10:02Z' },
            { countId: 'b', code: 'INV-00338', locationName: 'Foodint Alcalá', createdAt: '2026-10-19T04:00:00Z', countedLines: 2, error: null, failedAt: null },
          ]} />
        </div>
      </div>
    )
  }
  // La pantalla de un recuento aplicado solo, como la pinta AprobarRecuento.
  return (
    <div className="cocina cocina-pagina">
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold tracking-[.08em] uppercase text-cocina-tinta-3">‹ Almacén · Inventarios · Foodint Carabanchel</span>
        <h1 className="text-[24px] font-bold tracking-[-.015em] leading-[1.2] text-cocina-tinta">Recuento del miércoles 21 de octubre</h1>
        <p className="text-[12.5px] text-cocina-tinta-2">INV-00342 · contado por Natacha y Pamela · {lineas.length} productos</p>
      </div>
      <ResumenAutoconteo
        via={escena === 'conteo-tablet' ? 'al_terminar' : 'cron'}
        approvedAt={escena === 'conteo-tablet' ? '2026-10-21T15:42:00Z' : '2026-10-22T03:10:04Z'}
        createdAt="2026-10-21T04:00:00Z"
        approvedByName={escena === 'conteo-tablet' ? 'Pamela' : 'Folvy (autocierre)'}
        lineas={lineas}
        hechos={{ ajustes: 6, valorNeto: -101.07, sinCoste: 0 }}
      />
    </div>
  )
}

const escena = new URLSearchParams(location.search).get('escena') ?? 'conteo-noche'
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Escena escena={escena} /></React.StrictMode>)
