// src/modules/conta/portal/pantallas/Firmar.tsx
//
// GP · Tarea 3 · Firmar por aceptación (17/11): ver el documento, pedir el
// código (llega al correo) y escribirlo. Firmado, queda quién, cuándo y desde
// dónde, y el PDF firmado en Documentos. La firma electrónica avanzada va con la
// hoja de encargo, después.

import { useState } from 'react'
import { abrir, accion } from '../cliente'
import { Dialogo } from '../comun'
import type { Peticion } from '../tipos'

export function Firmar({ cliente, peticion, cerrar, hecho }: { cliente: string; peticion: Peticion; cerrar: () => void; hecho: (frase: string) => void }) {
  const [firma, setFirma] = useState<string | null>(null)
  const [codigo, setCodigo] = useState('')
  const [nota, setNota] = useState<{ ok: boolean; t: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [leido, setLeido] = useState(false)

  const pedir = async () => {
    setOcupado(true); setNota(null)
    try {
      const r = await accion('firma_pedir', { peticion: peticion.id })
      setNota({ ok: r.ok, t: r.frase ?? '' })
      if (r.ok && typeof r.firma === 'string') setFirma(r.firma)
    } catch (e) { setNota({ ok: false, t: (e as Error).message }) } finally { setOcupado(false) }
  }
  const comprobar = async () => {
    if (!firma) return
    setOcupado(true)
    try {
      const r = await accion('firma_comprobar', { firma, codigo })
      if (r.ok) hecho(r.frase ?? 'Firmado.')
      else setNota({ ok: false, t: r.frase ?? 'Ese código no es.' })
    } catch (e) { setNota({ ok: false, t: (e as Error).message }) } finally { setOcupado(false) }
  }
  const ver = async () => {
    try { await abrir(cliente, 'peticion', peticion.id); setLeido(true) } catch (e) { setNota({ ok: false, t: (e as Error).message }) }
  }

  return (
    <Dialogo titulo={peticion.titulo} cerrar={cerrar}>
      <div className="pt-nota" style={{ fontSize: 13 }}>
        Léelo antes de firmar. Para firmar te mandamos un código de 6 cifras a tu correo: escribirlo aquí es tu firma. Queda guardado quién firma, cuándo y desde dónde, y el PDF firmado.
      </div>
      <div className="pt-botones"><button type="button" className="pt-boton sec" onClick={ver}>Ver el documento</button></div>
      {!firma ? (
        <div className="pt-botones">
          <button type="button" className="pt-boton" disabled={ocupado} onClick={pedir}>{ocupado ? 'Mandando…' : leido ? 'Lo he leído: mandarme el código' : 'Mandarme el código'}</button>
        </div>
      ) : (
        <>
          <label className="pt-campo">Código de 6 cifras
            <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} />
          </label>
          <div className="pt-botones">
            <button type="button" className="pt-boton" disabled={ocupado || codigo.length !== 6} onClick={comprobar}>{ocupado ? 'Firmando…' : 'Firmar'}</button>
            <button type="button" className="pt-boton enlace" disabled={ocupado} onClick={pedir}>Mandarme otro</button>
          </div>
        </>
      )}
      {nota && <div className={`pt-aviso ${nota.ok ? 'ok' : 'mal'}`} role={nota.ok ? 'status' : 'alert'}><span>{nota.t}</span></div>}
    </Dialogo>
  )
}
