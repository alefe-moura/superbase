#!/usr/bin/env node
/**
 * Procura segredo escrito onde não devia.
 *
 *   npm run leaks            arquivos versionados + o que está para ser commitado
 *   npm run leaks -- --full  o mesmo, mais TODO o histórico do git
 *
 * Este projeto é público. Um segredo que entra num commit não sai mais:
 * apagar depois não adianta, porque o commit antigo continua lá e já foi
 * clonado por quem quer que tenha clonado. A hora de pegar é antes.
 *
 * A varredura é só dos arquivos VERSIONADOS. O `.env.local` fica de fora de
 * propósito: ele é ignorado pelo git, é onde os segredos devem morar, e
 * acusá-lo geraria um alarme por execução até ninguém mais ler o alarme.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const FULL = process.argv.includes('--full')

/* ── O que procurar ──────────────────────────────────────────────────── */

/**
 * Cada regra traz o porquê, porque um achado sem explicação vira ruído que
 * alguém silencia sem ler.
 */
const REGRAS = [
  {
    nome: 'JWT (anon key ou service_role key)',
    // Um JWT de verdade tem as três partes. O corpo curto do placeholder
    // "eyJhbGciOi…" não chega perto, então ele não dispara.
    re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}/g,
    porque: 'Chave do Supabase. A service_role ignora RLS e lê o banco inteiro.',
  },
  {
    nome: 'Personal Access Token da Supabase',
    re: /\bsbp_[a-f0-9]{40,}/g,
    porque: 'PAT da conta. Alcança TODOS os projetos dela, não só um.',
  },
  {
    nome: 'Secret key da Supabase',
    re: /\bsb_secret_[A-Za-z0-9_-]{20,}/g,
    porque: 'Sucessora da service_role key. Mesmo alcance.',
  },
  {
    nome: 'Token de agente do SuperBase',
    re: /\bsbm_[A-Za-z0-9_-]{40,}/g,
    porque: 'Token de MCP. Abre a carteira inteira conforme a permissão dele.',
  },
  {
    nome: 'URL de projeto Supabase real',
    // Ref de verdade tem 20 letras minúsculas. Os exemplos da documentação
    // (xxxx, abcdefghijklm) não têm esse formato.
    re: /https:\/\/(?![a-z]*x{4})[a-z]{20}\.supabase\.co/g,
    porque: 'Aponta para um projeto que existe, e diz de quem é o banco.',
  },
  {
    nome: 'Connection string do Postgres',
    // O trecho da senha não pode conter `${`, senão o que casa é o código que
    // MONTA a string a partir de variáveis, como em accounts/[id]/projects,
    // onde a senha só existe em memória. Segredo escrito de verdade é
    // literal, e literal não tem interpolação.
    re: /postgres(?:ql)?:\/\/[^\s:'"`$]+:[^\s@'"`${}]+@/g,
    porque: 'Usuário e senha do banco, em texto.',
  },
  {
    nome: 'Chave privada',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    porque: 'Chave privada nunca pertence a um repositório.',
  },
  {
    nome: 'Chave de 32 bytes em base64 (formato da APP_ENCRYPTION_KEY)',
    re: /APP_ENCRYPTION_KEY\s*[:=]\s*['"]?[A-Za-z0-9+/]{42,}={0,2}/g,
    porque: 'É a chave que abre o cofre. Com ela, o dump do banco deixa de ser inútil.',
  },
]

/**
 * Linhas que combinam com uma regra mas são legítimas.
 *
 * A lista é curta e explícita de propósito. Silenciar por caminho de arquivo
 * inteiro seria mais cômodo e criaria o ponto cego: bastaria um segredo cair
 * num arquivo silenciado para a varredura inteira virar teatro.
 */
const PERDOADOS = [
  /placeholder=/, // campos de formulário na interface
  /example\.com/,
  /xxxx+\.supabase\.co/,
  /SEU_TOKEN|SEU_APP|SEU_ID|seu-app|<REDACTED>/i,
]

/* ── Varredura ───────────────────────────────────────────────────────── */

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 })
}

const achados = []

function examinar(texto, origem) {
  const linhas = texto.split('\n')

  for (const regra of REGRAS) {
    for (let i = 0; i < linhas.length; i++) {
      const linha = linhas[i]
      if (PERDOADOS.some((p) => p.test(linha))) continue

      regra.re.lastIndex = 0
      const achou = regra.re.exec(linha)
      if (!achou) continue

      achados.push({
        origem,
        linha: i + 1,
        regra: regra.nome,
        porque: regra.porque,
        // Mostra o bastante para reconhecer, nunca o segredo inteiro: este
        // relatório pode acabar colado num chat ou num log de CI.
        trecho: `${achou[0].slice(0, 12)}…${achou[0].slice(-4)}`,
      })
    }
  }
}

/** Arquivos versionados, no estado em que estão no disco. */
function varrerArquivos() {
  const arquivos = git('ls-files', '-z').split('\0').filter(Boolean)
  let lidos = 0

  for (const arquivo of arquivos) {
    let conteudo
    try {
      conteudo = readFileSync(arquivo, 'utf8')
    } catch {
      continue // binário ou ilegível
    }

    if (conteudo.includes('\0')) continue

    examinar(conteudo, arquivo)
    lidos++
  }

  return lidos
}

/** Todo o histórico: é onde mora o segredo que alguém "já apagou". */
function varrerHistorico() {
  const commits = git('rev-list', '--all').split('\n').filter(Boolean)

  for (const commit of commits) {
    let diff
    try {
      diff = git('show', '--format=', '--unified=0', commit)
    } catch {
      continue
    }

    // Só as linhas ACRESCENTADAS: a remoção de um segredo aparece como linha
    // com "-", e contá-la faria o mesmo vazamento ser reportado duas vezes.
    const adicionadas = diff
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .join('\n')

    examinar(adicionadas, `commit ${commit.slice(0, 8)}`)
  }

  return commits.length
}

/* ── Relatório ───────────────────────────────────────────────────────── */

console.log('')
console.log('  Varredura de segredos')
console.log('  ─────────────────────')

const lidos = varrerArquivos()
console.log(`  ${lidos} arquivos versionados`)

if (FULL) {
  const commits = varrerHistorico()
  console.log(`  ${commits} commits no histórico`)
} else {
  console.log('  histórico não varrido (use --full)')
}

console.log('')

if (!achados.length) {
  console.log('  Nada encontrado.')
  console.log('')
  console.log('  Lembre que isto vê só o que o git rastreia. Continue mantendo')
  console.log('  os segredos no .env.local e nas variáveis da Vercel.')
  console.log('')
  process.exit(0)
}

console.log(`  ${achados.length} ACHADO(S). Resolva antes de publicar.`)
console.log('')

for (const a of achados) {
  console.log(`  ${a.origem}:${a.linha}`)
  console.log(`    ${a.regra}`)
  console.log(`    ${a.trecho}`)
  console.log(`    ${a.porque}`)
  console.log('')
}

console.log('  Se algum destes já foi commitado e enviado, considere o segredo')
console.log('  QUEIMADO. Rotacione na Supabase antes de qualquer outra coisa:')
console.log('  apagar o commit não desfaz quem já clonou.')
console.log('')

process.exit(1)
