// src/modules/conta/proveedor/CuentaDePago.tsx
//
// K10 · «Cuenta de pago» en la ficha del proveedor, como en ERP10 (Julio, 14/11 y
// 16/11: «la cuenta de pago en la ficha, que no es solo bancaria, p. ej. Glovo o
// Uber»). Debajo de la forma de pago, con el código y el nombre del plan, y la
// misma pieza que «Cómo se paga» de la recibida (X21b): el plan entero, y «No
// está: crear la …» si no existe. Es por empresa: la guarda la base en
// company_account_link (el papel «pago» del proveedor, el mismo que ya leían
// los saldos de terceros para su 43), con company_account_link_set, que deja su
// rastro en el registro del plan. Cada recibida de este proveedor la trae en
// «Cómo se paga» («De su ficha»); en una factura se puede cambiar sin tocar esto.

import { useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Buscador } from '@/modules/conta/nucleo/ficha/Buscador'
import { NombreDeCuenta } from '@/modules/conta/nucleo/ficha/piezas'
import { cuentasQueEncajan, type CuentaDelPlan } from '@/modules/conta/nucleo/ficha/teclas'
import { CrearDesdeBuscador } from '@/modules/conta/plan/CrearDesdeBuscador'
import { cuentaDePagoDeLaFicha, cuentasDePago } from '@/modules/conta/nucleo/recibida/pagoServicio'
import { cambiarCuentaProveedor, quitarCuentaProveedor } from '@/modules/conta/services/cuentasProveedorService'

export function CuentaDePago() {
  const { datos, actor } = useFicha()
  const f = datos.ficha
  const empresa = datos.opciones.empresa ?? null
  const [vuelta, setVuelta] = useState(0)
  const [texto, setTexto] = useState<string | null>(null)
  const [creadas, setCreadas] = useState<CuentaDelPlan[]>([])
  const [dicho, setDicho] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null)
  const plan = useLeer(empresa ? () => cuentasDePago(f.accountId, empresa.id) : null, `${f.accountId}:${empresa?.id}:cuentas-pago:${creadas.length}`).datos ?? null
  const suya = useLeer(empresa ? () => cuentaDePagoDeLaFicha(f.accountId, empresa.id, f.id) : null, `${f.accountId}:${empresa?.id}:${f.id}:cuenta-pago:${vuelta}`)
  if (!empresa) return null
  const cuenta = suya.datos ?? ''
  const nombre = (c: string) => plan?.nombres.get(c) ?? creadas.find((x) => x.codigo === c)?.nombre ?? ''

  async function guardar(c: CuentaDelPlan, id?: string) {
    const cuentaId = id ?? plan?.idDe.get(c.codigo)
    if (!cuentaId || !empresa) { setDicho({ tono: 'mal', texto: `No se ha guardado: la ${c.codigo} no está en el plan de ${empresa?.nombre ?? 'la empresa'}.` }); return }
    try {
      await cambiarCuentaProveedor(empresa.id, f.id, 'pago', cuentaId, actor.name)
      setDicho({ tono: 'ok', texto: `Guardada: la ${c.codigo}${c.nombre ? ` · ${c.nombre}` : ''} es su cuenta de pago. Sus facturas la traen en «Cómo se paga».` })
      setTexto(null); setVuelta((v) => v + 1)
    } catch (e) { setDicho({ tono: 'mal', texto: `No se ha guardado: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}.` }) }
  }
  async function quitar() {
    if (!empresa) return
    try {
      await quitarCuentaProveedor(empresa.id, f.id, 'pago', actor.name)
      setDicho({ tono: 'ok', texto: 'Quitada: sus facturas quedan pendientes de pagar hasta que se escriba la cuenta del pago en cada una.' }); setTexto(null); setVuelta((v) => v + 1)
    } catch (e) { setDicho({ tono: 'mal', texto: `No se ha quitado: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}.` }) }
  }

  return (
    <div className="cx-campo kf-cuenta-de-pago" data-prueba="cuenta-de-pago">
      <label className="cx-etiqueta" htmlFor="cuenta-de-pago">Cuenta de pago</label>
      <div className="kf-cuenta-de-pago-fila">
        <Buscador id="cuenta-de-pago" etiqueta="Cuenta de pago" cargando={!plan || suya.datos === undefined} valor={texto ?? cuenta} cuenta={cuenta || null}
          placeholder="Código o nombre (F4)"
          ponerTexto={(t) => setTexto(t)} lista={(t) => cuentasQueEncajan(t, [...(plan?.lista ?? []), ...creadas], 8)}
          texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => void guardar(c)}
          crear={(q, cerrar) => (
            <CrearDesdeBuscador accountId={f.accountId} companyId={empresa.id} q={q} quien={actor.name ?? null}
              alCrear={(c) => { const n = { codigo: c.code, nombre: c.name }; setCreadas((x) => [...x, n]); void guardar(n, c.id); cerrar() }} />
          )} />
        <NombreDeCuenta etiqueta="Nombre de la cuenta de pago" valor={cuenta ? nombre(cuenta) : ''} placeholder="Sin cuenta: se escribe en cada factura" />
        {cuenta && <button type="button" className="kf-enlace" onClick={() => void quitar()}>Quitar</button>}
      </div>
      <p className="cx-ayuda">En {empresa.nombre}. Puede ser un banco, una caja, la 551 de un socio o la 430 de una plataforma (Glovo, Uber…). En una factura se cambia sin tocar esto.</p>
      {dicho && <p className="cx-ayuda" role="status" data-tono={dicho.tono} data-prueba="cuenta-de-pago-dicho">{dicho.texto}</p>}
    </div>
  )
}
