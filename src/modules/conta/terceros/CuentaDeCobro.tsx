// src/modules/conta/terceros/CuentaDeCobro.tsx
//
// X25 · «Cuenta de cobro» en la ficha del cliente, como en ERP10 y como la «Cuenta de pago» del proveedor (K10):
// debajo de la forma de cobro, con el código y el nombre del plan y la misma pieza que «Cómo se cobra» de la emitida
// (X23): el plan entero, con bancos y caja primero, y «No está: crear la …» si no existe. Cualquier subcuenta, menos
// la del propio cliente (la base tampoco la deja). Es por empresa: la guarda la base en company_account_link (el papel
// «pago» del cliente), con company_account_link_set, que deja su rastro en el registro del plan. Cada emitida de este
// cliente la trae en «Cómo se cobra» («De su ficha»); en una factura se puede cambiar sin tocar esto.

import { useMemo, useState } from 'react'
import { useLeer } from '@/modules/conta/libros/contexto'
import { Buscador } from '@/modules/conta/nucleo/ficha/Buscador'
import { NombreDeCuenta } from '@/modules/conta/nucleo/ficha/piezas'
import { cuentasQueEncajan, type CuentaDelPlan } from '@/modules/conta/nucleo/ficha/teclas'
import { CrearDesdeBuscador } from '@/modules/conta/plan/CrearDesdeBuscador'
import { cuentasDePago } from '@/modules/conta/nucleo/recibida/pagoServicio'
import { useTercero } from '@/modules/conta/terceros/contextoTercero'
import { useCuentaConta } from '@/modules/conta/cuenta/contratoCuenta'
import { cambiarCuentaCobro, cuentaDeCobroDelCliente, quitarCuentaCobro } from '@/modules/conta/services/tercerosService'

export function CuentaDeCobro() {
  const { ficha, accountId, companyId } = useTercero()
  const { userName } = useCuentaConta()
  const partyId = ficha.tercero.id
  const [vuelta, setVuelta] = useState(0)
  const [texto, setTexto] = useState<string | null>(null)
  const [creadas, setCreadas] = useState<CuentaDelPlan[]>([])
  const [dicho, setDicho] = useState<{ tono: 'ok' | 'mal'; texto: string } | null>(null)
  // Lo recién guardado (o quitado, «»), mientras se vuelve a leer: la casilla no se vacía después de «Guardada».
  const [elegida, setElegida] = useState<string | null>(null)
  const plan = useLeer(companyId ? () => cuentasDePago(accountId, companyId) : null, `${accountId}:${companyId}:cuentas-cobro:${creadas.length}`).datos ?? null
  const suya = useLeer(companyId ? () => cuentaDeCobroDelCliente(accountId, companyId, partyId) : null, `${accountId}:${companyId}:${partyId}:cuenta-cobro:${vuelta}`)
  // La suya propia (su 430 de cliente) no es una cuenta de cobro: no sale en la lista.
  const propia = ficha.cuentas.find((c) => c.papel === 'cliente')?.code ?? null
  const lista = useMemo(() => [...(plan?.lista ?? []), ...creadas].filter((c) => c.codigo !== propia), [plan, creadas, propia])
  if (!companyId) return null
  const cuenta = elegida ?? suya.datos ?? ''
  const nombre = (c: string) => plan?.nombres.get(c) ?? creadas.find((x) => x.codigo === c)?.nombre ?? ''

  async function guardar(c: CuentaDelPlan, id?: string) {
    const cuentaId = id ?? plan?.idDe.get(c.codigo)
    if (!cuentaId || !companyId) { setDicho({ tono: 'mal', texto: `No se ha guardado: la ${c.codigo} no está en el plan de la empresa.` }); return }
    try {
      await cambiarCuentaCobro(companyId, partyId, cuentaId, userName ?? null)
      setDicho({ tono: 'ok', texto: `Guardada: la ${c.codigo}${c.nombre ? ` · ${c.nombre}` : ''} es su cuenta de cobro. Sus facturas la traen en «Cómo se cobra».` })
      setTexto(null); setElegida(c.codigo); setVuelta((v) => v + 1)
    } catch (e) { setDicho({ tono: 'mal', texto: `No se ha guardado: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}.` }) }
  }
  async function quitar() {
    if (!companyId) return
    try {
      await quitarCuentaCobro(companyId, partyId, userName ?? null)
      setDicho({ tono: 'ok', texto: 'Quitada: sus facturas proponen el banco de su ficha o la cuenta de su último cobro.' }); setTexto(null); setElegida(''); setVuelta((v) => v + 1)
    } catch (e) { setDicho({ tono: 'mal', texto: `No se ha quitado: ${e instanceof Error ? e.message.replace(/\.$/, '') : String(e)}.` }) }
  }

  return (
    <div className="cx-campo kf-cuenta-de-pago" data-prueba="cuenta-de-cobro">
      <label className="cx-etiqueta" htmlFor="cuenta-de-cobro">Cuenta de cobro</label>
      <div className="kf-cuenta-de-pago-fila">
        <Buscador id="cuenta-de-cobro" etiqueta="Cuenta de cobro" cargando={!plan || suya.datos === undefined} valor={texto ?? cuenta} cuenta={cuenta || null}
          placeholder="Código o nombre (F4)"
          ponerTexto={(t) => setTexto(t)} lista={(t) => cuentasQueEncajan(t, lista, 8)}
          texto={(c) => `${c.codigo} · ${c.nombre}`} elegir={(c) => void guardar(c)}
          crear={(q, cerrar) => (
            <CrearDesdeBuscador accountId={accountId} companyId={companyId} q={q} quien={userName ?? null}
              noVa={propia && q.replace(/\D/g, '') === propia ? 'no va la del propio cliente' : undefined}
              alCrear={(c) => { const n = { codigo: c.code, nombre: c.name }; setCreadas((x) => [...x, n]); void guardar(n, c.id); cerrar() }} />
          )} />
        <NombreDeCuenta etiqueta="Nombre de la cuenta de cobro" valor={cuenta ? nombre(cuenta) : ''} placeholder="Sin cuenta: la del banco o la del último cobro" />
        {cuenta && <button type="button" className="kf-enlace" onClick={() => void quitar()}>Quitar</button>}
      </div>
      <p className="cx-ayuda">En esta empresa. Puede ser un banco, una caja, la 430 de una plataforma (Glovo, Uber…) o la 551 de un socio. En una factura se cambia sin tocar esto.</p>
      {dicho && <p className="cx-ayuda" role="status" data-tono={dicho.tono} data-prueba="cuenta-de-cobro-dicho">{dicho.texto}</p>}
    </div>
  )
}
