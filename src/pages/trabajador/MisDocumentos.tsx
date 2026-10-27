// src/pages/trabajador/MisDocumentos.tsx
//
// L00 · Respuesta 1 (27/10/2026): solo lectura. El almacén de los contratos y
// las nóminas es privado: el trabajador ve y abre lo suyo, con un enlace que
// caduca en pocos minutos, y no sube ni borra (solo el administrador). La
// subida de antes ya fallaba: la tabla `documents` solo deja escribir al
// administrador.
import { useState, useEffect } from 'react'
import { ArrowLeft, FileText } from 'lucide-react'
import { Card } from '../../components/ui'
import { fmtInt } from '../../lib/format'
import type { Employee } from '../../types'
import type { DocumentFile } from '../../types/personal'
import { DOCUMENT_TYPES } from '../../types/personal'
import { fetchDocuments, abrirDocumento } from '../../services/documentsService'

interface Props {
  employee: Employee
  onBack: () => void
}

export default function MisDocumentos({ employee, onBack }: Props) {
  const [docs, setDocs] = useState<DocumentFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [abriendo, setAbriendo] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const list = await fetchDocuments(employee.id)
    setDocs(list || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [employee.id])

  async function handleDownload(doc: DocumentFile) {
    setError('')
    setAbriendo(doc.id)
    try {
      await abrirDocumento(doc.filePath)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'No se ha podido abrir el documento.')
    } finally {
      setAbriendo(null)
    }
  }

  function typeLabel(typeId: string): { label: string; icon: string } {
    const t = DOCUMENT_TYPES.find(x => x.id === typeId)
    return t ? { label: t.label, icon: t.icon } : { label: typeId, icon: '📄' }
  }

  return (
    <div className="min-h-screen bg-page p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-text-secondary w-9 h-9 rounded-full hover:bg-accent-bg flex items-center justify-center transition-base" aria-label="Volver">
            <ArrowLeft size={20} />
          </button>
          <div className="flex-1">
            <p className="text-xs text-text-secondary uppercase tracking-wide">Mis documentos</p>
            <p className="font-bold text-text-primary">{employee.name.split(' ')[0]}</p>
          </div>
        </div>

        {error && (
          <Card className="p-3 mb-3">
            <p role="alert" className="text-sm text-danger">{error}</p>
          </Card>
        )}

        {loading ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-text-secondary">Cargando...</p>
          </Card>
        ) : docs.length === 0 ? (
          <Card className="p-6 text-center">
            <div className="flex justify-center mb-2"><FileText size={32} className="text-accent" /></div>
            <p className="font-semibold text-text-primary">Sin documentos</p>
            <p className="text-xs text-text-secondary mt-1">Aún no tienes documentos. Tu encargado los subirá aquí.</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {docs.map(doc => {
              const t = typeLabel(doc.type)
              return (
                <Card key={doc.id} className="p-3">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl">{t.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-text-primary text-sm truncate">{doc.name}</p>
                      <p className="text-xs text-text-secondary mt-0.5">
                        {t.label} · {fmtInt(doc.fileSizeKb)} KB · {new Date(doc.createdAt).toLocaleDateString('es-ES')}
                      </p>
                      {doc.notes && <p className="text-xs text-text-secondary mt-1 italic">{doc.notes}</p>}
                    </div>
                    <button onClick={() => handleDownload(doc)} disabled={abriendo === doc.id}
                      className="text-xs px-2 py-1 rounded bg-accent-bg text-accent hover:opacity-90 disabled:opacity-50 transition-base">
                      {abriendo === doc.id ? 'Abriendo…' : 'Ver'}
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        <p className="text-xs text-text-secondary text-center mt-4">
          ¿Tienes que entregar un documento, como un parte de baja? Dáselo a tu encargado: él lo sube a tu ficha.
        </p>
      </div>
    </div>
  )
}
