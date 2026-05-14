import React from 'react'

// Button
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
}
export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-md transition-base disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-accent text-text-on-accent hover:bg-accent-hover',
    outline: 'border border-border-default text-text-primary hover:bg-page',
    ghost: 'text-text-secondary hover:bg-accent-bg',
    danger: 'bg-danger text-text-on-accent hover:opacity-90',
  }
  const sizes = { sm: 'text-xs px-3 py-1.5', md: 'text-sm px-4 py-2', lg: 'text-base px-5 py-2.5' }
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  )
}

// Input
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}
export function Input({ className = '', ...props }: InputProps) {
  return (
    <input
      className={`w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent ${className}`}
      {...props}
    />
  )
}

// Select
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {}
export function Select({ className = '', children, ...props }: SelectProps) {
  return (
    <select
      className={`w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent ${className}`}
      {...props}
    >
      {children}
    </select>
  )
}

// Textarea
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {}
export function Textarea({ className = '', ...props }: TextareaProps) {
  return (
    <textarea
      className={`w-full border border-border-default rounded-md px-3 py-2 text-sm bg-card text-text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-none ${className}`}
      {...props}
    />
  )
}

// Badge
interface BadgeProps { children: React.ReactNode; color?: string; className?: string }
export function Badge({ children, color = 'gray', className = '' }: BadgeProps) {
  const colors: Record<string, string> = {
    gray: 'bg-accent-bg text-text-primary',
    green: 'bg-success-bg text-success',
    red: 'bg-danger-bg text-danger',
    yellow: 'bg-warning-bg text-warning',
    blue: 'bg-accent-bg text-accent',
    violet: 'bg-accent-bg text-accent',
  }
  return (
    <span className={`px-2 py-0.5 rounded-sm text-xs font-medium ${colors[color] || colors.gray} ${className}`}>
      {children}
    </span>
  )
}

// Card
interface CardProps { children: React.ReactNode; className?: string; onClick?: () => void }
export function Card({ children, className = '', onClick }: CardProps) {
  return (
    <div
      className={`bg-card border border-border-default rounded-lg ${onClick ? 'cursor-pointer hover:shadow-md transition-base' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

// Tabs
interface TabsProps { value: string; onChange: (v: string) => void; tabs: { value: string; label: string }[]; className?: string }
export function Tabs({ value, onChange, tabs, className = '' }: TabsProps) {
  return (
    <div className={`flex gap-1 bg-accent-bg p-1 rounded-lg ${className}`}>
      {tabs.map(t => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-base ${
            value === t.value ? 'bg-card text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

// Modal
interface ModalProps { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }
export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  if (!open) return null
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className={`relative bg-card rounded-xl shadow-lg w-full ${sizes[size]} max-h-[90vh] flex flex-col`}>
        {title && (
          <div className="flex items-center justify-between p-5 border-b border-border-default">
            <h2 className="font-display text-xl text-text-primary">{title}</h2>
            <button onClick={onClose} className="p-1 rounded-md hover:bg-page text-text-secondary">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        )}
        <div className="overflow-y-auto flex-1 p-5">{children}</div>
      </div>
    </div>
  )
}

// Label
export function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <label className={`text-xs font-medium text-text-secondary uppercase tracking-wide ${className}`}>{children}</label>
}

// Alert
interface AlertProps { type?: 'info' | 'success' | 'warning' | 'error'; children: React.ReactNode; className?: string }
export function Alert({ type = 'info', children, className = '' }: AlertProps) {
  const styles = {
    info: 'bg-accent-bg border-accent/20 text-accent',
    success: 'bg-success-bg border-success/20 text-success',
    warning: 'bg-warning-bg border-warning/20 text-warning',
    error: 'bg-danger-bg border-danger/20 text-danger',
  }
  return (
    <div className={`p-3 rounded-md border text-sm ${styles[type]} ${className}`}>
      {children}
    </div>
  )
}
