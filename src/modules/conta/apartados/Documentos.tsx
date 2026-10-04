// src/modules/conta/apartados/Documentos.tsx
//
// Los documentos del proveedor, de `compliance_document` (la tabla que ya
// existía; el encargo pide no crear otra). Aquí se sube el certificado de
// titularidad bancaria (familia nueva del C01) y se ven los demás: fichas
// técnicas, homologación… con su caducidad.

import { useRef, useState } from 'react'
import { useFicha } from '@/modules/conta/components/FichaContexto'
import { Guardado } from '@/modules/conta/components/ui'
import { useAvisoGuardado } from '@/modules/conta/hooks/useAvisoGuardado'
import { tieneCertificadoBanco } from '@/modules/conta/services/proveedorService'
import { DOC_FAMILY_LABEL, uploadComplianceDocument, type DocFamily } from '@/modules/appcc/services/complianceDocumentService'
import { fechaLarga, hoyEnMadrid } from '@/modules/conta/lib/formato'

const ESTADO: Record<string, string> = {
  pending_ocr: 'Leyendo…', pending_review: 'Por revisar', active: 'Vigente', superseded: 'Sustituido', expired: 'Caducado',
}

export default function Documentos() {
  const { datos, recargar } = useFicha()
  const entrada = useRef<HTMLInputElement>(null)
  const [ocupado, setOcupado] = useState(false)
  const [fallo, setFallo] = useState<string | null>(null)
  const [aviso, avisar] = useAvisoGuardado()
  const cert = tieneCertificadoBanco(datos.documentos)

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
        issuedAt: hoyEnMadrid(),
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
    <div className="cf-form cf-form-ancho" style={{ maxWidth: 720 }}>
      {fallo && <div className="cf-error" role="alert">{fallo}</div>}
      {datos.ficha.iban && !cert && (
        <div className="cf-aviso" id="campo-bank_ownership_certificate">
          Falta el certificado del banco: el papel del banco que dice que esa cuenta es suya. Protege de cambios de IBAN fraudulentos.
        </div>
      )}
      <div className="cf-pie-form">
        <button type="button" className={cert ? 'cf-boton-sec' : 'cf-boton'} disabled={ocupado} onClick={() => entrada.current?.click()}>
          {ocupado ? 'Subiendo…' : cert ? 'Subir otro certificado del banco' : 'Subir certificado del banco'}
        </button>
        <input ref={entrada} type="file" accept="application/pdf,image/*" hidden onChange={subir} aria-label="Certificado de titularidad bancaria" />
        <Guardado texto={aviso} />
      </div>
      {datos.documentos.length === 0
        ? <p className="cf-nota" style={{ margin: 0 }}>Aún no hay documentos suyos.</p>
        : (
          <div className="cf-tarjeta" style={{ gap: 0 }}>
            {datos.documentos.map((d) => (
              <div key={d.id} className="cf-contacto" style={{ padding: '10px 0', borderBottom: '1px solid var(--cf-linea)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span className="cf-contacto-nombre">{d.title}</span>
                  <span className="cf-contacto-detalle">
                    {DOC_FAMILY_LABEL[d.docFamily as DocFamily] ?? d.docFamily}
                    {d.expiresAt ? ` · caduca el ${fechaLarga(d.expiresAt)}` : ''}
                  </span>
                </div>
                <span className={`cf-estado ${d.status === 'active' ? 'cf-estado-pagada' : 'cf-estado-otro'}`}>{ESTADO[d.status] ?? d.status}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}
