// src/modules/kds/KdsKioskRoute.tsx
//
// Modo KIOSCO del KDS — ruta pública /kds (la monta App.tsx ANTES de los gates
// de sesión). FRONTERA DE TOKEN: no hay login; el dispositivo se identifica con
// un token largo (kds_device.token). El token entra por ?token=XXX (se guarda en
// localStorage para futuros arranques) o ya está guardado de una vinculación
// previa.
//
// Con token, el tablero se pide con kds_board(null, token): la RPC valida el
// token y deriva el local + las estaciones del propio dispositivo. Se reutiliza
// EL MISMO KdsBoard que en el Shell, inyectando el token a todas las RPC.

import { useEffect, useState } from 'react'
import { MonitorPlay, LogOut, Loader2 } from 'lucide-react'
import KdsBoard from './components/KdsBoard'
import { getBoard } from './services/kdsService'

const TOKEN_KEY = 'kds_device_token'

function readStoredToken(): string | null {
  try { return window.localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function storeToken(token: string): void {
  try { window.localStorage.setItem(TOKEN_KEY, token) } catch { /* modo privado */ }
}
function clearToken(): void {
  try { window.localStorage.removeItem(TOKEN_KEY) } catch { /* noop */ }
}

type Status = 'idle' | 'checking' | 'valid' | 'invalid'

export default function KdsKioskRoute() {
  const [token, setToken] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [pasteValue, setPasteValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Resolución inicial del token: ?token= en la URL (lo guarda y limpia la URL)
  // o el que hubiera en localStorage de una vinculación previa.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('token')
    if (fromUrl) {
      storeToken(fromUrl)
      // Limpia el token de la URL (evita que quede expuesto/compartido).
      window.history.replaceState({}, '', '/kds')
      setToken(fromUrl)
      return
    }
    setToken(readStoredToken())
  }, [])

  // Valida el token contra la RPC (una llamada de prueba a kds_board(null, token)).
  useEffect(() => {
    if (!token) { setStatus('idle'); return }
    let cancelled = false
    setStatus('checking')
    setError(null)
    getBoard(null, token)
      .then(() => { if (!cancelled) setStatus('valid') })
      .catch((e: unknown) => {
        if (cancelled) return
        setStatus('invalid')
        setError(e instanceof Error ? e.message : 'Token no válido')
      })
    return () => { cancelled = true }
  }, [token])

  function handleLink() {
    const t = pasteValue.trim()
    if (!t) return
    storeToken(t)
    setToken(t)
    setPasteValue('')
  }

  function handleUnlink() {
    clearToken()
    setToken(null)
    setStatus('idle')
    setError(null)
  }

  // ── Pantalla de vinculación (sin token o token inválido) ──────────────────
  if (!token || status === 'invalid') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <MonitorPlay size={48} className="mx-auto mb-4 text-emerald-400" />
          <h1 className="text-2xl font-bold">Vincular este dispositivo</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Pega el token del dispositivo (lo generas en Ajustes de cocina → Dispositivos) o abre la
            URL del kiosco que copiaste allí.
          </p>
          {status === 'invalid' && error && (
            <div className="mt-4 rounded-lg bg-red-500/15 text-red-200 ring-1 ring-red-500/40 px-3 py-2 text-sm">
              El token no es válido o fue revocado. {error}
            </div>
          )}
          <div className="mt-6 flex flex-col gap-2">
            <input
              value={pasteValue}
              onChange={e => setPasteValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleLink() }}
              placeholder="kdsdev_…"
              className="w-full rounded-lg bg-zinc-900 ring-1 ring-zinc-700 px-4 py-3 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-emerald-400"
              autoFocus
            />
            <button
              onClick={handleLink}
              disabled={!pasteValue.trim()}
              className="w-full rounded-lg bg-emerald-500 text-zinc-950 font-bold py-3 hover:bg-emerald-400 disabled:opacity-50"
            >
              Vincular dispositivo
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Comprobando token ─────────────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div className="fixed inset-0 bg-zinc-950 text-zinc-400 flex items-center justify-center gap-2">
        <Loader2 className="animate-spin" size={20} /> Conectando con la cocina…
      </div>
    )
  }

  // ── Tablero a pantalla completa ───────────────────────────────────────────
  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col">
      <header className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-2 text-zinc-300">
          <MonitorPlay size={18} className="text-emerald-400" />
          <span className="text-sm font-semibold">Folvy KDS</span>
        </div>
        <button
          onClick={handleUnlink}
          className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-200 px-2 py-1 rounded-md hover:bg-zinc-800"
          title="Desvincular este dispositivo"
        >
          <LogOut size={14} /> Desvincular
        </button>
      </header>
      <div className="flex-1 min-h-0">
        <KdsBoard locationId={null} token={token} />
      </div>
    </div>
  )
}
