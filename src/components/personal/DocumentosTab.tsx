// src/components/personal/DocumentosTab.tsx
// Pestaña de Documentos del empleado en la ficha del gestor.
import { useState, useEffect, useRef } from 'react'
import { Card, Button } from '../ui'
import type { Employee } from '../../types'
import type { DocumentFile } from '../../types/personal'
import { DOCUMENT_TYPES } from '../../types/personal'
import { fetchDocuments, uploadDocument, getDocumentUrl, deleteDocument } from '../../services/documentsService'

interface Props {
  employee: Employee
}

export default function DocumentosTab({ employee }: Props) {
  const [docs, setDocs] = useState<DocumentFile[]>([])
  const [loading, setLoading] = useState(true)
  const [showUpload, setShowUpload] = useState(false)
  const [uploadType, setUploadType] = useState('nomina')
  const [uploadNotes, setUploadNotes] = useState('')
  const [customType, setCustomType] = useState('')
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
      const finalType = uploadType === 'custom' && customType.trim() ? customType.trim() : uploadType
      await uploadDocument(employee.id, file, finalType, null, 'gestor', uploadNotes)
      await load()
      setShowUpload(false)
      setUploadNotes(''); setCustomType('')
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
    if (!confirm(`¿Eliminar "${doc.name}"?`)) return
    await deleteDocument(doc)
    await load()
  }

  function typeLabel(typeId: string): { label: string; icon: string } {
    const t = DOCUMENT_TYPES.find(x => x.id === typeId)
    return t ? { label: t.label, icon: t.icon } : { label: typeId, icon: '📄' }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-500">{docs.length} documento{docs.length !== 1 ? 's' : ''}</p>
        <Button size="sm" onClick={() => setShowUpload(true)}>+ Subir documento</Button>
      </div>

      {loading ? (
        <Card className="p-6 text-center"><p className="text-sm text-gray-500">Cargando...</p></Card>
      ) : docs.length === 0 ? (
        <Card className="p-6 text-center">
          <p className="text-3xl mb-2">📁</p>
          <p className="text-sm text-gray-700">Sin documentos</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {docs.map(doc => {
            const t = typeLabel(doc.type)
            return (
              <Card key={doc.id} className="p-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">{t.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{doc.name}</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {t.label} · {doc.fileSizeKb.toLocaleString()} KB · {new Date(doc.createdAt).toLocaleDateString('es-ES')}
                      {doc.uploadedRole === 'trabajador' && (
                        <span className="ml-2 px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-medium">Subido por el trabajador</span>
                      )}
                    </p>
                    {doc.notes && <p className="text-xs text-gray-400 mt-1 italic">"{doc.notes}"</p>}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button onClick={() => handleDownload(doc)}
                      className="text-xs px-3 py-1.5 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">
                      Ver
                    </button>
                    <button onClick={() => handleDelete(doc)}
                      className="text-xs px-3 py-1.5 rounded bg-red-50 text-red-700 hover:bg-red-100">
                      Borrar
                    </button>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modal subida */}
      {showUpload && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-5 max-h-[90vh] overflow-y-auto">
            <p className="font-bold text-lg mb-4">Subir documento</p>

            <label className="text-xs text-gray-500 block mb-1">Tipo</label>
            <select value={uploadType} onChange={e => setUploadType(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white mb-3">
              {DOCUMENT_TYPES.map(t => (
                <option key={t.id} value={t.id}>{t.icon} {t.label}</option>
              ))}
              <option value="custom">+ Tipo personalizado</option>
            </select>

            {uploadType === 'custom' && (
              <input type="text" value={customType} onChange={e => setCustomType(e.target.value)}
                placeholder="Ej: Carnet manipulador alimentos"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3" />
            )}

            <label className="text-xs text-gray-500 block mb-1">Notas (opcional)</label>
            <textarea value={uploadNotes} onChange={e => setUploadNotes(e.target.value)}
              placeholder="Ej: Nómina abril 2026"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-3 h-20 resize-none" />

            <input ref={fileInputRef} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp"
              onChange={handleUpload} className="hidden" />

            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}

            <div className="flex gap-2">
              <Button variant="outline" onClick={() => { setShowUpload(false); setError(''); setUploadNotes(''); setCustomType('') }}
                className="flex-1">Cancelar</Button>
              <Button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex-1">
                {uploading ? 'Subiendo...' : 'Elegir archivo'}
              </Button>
            </div>

            <p className="text-[10px] text-gray-400 text-center mt-3">PDF, JPG, PNG o WEBP. Máximo 5 MB.</p>
          </div>
        </div>
      )}
    </div>
  )
}
