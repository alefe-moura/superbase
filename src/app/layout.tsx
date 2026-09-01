import type { Metadata, Viewport } from 'next'
import { Bricolage_Grotesque, Instrument_Sans, JetBrains_Mono } from 'next/font/google'
import { ToastProvider } from '@/components/ui/Toast'
import './globals.css'

/**
 * Três vozes, cada uma com um papel:
 *
 * Bricolage Grotesque, logo, menus, títulos e números grandes. É a fonte da
 * marca: tem personalidade nas terminações e fecha bem em corpos grandes.
 * Instrument Sans, texto corrido e rótulos de formulário, onde legibilidade
 * em corpo pequeno importa mais que caráter.
 * JetBrains Mono, todo dado. Foi desenhada para código: algarismos tabulares
 * e distinção clara entre 0/O e 1/l/I, o que importa ao ler um ref ou chave.
 */
const bricolage = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-bricolage',
  display: 'swap',
  weight: ['500', '600', '700', '800'],
})

const instrument = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-instrument',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
})

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono-jet',
  display: 'swap',
  weight: ['400', '500', '600'],
})

export const metadata: Metadata = {
  title: 'SuperBase Manager',
  description: 'Seus projetos Supabase, em um lugar só.',
  robots: { index: false, follow: false },
  applicationName: 'SuperBase Manager',
}

export const viewport: Viewport = {
  themeColor: '#070f0f',
  width: 'device-width',
  initialScale: 1,
}

/** Aplica o tema antes da primeira pintura, evitando o flash de tela clara. */
const THEME_BOOTSTRAP = `
(function () {
  try {
    document.documentElement.setAttribute('data-theme', localStorage.getItem('sbm-theme') || 'dark');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      data-theme="dark"
      className={`${bricolage.variable} ${instrument.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="grain aurora">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  )
}
