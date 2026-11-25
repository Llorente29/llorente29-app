// src/modules/conta/empresa/ApartadoFacturacionCegid.tsx
//
// Q10 · respuesta 1 · punto 1 · «Facturación de Cegid» en Ajustes › Ejercicio, al lado de «Salida a ERP10»:
//   · las cuatro claves (clientId, clientSecret, usuario y contraseña) se escriben una vez y se guardan cifradas
//     (el Vault, por connector-credentials, como las de ERP10): no se vuelven a enseñar, solo se dice si están;
//   · el código de empresa de esta sociedad en Cegid («empresa» del login);
//   · «Probar la conexión»: entra y lee las series, sin escribir nada; dice con qué ha entrado y qué series hay, o
//     por qué no ha podido (regla 8).
// Lo pone QBO o Julio: QBO está pidiendo claves nuevas, porque las de antes quedaron a la vista. Los cuatro campos
// van como contraseña (no se ven al escribir) y se vacían al guardar.

import { useEffect, useState, type FormEvent } from 'react'
import { CampoTexto, Resultado, TarjetaApartado } from '@/modules/conta/empresa/campos'
import { TarjetaCargando } from '@/modules/conta/ui/piezas'
import { guardarClavesCegid, guardarCodigoCegid, leerConexionCegid, probarCegid, type ClavesCegid, type ConexionCegid } from '@/modules/conta/services/cegidService'
import type { Quien } from '@/modules/conta/empresa/apartados'
import { useGestoria } from '@/modules/conta/marco/nuevo/contexto'

const VACIAS: ClavesCegid = { client_id: '', client_secret: '', username: '', password: '' }

export function ApartadoFacturacionCegid({ quien, movil, nombre }: { quien: Quien; movil: boolean; nombre: string | null }) {
  const [con, setCon] = useState<ConexionCegid | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vuelta, setVuelta] = useState(0)
  const [claves, setClaves] = useState<ClavesCegid>(VACIAS)
  const [codigo, setCodigo] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [hecho, setHecho] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)

  // Solo en una empresa del sector Gestoría (las que facturan cuotas con Cegid).
  const gestoria = useGestoria()
  useEffect(() => {
    if (!gestoria) return
    let vivo = true
    leerConexionCegid(quien.accountId, quien.companyId).then((x) => { if (vivo) { setCon(x); setCodigo(x.codigo); setError(null) } },
      (e: unknown) => { if (vivo) { setError(e instanceof Error ? e.message : String(e)); setCon(null) } })
    return () => { vivo = false }
  }, [quien.accountId, quien.companyId, vuelta, gestoria])

  if (!gestoria) return null
  if (!con && !error) return <TarjetaCargando />
  const hacer = async (fn: () => Promise<string>) => {
    setOcupado(true); setHecho(null); setFallo(null)
    try { setHecho(await fn()); setVuelta((v) => v + 1) } catch (e) { setFallo(e instanceof Error ? e.message : String(e)) } finally { setOcupado(false) }
  }
  const guardarClaves = (e: FormEvent) => {
    e.preventDefault()
    if (!con) return
    void hacer(async () => { const f = await guardarClavesCegid(quien.accountId, con, claves, nombre); setClaves(VACIAS); return f })
  }
  const guardarCodigo = (e: FormEvent) => {
    e.preventDefault()
    if (!con) return
    void hacer(() => guardarCodigoCegid(quien.accountId, quien.companyId, con, codigo, nombre))
  }
  const campo = (k: keyof ClavesCegid, etiqueta: string) => (
    <CampoTexto etiqueta={etiqueta} tipo="password" valor={claves[k]} cambiar={(v) => setClaves((c) => ({ ...c, [k]: v }))} deshabilitado={ocupado} />
  )

  return (
    <TarjetaApartado titulo="Facturación de Cegid" movil={movil}>
      {error && <div className="cx-error" role="alert">No se ha podido leer la conexión con la facturación de Cegid: {error}</div>}
      {con && (
        <div data-prueba="cegid-conexion">
          <p className="cx-texto">
            Para cuadrar lo cobrado por GoCardless con lo que factura Cegid. Sumied solo lee: clientes, conceptos y facturas.
            {con.conClaves ? ' Las claves están guardadas, cifradas.' : ' Faltan las claves.'}
          </p>
          <form onSubmit={guardarClaves} autoComplete="off">
            {campo('client_id', 'clientId (de Diez Software)')}
            {campo('client_secret', 'clientSecret (de Diez Software)')}
            {campo('username', 'Usuario de Cegid')}
            {campo('password', 'Contraseña de Cegid')}
            <button type="submit" className="cx-boton-sec" disabled={ocupado}>{con.conClaves ? 'Cambiar las claves' : 'Guardar las claves'}</button>
          </form>
          <form onSubmit={guardarCodigo} autoComplete="off">
            <CampoTexto etiqueta="Código de esta empresa en Cegid" valor={codigo} cambiar={setCodigo} deshabilitado={ocupado} modo="numeric" />
            <button type="submit" className="cx-boton-sec" disabled={ocupado || !codigo.trim()}>Guardar el código</button>
          </form>
          <button type="button" className="cx-boton" disabled={ocupado || !con.conClaves || !con.codigo.trim()}
            onClick={() => void hacer(() => probarCegid(quien.companyId))}>Probar la conexión</button>
          {(!con.conClaves || !con.codigo.trim()) && <p className="cx-texto">Para probar, hacen falta las claves y el código de la empresa.</p>}
          <Resultado hecho={hecho} fallo={fallo} />
        </div>
      )}
    </TarjetaApartado>
  )
}
