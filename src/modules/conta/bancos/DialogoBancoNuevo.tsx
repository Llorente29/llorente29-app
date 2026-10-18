// src/modules/conta/bancos/DialogoBancoNuevo.tsx
//
// S01d · «+ Nuevo banco o tarjeta»: el diálogo que da de alta un banco que aún
// no está en el plan (bank_cuenta_nueva). Se abre desde Cuentas y extractos
// (siempre visible, y solo con llegar con ?nuevo=banco) y desde «Subir
// extracto», con el IBAN del fichero ya puesto. Con el mismo aspecto que
// «Dar de alta» desde una cuenta del plan: nombre, IBAN y de qué local es.
// Si la base dice que no, el porqué sale aquí dentro, no detrás del velo.

import { useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { altaBancoNuevo, type BancoNuevoHecho } from '@/modules/conta/services/bancosPantallas'
import { useBancos } from '@/modules/conta/bancos/contexto'
import { useAnalitica } from '@/modules/conta/marco/nuevo/contexto'
import { comprobarBancoNuevo, mensajeDeAlta, textoBancoNuevo, type TipoBancoNuevo } from '@/modules/conta/bancos/bancoNuevo'

const COMUN = 'comun'

export function DialogoBancoNuevo({ ibanInicial = '', alCerrar, alCrear }: {
  ibanInicial?: string
  alCerrar: () => void
  /** Ya está dado de alta: el banco nuevo y la frase que lo dice. */
  alCrear: (hecho: BancoNuevoHecho, texto: string) => void
}) {
  const { companyId, quien, datos } = useBancos()
  const { local: ejeLocal } = useAnalitica()
  const [tipo, setTipo] = useState<TipoBancoNuevo>('bank')
  const [nombre, setNombre] = useState('')
  const [iban, setIban] = useState(ibanInicial)
  const [local, setLocal] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const falta = !nombre.trim() || (tipo === 'bank' && !iban.trim()) || (!!ejeLocal && !local)

  const guardar = async () => {
    const c = comprobarBancoNuevo({ tipo, nombre, iban })
    if (!c.ok) { setError(c.motivo); return }
    const comun = !ejeLocal || local === COMUN
    const localId = comun ? null : local
    setError(null); setGuardando(true)
    try {
      const hecho = await altaBancoNuevo(companyId, { tipo, nombre: c.nombre, iban: c.iban, localId, comun }, quien)
      const texto = textoBancoNuevo({ tipo, nombre: c.nombre, porque: hecho.porque, local: ejeLocal && localId ? datos.locales.find((l) => l.id === localId)?.nombre ?? null : null, comun: !!ejeLocal && comun })
      alCrear(hecho, texto)
    } catch (e) {
      setError(mensajeDeAlta(e))
      setGuardando(false)
    }
  }

  return (
    <Dialogo titulo="Nuevo banco o tarjeta" alCerrar={alCerrar}>
      <form className="cx-formulario" onSubmit={(e) => { e.preventDefault(); void guardar() }}>
        <p className="cx-ayuda">Le creo su subcuenta 572 en el plan y la enlazo al banco, para poder casar sus movimientos.</p>
        <div className="cxl-segmento" role="group" aria-label="Qué das de alta">
          <button type="button" aria-pressed={tipo === 'bank'} onClick={() => setTipo('bank')}>Banco</button>
          <button type="button" aria-pressed={tipo === 'card'} onClick={() => setTipo('card')}>Tarjeta</button>
        </div>
        <label className="cx-campo"><span>Cómo lo llamas</span>
          <input className="cx-input" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder={tipo === 'bank' ? 'Banco Santander' : 'Tarjeta de empresa'} />
        </label>
        <label className="cx-campo"><span>{tipo === 'bank' ? 'IBAN' : 'IBAN (si tiene)'}</span>
          <input className="cx-input cx-cifra" value={iban} onChange={(e) => setIban(e.target.value)} placeholder="ES00 0000 0000 0000 0000 0000" />
        </label>
        {ejeLocal && (
          <label className="cx-campo"><span>¿De qué {ejeLocal.nombre.toLowerCase()} es esta cuenta?</span>
            <select className="cx-input" value={local} onChange={(e) => setLocal(e.target.value)}>
              <option value="">Elige…</option>
              <option value={COMUN}>Común a todos</option>
              {datos.locales.map((l) => <option key={l.id} value={l.id}>{l.nombre}</option>)}
            </select>
          </label>
        )}
        {error && <div className="cx-error" role="alert">{error}</div>}
        <div className="cx-pie">
          <button type="button" className="cx-boton-sec" onClick={alCerrar}>Cancelar</button>
          <button type="submit" className="cx-boton" disabled={falta || guardando}>{guardando ? 'Dando de alta…' : 'Dar de alta'}</button>
        </div>
      </form>
    </Dialogo>
  )
}
