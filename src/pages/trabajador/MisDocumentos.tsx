// src/pages/trabajador/MisDocumentos.tsx
import { useState, useEffect, useRef } from 'react'
import { Card } from '../../components/ui'
import type { Employee } from '../../types'
import type { DocumentFile } from '../../types/personal'
import { DOCUMENT_TYPES } from '../../types/personal'
import { fetchDocuments, uploadDocument, getDocumentUrl, deleteDocument } from '../../services/documentsService'

interface Props {
  employee: Employee
  onBack: () => void
}

export default function MisDocumentos({ employee, onBack }: Props) {
  const [docs, setDocs] = useState<DocumentFile[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadType, setUploadType] = useState('baja_medica')
  const [uploadNotes, setUploadNotes] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function load() {
    setLoading(true)
    const list = await fetchDocuments(employee.id)
    setDocs(list || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [employee.id])

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      await uploadDocument(employee.id, file, uploadType, employee.id, 'trabajador', uploadNotes)
      await load()
      setShowUpload(false)
      setUploadNotes('')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  function handleDownload(doc: DocumentFile) {
    const url = getDocumentUrl(doc.filePath)
    if (url) window.open(url, '_blank')
  }

  async function handleDelete(doc: DocumentFile) {
    if (doc.uploadedRole !== 'trabajador') return // solo puede borrar lo suyo
    if (!confirm(`¿Eliminar "${doc.name}"?`)) return
    await deleteDocument(doc)
    await load()
  }

  function typeLabel(typeId: string): { label: string; icon: string } {
    const t = DOCUMENT_TYPES.find(x => x.id === typeId)
    return t ? { label: t.label, icon: t.icon } : { label: typeId, icon: '📄' }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-white to-emerald-50 p-4 pb-8">
      <div className="max-w-md mx-auto">
        <div className="flex items-center gap-3 mb-5">
          <button onClick={onBack} className="text-2xl text-gray-500">←</button>
          <div className="flex-1">
            <p className="text-xs text-gray-400 uppercase tracking-wide">Mis documentos</p>
            <p className="font-bold text-gray-900">{employee.name.split(' ')[0]}</p>
          </div>
          <button
            onClick={() => setShowUpload(true)}
            className="px-3 py-1.5 rounded-full bg-teal-600 text-white text-xs font-medium hover:bg-teal-700"
          >
            + Subir
          </button>
        </div>

        {loading ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-gray-500">Cargando...</p>
          </Card>
        ) : docs.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-4xl mb-2">📁</p>
            <p className="font-semibold text-gray-700">Sin documentos</p>
            <p className="text-xs text-gray-500 mt-1">Aún no tienes documentos. Tu encargado los subirá aquí.</p>
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
                      <p className="font-medium text-gray-900 text-sm truncate">{doc.name}</p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {t.label} · {(doc.fileSizeKb).toLocaleString()} KB · {new Date(doc.createdAt).toLocaleDateString('es-ES')}
                      </p>
                      {doc.uploadedRole === 'trabajador' && (
                        <p className="text-[10px] text-teal-600 mt-0.5">Subido por ti</p>
                      )}
                      {doc.notes && <p className="text-xs text-gray-400 mt-1 italic">{doc.notes}</p>}
                    </div>
                    <div className="flex flex-col gap-1">
                      <button onClick={() => handleDownload(doc)}
                        className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">
                        Ver
                      </button>
                      {doc.uploadedRole === 'trabajador' && (
                        <button onClick={() => handleDelete(doc)}
                          className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100">
                          Borrar
                        </button>
                      )}
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>
        )}

        {/* Modal de subida */}
        {showUpload && (
          <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center">
            <div className="bg-white rounded-t-3xl sm:rounded-3xl w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
              <p className="font-bold text-lg mb-4">Subir documento</p>

              <label className="text-xs text-gray-500 block mb-1">Tipo</label>
              <select value={uploadType} onChange={e => setUploadType(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white mb-3">
                {DOCUMENT_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
                ))}
              </select>

              <label className="text-xs text-gray-500 block mb-1">Notas (opcional)</label>
              <textarea value={uploadNotes} onChange={e => setUploadNotes(e.target.value)}
                placeholder="Ej: Baja desde el 10 al 15 de mayo"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />

              <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={handleUpload} className="hidden" />

              {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full py-3 rounded-xl bg-teal-600 text-white font-medium hover:bg-teal-700 disabled:opacity-50"
              >
                {uploading ? 'Subiendo...' : 'Elegir archivo y subir'}
              </button>

              <button onClick={() => { setShowUpload(false); setError(''); setUploadNotes('') }}
                className="w-full py-2 mt-2 text-sm text-gray-500 hover:text-gray-700">
                Cancelar
              </button>

              <p className="text-[10px] text-gray-400 text-center mt-3">
                PDF, JPG, PNG o WEBP. Máximo 5 MB.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
