// src/modules/conta/portal/pantallas/Pagos.tsx
//
// GP · Tarea 3 · Tus pagos: lo pagado en el año, lo pendiente (los devueltos
// sin pagar), el próximo cargo y el estado de cada recibo. Una sola lectura:
// conta_portal_pagos.

import { Cargando, Chip, Fallo } from '../comun'
import { euros, fecha, fechaCorta, mes, motivoParaTi } from '../formato'
import type { Pagos as DatosPagos } from '../tipos'
import { useLectura } from '../useLectura'
import type { Pantalla } from './pantalla'

export function Pagos({ cliente }: Pantalla) {
  const { datos, error, cargando, recargar } = useLectura<DatosPagos>('conta_portal_pagos', cliente)
  if (cargando && !datos) return <Cargando que="tus pagos" />
  if (error || !datos) return <Fallo texto={error ?? 'No se han podido cargar.'} otraVez={recargar} />
  const deuda = datos.devueltos.reduce((s, d) => s + d.importe_cent, 0)
  const anio = new Date().getFullYear()
  // nº 24 · 6 · Como la maqueta: «Devuelto el 7 de noviembre · sin saldo»; sin motivo aún, dónde se paga.
  const devueltoEl = (id: string) => {
    const v = datos.devueltos.find((x) => x.recibo_id === id)
    if (!v) return 'Ya pagado después del devuelto'
    const m = motivoParaTi(v.motivo)
    return `Devuelto${v.devuelto_el ? ` el ${fecha(v.devuelto_el)}` : ''} · ${m ? m.corto : 'se paga desde Inicio'}`
  }
  return (
    <>
      <h1 className="pt-h1">Tus pagos</h1>
      <section className="pt-resumen" aria-label="Resumen">
        <div><div>Pagado en {anio}</div><div>{euros(datos.pagado_anio_cent)}</div></div>
        <div style={deuda ? { background: '#FDE8E7' } : undefined}><div style={deuda ? { color: '#A11B12' } : undefined}>Pendiente</div><div style={deuda ? { color: '#A11B12' } : undefined}>{euros(deuda)}</div></div>
        <div><div>Próximo cargo</div><div>{datos.proximo?.cargo_el ? fechaCorta(datos.proximo.cargo_el) : datos.proximo ? mes(datos.proximo.mes) : '—'}</div></div>
      </section>
      <section className="pt-lista" aria-label="Recibos">
        {datos.recibos.length === 0 && <div className="pt-vacio">Aún no hay recibos.</div>}
        {datos.recibos.map((r) => (
          <div className="pt-fila" key={r.id}>
            <div className="pt-fila-texto">
              <b>{mes(r.mes)}</b>
              <span>{r.estado === 'cobrado' || r.estado === 'facturado' ? `Cobrado${r.cobrado_el ? ` el ${fecha(r.cobrado_el)}` : ''}`
                : r.estado === 'devuelto' || r.estado === 'retrocedido' ? devueltoEl(r.id)
                : r.cargo_el ? `Se carga el ${fecha(r.cargo_el)}` : 'Aún sin fecha de cargo'}</span>
            </div>
            <Chip texto={r.estado_texto} />
            <b className="pt-importe">{euros(r.importe_cent)}</b>
          </div>
        ))}
      </section>
    </>
  )
}
