'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'

/**
 * O logograma. Ganha um brilho mint por trás, a marca é um raio, e o halo
 * faz ela parecer energizada em vez de colada na tela.
 */
export function Logomark({
  size = 28,
  glow = true,
  className,
}: {
  size?: number
  glow?: boolean
  className?: string
}) {
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      {glow && (
        <span
          className="pointer-events-none absolute inset-0 rounded-full opacity-60 blur-lg"
          style={{ background: 'var(--signal)' }}
          aria-hidden
        />
      )}
      <Image
        src="/brand/logograma.png"
        alt="SuperBase"
        width={size}
        height={size}
        priority
        className="relative"
        style={{ width: size, height: size }}
      />
    </span>
  )
}

/** Logo horizontal completa (marca + tipografia branca). Só sobre fundo escuro. */
export function LogoHorizontal({ height = 26, className }: { height?: number; className?: string }) {
  // Proporção do arquivo original: 1958 × 512
  const width = Math.round((height * 1958) / 512)

  return (
    <Image
      src="/brand/logo-horizontal.png"
      alt="SuperBase Manager"
      width={width}
      height={height}
      priority
      className={className}
      style={{ height, width: 'auto' }}
    />
  )
}

/**
 * Marca em texto, para o tema claro, onde o wordmark branco do arquivo
 * desapareceria. Mesma tipografia da identidade.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'font-display text-[15px] font-bold leading-none tracking-[-0.035em] text-[var(--ink)]',
        className,
      )}
    >
      SuperBase
    </span>
  )
}
