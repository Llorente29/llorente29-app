// src/modules/conta/ventas/SociosDeMarca.tsx
//
// V01 · Entrega 3 · Las liquidaciones mensuales de los socios de marca (CTB),
// por mes y por local, también las que se esperan y aún no han llegado. Cada
// una abre su ficha (sus documentos, sus albaranes del mes, su factura, sus
// asientos y su cobro). V02 · Pantallas: sale de Ventas › Liquidaciones con
// «Más acciones ▾ › Socios de marca» (?ver=socios), igual que antes.

import { rutaLiquidacion, rutaLiquidacionNueva } from '@/config/navegacion'
import { eurosExactos } from '@/modules/conta/lib/formato'
import { Chip } from '@/modules/conta/diseno'
import { TablaLista, type ColumnaLista } from '@/modules/conta/diseno/plantillas'
import type { FilaLiquidaciones } from '@/modules/conta/compras/liquidaciones'

const plural = (n: number, uno: string, varios: string) => `${n.toLocaleString('es-ES')} ${n === 1 ? uno : varios}`

/** Las mensuales del socio de marca: las guardadas y las que se esperan del mes pasado y de este. */
export function Socios({ datos, error, recargar, movil, navegar }: {
  datos: FilaLiquidaciones[] | null; error: string | null; recargar: () => void; movil: boolean; navegar: (a: string) => void
}) {
  const filas = (datos ?? []).filter((x) => x.tipo === 'mensual')
  const abrir = (x: FilaLiquidaciones) => {
    const a = x.abrir
    if (a.a === 'liquidacion') navegar(rutaLiquidacion(a.id))
    else if (a.a === 'nueva') navegar(rutaLiquidacionNueva(a.proveedor, a.local, a.mes))
  }
  const chip = (x: FilaLiquidaciones) => <Chip tono={x.estado.tono} titulo={x.estado.detalle}>{x.estado.texto}</Chip>
  const columnas: ColumnaLista<FilaLiquidaciones>[] = [
    { id: 'socio', titulo: 'Socio', prioridad: 1, minimo: 200,
      celda: (x) => <span className="s-lista-texto-doble"><span className="s-lista-principal">{x.proveedor}</span><span className="s-tarjeta-apoyo">{x.local ?? 'sin local'}</span></span> },
    { id: 'periodo', titulo: 'Mes', prioridad: 2, minimo: 150,
      celda: (x) => <span className="s-lista-texto-doble"><span>{x.periodo}</span>{x.referencia && <span className="s-tarjeta-apoyo s-cifra">{x.referencia}</span>}</span> },
    { id: 'importe', titulo: 'Saldo', cifra: true, prioridad: 1, minimo: 120,
      celda: (x) => <span className="s-lista-texto-doble"><strong className="s-cifra">{x.importe == null ? '—' : eurosExactos(x.importe)}</strong><span className="s-tarjeta-apoyo">{x.apoyoImporte}</span></span> },
    { id: 'estado', titulo: 'Estado', prioridad: 3, minimo: 160,
      celda: (x) => <span className="s-lista-texto-doble">{chip(x)}{x.estado.detalle && <span className="s-tarjeta-apoyo">{x.estado.detalle}</span>}</span> },
  ]
  return (
    <>
      {error && <p className="s-aviso-lista" data-tono="falta" role="alert">No se han podido leer las liquidaciones: {error} <button type="button" className="s-boton s-boton-enlace" onClick={recargar}>Reintentar</button></p>}
      {!datos && !error && <div className="s-lista" aria-busy="true" aria-label="Cargando las liquidaciones"><div className="s-lista-cargando" /></div>}
      {datos && (
        <TablaLista<FilaLiquidaciones>
          etiqueta="Liquidaciones de los socios de marca" columnas={columnas} filas={filas} clave={(x) => x.id}
          nombre={(x) => `${x.proveedor}${x.local ? ` ${x.local}` : ''} ${x.periodo}`} alAbrir={abrir} movil={movil}
          tarjeta={(x) => (
            <>
              <span className="s-tarjeta-cabeza"><span className="s-lista-principal">{x.proveedor}{x.local ? ` · ${x.local}` : ''}</span><strong className="s-cifra">{x.importe == null ? '—' : eurosExactos(x.importe)}</strong></span>
              <span className="s-tarjeta-apoyo">{[x.periodo, x.referencia, x.apoyoImporte].filter(Boolean).join(' · ')}</span>
              <span className="s-tarjeta-pie">{chip(x)}</span>
            </>
          )}
          vacio={<><strong>Aún no hay liquidaciones de socios de marca.</strong> El socio que liquida cada mes se pone en su ficha de proveedor, en «Cómo te factura»; cada mes sale aquí, local por local, hasta que llegan sus documentos.</>}
          pie={<span>{plural(filas.length, 'liquidación', 'liquidaciones')}, también las del sistema anterior, que se conservan como estaban.</span>}
        />
      )}
    </>
  )
}
