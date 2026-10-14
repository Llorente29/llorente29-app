// src/modules/conta/documentos/Pedirselas.tsx
//
// D01 · «Pedírselas» (N22): las facturas esperadas que no han llegado, una a
// una. Pregunta «¿A quién se la pido?» con el contacto de Facturación de su
// ficha si lo tiene; al confirmar, la petición queda guardada como CONFIRMADA
// por la persona (conta_factura_pedir) y se abre SU correo con el mensaje
// escrito: mientras no haya dominio de correo, nada sale solo (R1 punto 5).
// Lo que ha pasado se dice (regla 8).

import { useEffect, useState } from 'react'
import { Dialogo } from '@/modules/conta/proveedor/piezas'
import { contactoFacturacion, pedirFactura } from '@/modules/conta/services/documentosService'
import type { Esperada } from '@/modules/conta/documentos/documentos'

const nombreMes = (periodo: string) => new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${periodo.slice(0, 10)}T00:00:00Z`))
const campo = { display: 'flex', flexDirection: 'column', gap: 4 } as const

export function Pedirselas({ companyId, esperadas, quien, alCerrar, alPedir }: {
  companyId: string; esperadas: Esperada[]; quien: string | null; alCerrar: () => void; alPedir: () => void
}) {
  const [i, setI] = useState(0)
  const [hechas, setHechas] = useState<string[]>([])
  const e = esperadas[i] ?? null
  return (
    <Dialogo titulo={e ? '¿A quién se la pido?' : 'Pedírselas'} alCerrar={alCerrar}>
      <div role="status" aria-live="polite">{hechas.map((h, k) => <p key={k} className="cx-guardado">{h}</p>)}</div>
      {!e && <p>{hechas.length ? 'No queda ninguna por pedir.' : 'No falta ninguna factura esperada.'}</p>}
      {e && (
        <UnaEsperada key={`${e.supplier_id}:${e.periodo}`} e={e} companyId={companyId} quien={quien}
          cuenta={esperadas.length > 1 ? `${i + 1} de ${esperadas.length}` : null} hayOtra={esperadas.length > i + 1}
          alSaltar={() => setI((x) => x + 1)}
          alPedir={(texto) => { setHechas((h) => [...h, texto]); alPedir(); setI((x) => x + 1) }} />
      )}
    </Dialogo>
  )
}

function UnaEsperada({ e, companyId, quien, cuenta, hayOtra, alSaltar, alPedir }: {
  e: Esperada; companyId: string; quien: string | null; cuenta: string | null; hayOtra: boolean; alSaltar: () => void; alPedir: (texto: string) => void
}) {
  const que = `${e.label ? `${e.label} · ` : ''}${e.supplier_name}`
  const asunto = `Factura de ${nombreMes(e.periodo)}`
  const [email, setEmail] = useState('')
  const [contacto, setContacto] = useState('')
  const [tenia, setTenia] = useState(false)
  const [guardar, setGuardar] = useState(true)
  const [cuerpo, setCuerpo] = useState(`Hola:\n\nNos falta la factura de ${nombreMes(e.periodo)}. ¿Nos la podéis mandar?\n\nGracias.${quien ? `\n${quien}` : ''}`)
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    contactoFacturacion(e.supplier_id).then((c) => {
      if (!vivo || !c) return
      setEmail(c.email); setContacto(c.nombre); setTenia(true); setGuardar(false)
    }).catch((x: unknown) => { if (vivo) setFallo(x instanceof Error ? x.message : String(x)) })
    return () => { vivo = false }
  }, [e.supplier_id])

  async function confirmar() {
    setOcupado(true); setFallo(null)
    try {
      const r = await pedirFactura(companyId, { supplierId: e.supplier_id, periodo: e.periodo.slice(0, 10), email, contacto: contacto || null, guardarContacto: guardar && !tenia, asunto, cuerpo }, quien)
      window.location.href = r.mailto
      alPedir(r.yaEstaba
        ? `${que}: ya estaba pedida este mes; se abre tu correo por si quieres volver a mandarla.`
        : `${que}: pedida a ${email.trim()}. Se abre tu correo con el mensaje: envíalo desde ahí.${guardar && !tenia ? ' Guardada como su contacto de Facturación.' : ''}`)
    } catch (x) {
      setFallo(x instanceof Error ? x.message : String(x))
      setOcupado(false)
    }
  }

  return (
    <form onSubmit={(x) => { x.preventDefault(); void confirmar() }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ margin: 0 }}><strong>{que}</strong> · la de {nombreMes(e.periodo)}{cuenta ? ` (${cuenta})` : ''}</p>
      <label style={campo}>
        <span>Su correo</span>
        <input className="cx-input" type="email" required value={email} onChange={(x) => setEmail(x.target.value)} placeholder="facturas@proveedor.es" />
      </label>
      {!tenia && (
        <>
          <label style={campo}>
            <span>Quién es (opcional)</span>
            <input className="cx-input" value={contacto} onChange={(x) => setContacto(x.target.value)} placeholder="Administración" />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', minHeight: 44 }}>
            <input type="checkbox" checked={guardar} onChange={(x) => setGuardar(x.target.checked)} />
            Guardarlo como su contacto de Facturación
          </label>
        </>
      )}
      {tenia && <p className="cx-ayuda" style={{ margin: 0 }}>Es su contacto de Facturación{contacto ? ` (${contacto})` : ''}.</p>}
      <label style={campo}>
        <span>El mensaje</span>
        <textarea className="cx-input" rows={5} value={cuerpo} onChange={(x) => setCuerpo(x.target.value)} />
      </label>
      <p className="cx-ayuda" style={{ margin: 0 }}>No sale nada solo: se abre tu correo con el mensaje y lo mandas tú.</p>
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      <div className="cxr-acciones">
        {hayOtra && <button type="button" className="cx-boton-sec" onClick={alSaltar}>Esta no</button>}
        <button type="submit" className="cx-boton" disabled={ocupado || !email.trim()}>{ocupado ? 'Guardando…' : 'Confirmar y abrir mi correo'}</button>
      </div>
    </form>
  )
}
