import { useState } from 'react'
import { MapPin, FolderOpen, ShoppingCart, ClipboardList, RefreshCw, Download, LogIn, Check, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { Button, Input, Card, Badge, Alert, Tabs } from '../components/ui'
import { login, syncData, type TSpoonData, type TSpoonCenter } from '../services/tspoon'

interface TSpoonState {
  connected: boolean
  token: string
  email: string
  password: string
  centers: TSpoonCenter[]
  selectedCenter: string
  selectedCenterName: string
}

const DEFAULT_STATE: TSpoonState = {
  connected: false, token: '', email: '', password: '',
  centers: [], selectedCenter: '', selectedCenterName: ''
}

const STORAGE_KEY_TSPOON = 'andy-tspoon-v4'

function loadState(): TSpoonState {
  try { const s = localStorage.getItem(STORAGE_KEY_TSPOON); return s ? JSON.parse(s) : DEFAULT_STATE }
  catch { return DEFAULT_STATE }
}

function saveState(s: TSpoonState) {
  try { localStorage.setItem(STORAGE_KEY_TSPOON, JSON.stringify(s)) } catch {}
}

const DEFAULT_DATA: TSpoonData = { products: [], dishes: [], stores: [], lastSync: '', syncLog: [] }

function loadData(): TSpoonData {
  try { const s = localStorage.getItem(STORAGE_KEY_TSPOON + '-data'); return s ? JSON.parse(s) : DEFAULT_DATA }
  catch { return DEFAULT_DATA }
}

function saveData(d: TSpoonData) {
  try { localStorage.setItem(STORAGE_KEY_TSPOON + '-data', JSON.stringify(d)) } catch {}
}

export default function TSpoonPage() {
  const { setLocations } = useApp()
  const [state, setState] = useState<TSpoonState>(loadState)
  const [data, setData] = useState<TSpoonData>(loadData)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncProgress, setSyncProgress] = useState('')
  const [error, setError] = useState('')
  const [tab, setTab] = useState('locales')
  const [search, setSearch] = useState('')

  function persist(s: TSpoonState) { setState(s); saveState(s) }
  function persistData(d: TSpoonData) { setData(d); saveData(d) }

  async function handleLogin() {
    if (!state.email || !state.password) { setError('Introduce email y contraseña'); return }
    setLoading(true); setError('')
    try {
      const { token, centers } = await login(state.email, state.password)
      const s = { ...state, connected: true, token, centers, selectedCenter: centers[0]?.id || '', selectedCenterName: centers[0]?.description || '' }
      persist(s)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Error de conexión')
    } finally { setLoading(false) }
  }

  async function handleSync() {
    if (!state.token || !state.selectedCenter) return
    setSyncing(true); setSyncProgress('Iniciando sincronización...')
    try {
      const result = await syncData(state.token, state.selectedCenter, msg => setSyncProgress(msg))
      persistData(result)
      setSyncProgress('OK: Sincronización completada')
    } catch (e: unknown) {
      setSyncProgress('ERROR: ' + (e instanceof Error ? e.message : 'desconocido'))
    } finally { setSyncing(false) }
  }

  function importCentersAsLocations() {
    state.centers.forEach(center => {
      setLocations(prev => {
        if (prev.some(l => l.name === center.description)) return prev
        return [...prev, {
          id: `tsp-${center.id}`,
          name: center.description,
          address: center.address || '',
          phone: '',
          active: true,
        }]
      })
    })
    alert(`${state.centers.length} local(es) importados de tSpoonLab`)
  }

  function handleDisconnect() {
    persist(DEFAULT_STATE)
    persistData(DEFAULT_DATA)
  }

  const TABS = [
    { value: 'locales', label: `Locales (${state.centers.length})` },
    { value: 'productos', label: `Productos (${data.products.length})` },
    { value: 'almacenes', label: `Almacenes (${data.stores.length})` },
    { value: 'platos', label: `Platos (${data.dishes.length})` },
  ]

  const filteredProducts = data.products.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()) || p.category?.toLowerCase().includes(search.toLowerCase()))
  const filteredDishes = data.dishes.filter(d => d.name?.toLowerCase().includes(search.toLowerCase()))

  if (!state.connected) {
    return (
      <div className="max-w-md mx-auto mt-10 space-y-5">
        <div>
          <h1 className="font-display text-2xl text-accent">Conectar tSpoonLab</h1>
          <p className="text-sm text-text-secondary mt-1">Sincroniza locales, inventario, almacenes y fichas técnicas</p>
        </div>
        <Card className="p-6 space-y-4">
          <div>
            <label className="text-xs font-medium text-text-secondary uppercase">Email tSpoonLab</label>
            <Input className="mt-1" type="email" value={state.email} onChange={e => setState(p => ({ ...p, email: e.target.value }))} placeholder="tu@email.com" />
          </div>
          <div>
            <label className="text-xs font-medium text-text-secondary uppercase">Contraseña</label>
            <Input className="mt-1" type="password" value={state.password} onChange={e => setState(p => ({ ...p, password: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleLogin()} placeholder="••••••••" />
          </div>
          {error && <Alert type="error">{error}</Alert>}
          <Button onClick={handleLogin} disabled={loading} className="w-full">
            <span className="inline-flex items-center justify-center gap-1.5">
              {loading ? <RefreshCw size={14} className="animate-spin" /> : <LogIn size={14} />}
              {loading ? 'Conectando...' : 'Conectar a tSpoonLab'}
            </span>
          </Button>
        </Card>
        <p className="text-xs text-center text-text-secondary">Usa las mismas credenciales que en app.tspoonlab.com</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header conectado */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl text-accent">tSpoonLab</h1>
          <p className="text-sm text-text-secondary mt-0.5 inline-flex items-center gap-1.5">
            <Check size={14} className="text-success" /> Conectado · {state.email}
            {data.lastSync && <span> · Última sync: {new Date(data.lastSync).toLocaleString('es-ES')}</span>}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {state.centers.length > 1 && (
            <select value={state.selectedCenter} onChange={e => {
              const c = state.centers.find(x => x.id === e.target.value)
              persist({ ...state, selectedCenter: e.target.value, selectedCenterName: c?.description || '' })
            }} className="border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary">
              {state.centers.map(c => <option key={c.id} value={c.id}>{c.description}</option>)}
            </select>
          )}
          <Button size="sm" variant="outline" onClick={handleSync} disabled={syncing}>
            <span className="inline-flex items-center gap-1.5">
              <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
              {syncing ? 'Sincronizando...' : 'Sincronizar datos'}
            </span>
          </Button>
          <Button size="sm" variant="outline" onClick={handleDisconnect}>Desconectar</Button>
        </div>
      </div>

      {syncProgress && (
        <Alert type={syncProgress.startsWith('OK') ? 'success' : syncProgress.startsWith('ERROR') ? 'error' : 'info'}>
          {syncProgress}
        </Alert>
      )}

      {/* Tabs */}
      <Tabs value={tab} onChange={setTab} tabs={TABS} />

      {/* Locales */}
      {tab === 'locales' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-secondary">{state.centers.length} centros en tSpoonLab</p>
            {state.centers.length > 0 && (
              <Button size="sm" variant="outline" onClick={importCentersAsLocations}>
                <span className="inline-flex items-center gap-1.5">
                  <Download size={14} /> Importar como Locales en Andy
                </span>
              </Button>
            )}
          </div>
          {state.centers.length === 0 ? (
            <Card className="p-8 text-center"><p className="text-text-secondary text-sm">Sin centros. Sincroniza los datos.</p></Card>
          ) : state.centers.map(c => (
            <Card key={c.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <MapPin size={18} className="text-accent shrink-0" />
                <div>
                  <p className="font-medium text-text-primary">{c.description}</p>
                  {c.address && <p className="text-xs text-text-secondary">{c.address}</p>}
                  <p className="text-xs text-text-secondary mt-0.5">ID: {c.id}</p>
                </div>
              </div>
              <Badge color={c.id === state.selectedCenter ? 'green' : 'gray'}>
                {c.id === state.selectedCenter ? 'Centro activo' : 'Inactivo'}
              </Badge>
            </Card>
          ))}
        </div>
      )}

      {/* Productos */}
      {tab === 'productos' && (
        <div className="space-y-3">
          <Input placeholder="Buscar producto..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
          {data.products.length === 0 ? (
            <Card className="p-8 text-center"><p className="text-text-secondary">Sin productos. <button onClick={handleSync} className="text-accent underline hover:text-accent-hover">Sincronizar ahora</button></p></Card>
          ) : (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-border-default bg-page">
                    <th className="p-3 text-left text-xs font-semibold text-text-secondary">
                      <span className="inline-flex items-center gap-1.5"><ShoppingCart size={14} /> Producto</span>
                    </th>
                    <th className="p-3 text-left text-xs font-semibold text-text-secondary">Categoría</th>
                    <th className="p-3 text-left text-xs font-semibold text-text-secondary hidden sm:table-cell">Almacén</th>
                    <th className="p-3 text-left text-xs font-semibold text-text-secondary hidden sm:table-cell">Unidad</th>
                  </tr></thead>
                  <tbody>
                    {filteredProducts.slice(0, 100).map(p => (
                      <tr key={p.id} className="border-b border-border-default last:border-0 hover:bg-accent-bg">
                        <td className="p-3 font-medium text-text-primary">{p.name}</td>
                        <td className="p-3 text-text-secondary">{p.category || '—'}</td>
                        <td className="p-3 text-text-secondary hidden sm:table-cell">{p.store || '—'}</td>
                        <td className="p-3 text-text-secondary hidden sm:table-cell">{p.unit || '—'}</td>
                      </tr>
                    ))}
                    {filteredProducts.length > 100 && (
                      <tr><td colSpan={4} className="p-3 text-center text-xs text-text-secondary">... y {filteredProducts.length - 100} más</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* Almacenes */}
      {tab === 'almacenes' && (
        <div className="space-y-3">
          {data.stores.length === 0 ? (
            <Card className="p-8 text-center"><p className="text-text-secondary">Sin almacenes. <button onClick={handleSync} className="text-accent underline hover:text-accent-hover">Sincronizar ahora</button></p></Card>
          ) : data.stores.map(store => (
            <Card key={store.id} className="p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <FolderOpen size={18} className="text-accent" />
                  <div>
                    <p className="font-semibold text-text-primary">{store.name}</p>
                    <p className="text-xs text-text-secondary">{store.products.length} productos</p>
                  </div>
                </div>
                <Badge color="blue">{store.products.length} items</Badge>
              </div>
              {store.products.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {store.products.slice(0, 8).map(p => (
                    <span key={p.id} className="text-xs bg-accent-bg text-text-secondary px-2 py-0.5 rounded-full">{p.name}</span>
                  ))}
                  {store.products.length > 8 && (
                    <span className="text-xs text-text-secondary">+{store.products.length - 8} más</span>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Platos */}
      {tab === 'platos' && (
        <div className="space-y-3">
          <Input placeholder="Buscar plato..." value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
          {data.dishes.length === 0 ? (
            <Card className="p-8 text-center"><p className="text-text-secondary">Sin platos. <button onClick={handleSync} className="text-accent underline hover:text-accent-hover">Sincronizar ahora</button></p></Card>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDishes.slice(0, 60).map(d => (
                <Card key={d.id} className="p-3">
                  <p className="font-medium text-sm text-text-primary inline-flex items-center gap-1.5">
                    <ClipboardList size={14} className="text-accent" />
                    {d.name}
                  </p>
                  {d.category && <p className="text-xs text-text-secondary mt-0.5">{d.category}</p>}
                  {d.allergens && d.allergens.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {d.allergens.map(a => <span key={a} className="text-[10px] bg-warning-bg text-warning px-1.5 py-0.5 rounded">{a}</span>)}
                    </div>
                  )}
                </Card>
              ))}
              {filteredDishes.length > 60 && (
                <div className="flex items-center justify-center p-4 text-text-secondary text-sm">+{filteredDishes.length - 60} más</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Sync log */}
      {data.syncLog.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-text-secondary cursor-pointer hover:text-text-primary">Ver log de sincronización</summary>
          <div className="mt-2 space-y-1">
            {data.syncLog.map((l, i) => (
              <div key={i} className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 ${l.status === 'ok' ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
                {l.status === 'ok' ? <Check size={12} /> : <X size={12} />}
                <span className="font-medium">{l.item}</span>
                <span>{l.count} {l.status === 'ok' ? 'registros' : '(error)'}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
