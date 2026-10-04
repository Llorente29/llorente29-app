// src/modules/conta/proveedor/Documentos.tsx
//
// Los documentos del proveedor, de `compliance_document` (la tabla que ya
// existía; no se crea otra). Aquí se sube el certificado de titularidad
// bancaria y se ven los demás (fichas técnicas, homologación…) con su
// caducidad. Lo que caduca pronto sale en ámbar.

import { useRef, useState } from 'react'
import { useFicha } from '@/modules/conta/proveedor/contexto'
import { Guardado, Vacio } from '@/modules/conta/ui/piezas'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { tieneCertificadoBanco } from '@/modules/conta/services/proveedorService'
import { DOC_FAMILY_LABEL, uploadComplianceDocument, type DocFamily } from '@/modules/appcc/services/complianceDocumentService'
import { fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'

const ESTADO: Record<string, string> = {
  pending_ocr: 'Leyendo…', pending_review: 'Por revisar', active: 'Vigente', superseded: 'Sustituido', expired: 'Caducado',
}

/** ¿Caduca en 30 días o menos (o ya ha caducado)? */
function caducaPronto(expiresAt: string | null, hoy: string): boolean {
  if (!expiresAt) return false
  const dias = (Date.parse(expiresAt.slice(0, 10)) - Date.parse(hoy)) / 86_400_000
  return dias <= 30
}

export default function Documentos() {
  const { datos, recargar } = useFicha()
  const entrada = useRef<HTMLInputElement>(null)
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  const cert = tieneCertificadoBanco(datos.documentos, datos.ficha.ibanChangedAt)
  const hoy = hoyEnMadrid()

  async function subir(e: React.ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0]
    e.target.value = ''
    if (!archivo) return
    setOcupado(true); setFallo(null)
    try {
      await uploadComplianceDocument({
        accountId: datos.ficha.accountId,
        docFamily: 'bank_ownership_certificate',
        title: `Certificado de titularidad bancaria · ${datos.ficha.name}`,
        file: archivo,
        supplierId: datos.ficha.id,
        issuedAt: hoy,
      })
      await recargar()
      avisar(`Certificado del banco subido (${archivo.name}).`)
    } catch (e2) {
      setFallo(e2 instanceof Error ? e2.message : 'No se pudo subir el certificado.')
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="cx-formulario">
      {fallo && <div className="cx-error" role="alert">{fallo}</div>}
      {datos.ficha.iban && !cert && (
        <div className="cx-aviso" id="campo-bank_ownership_certificate" tabIndex={-1}>
          {datos.ficha.ibanChangedAt
            ? <>Falta el certificado del banco de la cuenta NUEVA: el IBAN cambió el {fechaLarga(datos.ficha.ibanChangedAt.slice(0, 10))}{datos.ficha.ibanChangedByName ? ` (lo cambió ${datos.ficha.ibanChangedByName})` : ''} y el certificado de antes ya no vale.</>
            : 'Falta el certificado del banco: el papel del banco que dice que esa cuenta es suya. Protege de cambios de IBAN fraudulentos.'}
        </div>
      )}
      <div className="cx-pie" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className={cert ? 'cx-boton-sec' : 'cx-boton'} disabled={ocupado} onClick={() => entrada.current?.click()}>
          {ocupado ? 'Subiendo…' : cert ? 'Subir otro certificado del banco' : 'Subir certificado del banco'}
        </button>
        <input ref={entrada} type="file" accept="application/pdf,image/*" hidden onChange={subir} aria-label="Certificado de titularidad bancaria" />
      </div>
      <Guardado texto={aviso} />
      <div className="cx-tarjeta" style={{ padding: '6px 18px' }}>
        {datos.documentos.length === 0
          ? <div style={{ padding: '12px 0' }}><Vacio titulo="Aún no hay documentos suyos." explicacion="Su certificado del banco, sus fichas técnicas y su homologación se guardan aquí." /></div>
          : datos.documentos.map((d) => {
            const pronto = d.status === 'active' && caducaPronto(d.expiresAt, hoy)
            return (
              <div key={d.id} className="cxp-contacto">
                <div className="cxp-contacto-texto">
                  <div className="cxp-contacto-nombre">{d.title}</div>
                  <div className={pronto ? 'cxp-incompleta' : 'cxp-contacto-apoyo'}>
                    {DOC_FAMILY_LABEL[d.docFamily as DocFamily] ?? d.docFamily}
                    {d.expiresAt ? ` · caduca el ${fechaLarga(d.expiresAt)}` : ''}
                  </div>
                </div>
                <span className={`cx-chip${d.status === 'active' ? (pronto ? ' cx-chip-ambar' : ' cx-chip-ia') : ''}`}>{ESTADO[d.status] ?? d.status}</span>
              </div>
            )
          })}
      </div>
    </div>
  )
}
