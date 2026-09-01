# PRD, SuperBase Manager
### Painel unificado para gestão de múltiplos projetos Supabase

| | |
|---|---|
| **Autor** | Alefe (com orquestração Claude) |
| **Data** | 28/07/2026 |
| **Status** | v3, **implementado**. Ver §12 para o que foi entregue e o que mudou |
| **Codinome** | SuperBase Manager |

> **Código pronto.** Instalação e deploy: [MANUAL.md](MANUAL.md). Visão técnica: [README.md](README.md).
> As Fases 0 a 4 foram implementadas de uma vez; falta apenas a configuração com credenciais reais.

---

## 1. Contexto e Problema

Alefe gerencia uma carteira de clientes cujos projetos Supabase estão espalhados por **várias contas/logins diferentes**. Hoje, para consultar ou editar qualquer projeto, é preciso:

1. Lembrar em qual conta o projeto está;
2. Fazer login/logout no dashboard oficial da Supabase;
3. Navegar até o projeto e localizar chaves, tabelas, configurações.

Isso gera fricção, risco de erro (mexer no projeto errado) e nenhuma visão consolidada da carteira.

**Problema central:** não existe um lugar único, seguro e intuitivo para visualizar, ler, editar e administrar todos os projetos Supabase da carteira, independentemente da conta onde estão hospedados.

**Escala:** hoje são **8 projetos**, com previsão de crescer para **~12**. O design deve ser confortável nessa faixa (dashboard em grade única, sem paginação complexa) sem impedir crescimento maior.

## 2. Decisões Registradas

| # | Decisão | Detalhe |
|---|---|---|
| D1 | **Hospedagem: Vercel** | Deploy na conta Vercel do Alefe. ⚠️ **Ao finalizar o código: criar repositório GitHub e conectar à Vercel, o deploy será feito direto de lá.** |
| D2 | **Escala: 8 → ~12 projetos** | UI otimizada para dezenas, não centenas |
| D3 | **Sem agrupamento por conta** | A conta de origem aparece apenas como **tag com o e-mail** nas informações/segurança de cada projeto |
| D4 | **Monitoramento estilo "Project Overview"** | Saúde do banco, status, CPU, RAM e disco por projeto, viável e incluído (ver §3.2 e Módulo 6) |
| D5 | **Banco do sistema: projeto Supabase dedicado** | Consequência da Vercel (serverless, sem disco persistente). Um projeto Supabase próprio do Alefe guarda cofre, clientes e auditoria |

## 3. Solução Proposta

Um **sistema web privado (single-user)** com login próprio, que centraliza todos os projetos Supabase gerenciados. Ele atua como um "meta-dashboard": armazena credenciais de forma criptografada e usa as APIs oficiais da Supabase para operar sobre cada projeto.

### 3.1 Base técnica, operação

| Camada | Autenticação | O que permite |
|---|---|---|
| **Management API** (`api.supabase.com/v1`) | Personal Access Token (PAT) por conta | Listar organizações e projetos, obter chaves de API, executar SQL (`/projects/{ref}/database/query`), pausar/restaurar projetos, ler logs, gerenciar secrets e configurações |
| **APIs do projeto** (PostgREST, Auth Admin, Storage) | `service_role` key + URL do projeto | CRUD completo em tabelas, gestão de usuários do Auth, arquivos do Storage, chamadas a Edge Functions |

Com **1 PAT por conta**, descobrimos automaticamente todos os projetos daquela conta e obtemos as chaves; com as chaves, operamos dentro de cada projeto. Projetos também podem ser cadastrados manualmente (URL + chaves) sem PAT.

### 3.2 Base técnica, monitoramento (replica o "Project Overview")

Três fontes combinadas cobrem as informações da página de overview do dashboard oficial:

| Fonte | Endpoint | Fornece |
|---|---|---|
| **Health check** (Management API) | `GET /v1/projects/{ref}/health?services=db,auth,rest,storage,realtime` | Status de cada serviço do projeto (saudável / degradado / fora) |
| **Métricas Prometheus** (por projeto) | `GET https://{ref}.supabase.co/customer/v1/privileged/metrics` (Basic auth: `service_role` + chave) | **CPU, RAM, disco (uso e I/O)**, métricas do Postgres e do gateway |
| **SQL direto** (Management API) | `POST /v1/projects/{ref}/database/query` | Tamanho do banco (`pg_database_size`), conexões ativas (`pg_stat_activity`), tamanho por tabela, cache hit rate |
| **Metadados** (Management API) | `GET /v1/projects/{ref}` | Status geral (ACTIVE_HEALTHY, PAUSED, …), região, versão do Postgres |

**Estratégia na Vercel (serverless):** um **Vercel Cron** roda a cada N minutos (padrão: 10), coleta um snapshot de cada projeto e grava no banco do sistema. O dashboard lê os snapshots (rápido, sem tempestade de chamadas) e oferece "Atualizar agora" para coleta sob demanda. Os snapshots acumulados geram mini-gráficos de histórico (24h/7d), algo que nem o overview oficial mostra de forma consolidada.

> Nota de validação: o endpoint de métricas Prometheus será verificado nos planos reais dos 8 projetos durante o spike técnico da Fase 1 (ver §9). Caso algum plano não o exponha, o fallback é a combinação health + SQL + metadados, que cobre saúde, status e tamanho do banco.

## 4. Objetivos

1. **Visão unificada:** um dashboard com todos os projetos, com busca, filtros e associação a clientes.
2. **Conexão fácil:** módulo para conectar nova conta (via PAT) ou novo projeto avulso (via URL + chaves), a qualquer momento.
3. **Operação real:** ler e editar dados das tabelas, rodar SQL, ver usuários do Auth e configurações, sem sair do sistema.
4. **Monitoramento:** saúde, status e uso de recursos (CPU/RAM/disco) de cada projeto, com histórico.
5. **Segurança de cofre:** credenciais criptografadas em repouso; nada de chave exposta no navegador.
6. **Intuitividade:** UX limpa, em pt-BR, pensada para o fluxo real de atendimento a clientes.

### Não-objetivos (v1)

- Multiusuário / equipe (é single-user; a arquitetura não deve impedir no futuro).
- Substituir 100% o dashboard oficial (migrations visuais, billing, criação de projetos do zero ficam fora do MVP).
- App mobile nativo (o web será responsivo).
- Self-hosted Supabase (foco em projetos na nuvem supabase.com).
- Alertas proativos (e-mail/push quando CPU alta etc.), candidato à Fase 4.

## 5. Persona

**Alefe, dev/agência gerenciando carteira de clientes.**
Tem acesso legítimo a todas as contas (logins, PATs, chaves). Precisa de agilidade para dar suporte: "o cliente X reportou um problema → abro o projeto dele em 5 segundos, olho a saúde e a tabela, corrijo o dado, pronto."

## 6. Funcionalidades por Módulo

### Módulo 0, Autenticação do sistema (o "login meu")
- Login único com e-mail + senha forte, protegido por rate-limit.
- **Senha-mestra deriva a chave de criptografia** do cofre de credenciais (Argon2id → AES-256-GCM). Sem a senha, o banco do sistema não revela nenhum segredo.
- 2FA (TOTP) opcional, recomendado desde o MVP.
- Sessão via cookie httpOnly, expiração configurável.

### Módulo 1, Cofre de conexões (conectar novo projeto) ⭐ núcleo do pedido
Duas formas de adicionar, disponíveis a qualquer momento:

**A) Conectar conta (recomendado)**
- Formulário: e-mail do login da conta (vira a tag do projeto), PAT, apelido opcional.
- O sistema valida o PAT, lista os projetos da conta e permite importar todos ou selecionar quais.
- Chaves (anon / service_role) e connection strings são buscadas automaticamente via Management API.
- Botão "Ressincronizar" para detectar projetos novos/removidos na conta.

**B) Conectar projeto avulso (manual)**
- Formulário com campos obrigatórios: nome do projeto, URL (`https://xxxx.supabase.co`), anon key, service_role key; opcionais: e-mail da conta (tag), connection string do Postgres, cliente associado, notas.
- Validação ativa no submit: o sistema faz uma chamada de teste e só salva se as credenciais funcionarem.

**Gestão do cofre**
- Editar/rotacionar credenciais; revelar chave sob demanda (com clique explícito + auditoria).
- Excluir conexão (soft-delete com confirmação).
- Toda credencial criptografada em repouso; descriptografia só no backend, por requisição.

### Módulo 2, Dashboard da carteira
- Grade única com os ~8 a 12 projetos em cards: nome, cliente, status, **badge de saúde** (verde/amarelo/vermelho, do último snapshot), região e mini-indicadores de CPU/RAM/disco.
- Busca global e filtros (por cliente, status, saúde).
- Agrupamento opcional por **cliente** (entidade própria do sistema: um cliente pode ter N projetos).
- A conta de origem **não agrupa nada**: aparece só como tag de e-mail no card/detalhe (decisão D3).

### Módulo 3, Detalhe do projeto
Página "hub" de cada projeto, com abas:

1. **Visão geral (≈ Project Overview):** status e saúde por serviço, gauges de **CPU, RAM e disco**, tamanho do banco, conexões ativas, mini-gráficos de histórico (24h/7d), metadados (região, versão do Postgres), **tag com o e-mail da conta**, chaves (ocultas por padrão, copiar com 1 clique) e link direto para o dashboard oficial.
2. **Tabelas (ler e editar):** navegador de schemas/tabelas via PostgREST, visualizar linhas com paginação/ordenação/filtro, **editar células, inserir e excluir linhas** (com confirmação em ações destrutivas).
3. **SQL Runner:** editor para executar SQL arbitrário via Management API, com histórico de queries e aviso destacado em comandos de escrita/DDL.
4. **Auth:** listar usuários do projeto, criar/convidar, resetar senha, banir/excluir.
5. **Storage:** listar buckets e arquivos, upload/download/exclusão (fase 3).
6. **Logs:** logs recentes da API e do Postgres via Management API (fase 3).
7. **Configurações do projeto:** pausar/restaurar, secrets de Edge Functions (fase 4).

### Módulo 4, Clientes (CRM leve)
- CRUD de clientes: nome, contato, notas.
- Associação cliente ↔ projetos (o mesmo cliente pode ter projetos em contas diferentes).
- Visão "por cliente": todos os projetos daquele cliente em uma tela.

### Módulo 5, Auditoria
- Log interno de toda ação sensível: credencial revelada, linha editada, SQL executado, usuário de Auth alterado.
- Tela de histórico com filtro por projeto/ação/data. Essencial para operar com segurança sobre dados de clientes.

### Módulo 6, Monitoramento (novo)
- **Coletor:** três gatilhos: ao abrir a tela Saúde geral com dados vencidos (>30 min), uma vez por dia pelo Vercel Cron (o plano Hobby só aceita disparo diário) e sob demanda pelo botão. Cada coleta grava um snapshot por projeto: saúde dos serviços, CPU, RAM, disco, tamanho do banco, conexões. Retenção de 30 dias.
- **Visão carteira:** tela "Saúde geral" com todos os projetos lado a lado, identificar de relance quem está degradado ou crescendo demais.
- **Visão projeto:** aba "Visão geral" do Módulo 3 consome os mesmos snapshots.
- **"Atualizar agora":** coleta sob demanda de um projeto específico.
- Tolerância a falha: projeto inacessível marca snapshot como "sem resposta" (vira saúde vermelha) sem quebrar a coleta dos demais.

## 7. Requisitos Não-Funcionais

| Categoria | Requisito |
|---|---|
| **Segurança** | Criptografia AES-256-GCM em repouso para todo segredo; chave derivada da senha-mestra (Argon2id); segredos nunca chegam ao cliente sem ação explícita; todas as chamadas à Supabase saem do backend (proxy), nunca do navegador |
| **Segurança** | HTTPS obrigatório; cookies httpOnly/secure/SameSite; rate-limit no login; sem segredos em logs; endpoint do cron protegido por secret (`CRON_SECRET`) |
| **Desempenho** | Dashboard carrega < 2s lendo snapshots do banco do sistema (nunca consulta os 12 projetos ao vivo no load) |
| **Confiabilidade** | Falha de um projeto/conta não derruba o dashboard nem a coleta (isolamento de erros por conexão) |
| **UX** | Interface em pt-BR, responsiva, dark mode, ações destrutivas sempre com confirmação |
| **Portabilidade** | Exportação do cofre (backup criptografado) e dos dados do sistema |

## 8. Arquitetura e Stack

```
Navegador (só UI, zero segredos)
   │  HTTPS + sessão
   ▼
Vercel, Next.js (App Router): frontend + Route Handlers (backend)
   ├─ Vercel Cron ──► /api/cron/snapshot (protegido por CRON_SECRET)
   ├─ Banco do sistema: projeto Supabase DEDICADO (do Alefe)
   │    → clientes, conexões (criptografadas), auditoria, snapshots, preferências
   ├─ Camada "SupabaseGateway":
   │    ├─ Management API (PAT)      → descoberta, SQL, health, logs, configs
   │    ├─ PostgREST/Auth Admin      → dados, usuários, storage (service_role)
   │    └─ Metrics (Prometheus)      → CPU / RAM / disco por projeto
   └─ Cofre: crypto nativo Node (AES-256-GCM + Argon2id)
```

- **Frontend:** Next.js 15 + TypeScript + Tailwind + shadcn/ui; TanStack Table (editor de dados); Recharts ou similar (mini-gráficos de monitoramento).
- **Backend:** Route Handlers do próprio Next.js, um único deploy na Vercel. Toda credencial vive só no servidor.
- **Banco do sistema:** projeto Supabase dedicado (decisão D5), acessado só pelo backend com a service key do próprio sistema.
- **Deploy:** Vercel, via repositório GitHub (decisão D1, conectar ao finalizar).

### Modelo de dados do sistema

```
users         (id, email, password_hash, totp_secret?, kdf_salt)
clients       (id, name, contact, notes)
accounts      (id, login_email, alias?, pat_encrypted, status, last_sync_at)
projects      (id, account_id?, client_id?, ref, name, url,
               account_email,            -- a "tag" de conta (D3)
               anon_key_enc, service_key_enc, db_url_enc?,
               source: 'sync'|'manual', status, region, notes)
snapshots     (id, project_id, collected_at, health_json,
               cpu_pct, ram_pct, disk_pct, db_size_bytes,
               active_connections, ok: bool)
audit_logs    (id, project_id?, action, detail, created_at)
query_history (id, project_id, sql, executed_at, rows_affected?)
```

## 9. Plano de Implementação (enriquecido)

### Fase 0, Setup e spike técnico *(fundação de tudo)*
| # | Tarefa | Resultado esperado |
|---|---|---|
| 0.1 | Criar projeto Next.js 15 + TS + Tailwind + shadcn/ui, estrutura de pastas | Repositório local rodando |
| 0.2 | Criar o projeto Supabase dedicado do sistema + migrations do modelo de dados | Banco do sistema pronto |
| 0.3 | **Spike Management API:** com 1 PAT real, listar projetos, buscar chaves, rodar 1 SQL | Confirmação prática das rotas |
| 0.4 | **Spike métricas:** chamar `/customer/v1/privileged/metrics` e o health endpoint em 1 projeto real de cada plano da carteira | Confirmar CPU/RAM/disco disponíveis; definir fallback se necessário |
| 0.5 | Implementar e testar o módulo de criptografia (Argon2id + AES-256-GCM) isoladamente | Cofre testado com testes unitários |

**Gate de saída:** os dois spikes funcionando contra projetos reais.

### Fase 1, Fundação utilizável
| # | Tarefa |
|---|---|
| 1.1 | Login (e-mail + senha-mestra), sessão httpOnly, rate-limit |
| 1.2 | Cofre: conectar conta via PAT → importar projetos (todos/seleção) com chaves automáticas |
| 1.3 | Cofre: conectar projeto avulso (formulário manual + validação ativa) |
| 1.4 | Dashboard da carteira: cards com nome, cliente, status, tag de e-mail da conta |
| 1.5 | CRUD de clientes + associação a projetos |
| 1.6 | Auditoria básica (registrar conexões criadas, chaves reveladas) |

**Gate de saída:** os 8 projetos reais conectados e visíveis no dashboard.

### Fase 2, Operação (valor principal)
| # | Tarefa |
|---|---|
| 2.1 | Detalhe do projeto, aba Visão geral (metadados, chaves, tag da conta, links) |
| 2.2 | Navegador de tabelas: listar schemas/tabelas, ver linhas (paginação, ordenação, filtros) |
| 2.3 | Edição de dados: editar célula, inserir linha, excluir linha (confirmações destrutivas) |
| 2.4 | SQL Runner com histórico e aviso para escrita/DDL |
| 2.5 | Aba Auth: listar/criar/resetar/banir usuários |
| 2.6 | Auditoria completa (toda escrita registrada) |

**Gate de saída:** critério do MVP, do login à edição de uma linha de qualquer projeto em < 30s.

### Fase 3, Monitoramento + conforto
| # | Tarefa |
|---|---|
| 3.1 | Coletor de snapshots (Vercel Cron + endpoint protegido) com isolamento de falhas |
| 3.2 | Aba Visão geral vira "Project Overview": saúde por serviço, gauges CPU/RAM/disco, tamanho do banco, conexões, histórico 24h/7d |
| 3.3 | Badges de saúde + mini-indicadores nos cards do dashboard; tela "Saúde geral" da carteira |
| 3.4 | "Atualizar agora" (coleta sob demanda) + retenção/limpeza de snapshots (30 dias) |
| 3.5 | Ressincronização de contas (detectar projetos novos/removidos) |
| 3.6 | Storage (buckets/arquivos) e aba Logs |
| 3.7 | 2FA (TOTP) e dark mode refinado |

### Fase 4, Extras e entrega final
| # | Tarefa |
|---|---|
| 4.1 | Pausar/restaurar projetos; secrets de Edge Functions |
| 4.2 | Exportação/backup criptografado do cofre |
| 4.3 | Alertas simples (projeto fora do ar, disco > X%), sob demanda |
| 4.4 | **Criar repositório GitHub, conectar à Vercel e configurar env vars/cron em produção (decisão D1)** |
| 4.5 | Hardening final: revisão de segurança, headers, teste dos fluxos com dados reais |

## 10. Riscos e Mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| Vazamento de service_role keys | Crítico (acesso total aos bancos dos clientes) | Criptografia em repouso, backend-only, auditoria, 2FA, env vars só na Vercel |
| Endpoint de métricas indisponível em algum plano | Médio (perde CPU/RAM/disco daquele projeto) | Spike 0.4 valida cedo; fallback = health + SQL + status (cobre saúde e tamanho do banco) |
| Mudanças na Management API da Supabase | Médio | Isolar chamadas na camada `SupabaseGateway`; testes de contrato |
| Rate limits da Management API | Baixo/Médio | Snapshots via cron (não tempo real), cache de metadados, coleta espaçada |
| Limites do plano Vercel (duração de função, cron) | Médio | Coleta em lotes rápidos por projeto; com 12 projetos o snapshot completo fica em segundos |
| Edição errada em produção de cliente | Alto | Confirmações destrutivas, badge claro de projeto/cliente aberto, auditoria |
| Perda da senha-mestra | Alto (cofre irrecuperável) | Backup criptografado do cofre + aviso explícito no onboarding |

## 11. Questões em Aberto (restantes)

1. Todos os 8 projetos atuais estão em supabase.com (nenhum self-hosted)? *(assumido que sim)*
2. O editor de tabelas precisa suportar tipos complexos já na F2 (JSON, arrays, FKs com lookup) ou básico primeiro?
3. Intervalo do cron de monitoramento: 10 min está bom, ou prefere mais/menos frequente? *(afeta consumo de recursos, é ajustável)*

## 12. Status de Implementação (v3, 28/07/2026)

Todas as fases do §9 foram implementadas. O que segue registra o que existe no código e onde a implementação divergiu do plano.

### Entregue

| Módulo | Situação | Onde está |
|---|---|---|
| 0, Autenticação | Login, sessão httpOnly assinada, rate limit, TOTP implementado | `src/app/login/`, `src/lib/session.ts`, `src/lib/crypto.ts` |
| 1, Cofre de conexões | Conta via PAT com preview/seleção, projeto manual com validação ativa, ressincronização, revelar/rotacionar chaves | `src/app/(app)/conexoes/`, `src/app/api/accounts/` |
| 2, Dashboard da carteira | Cards e tabela, busca, filtros por cliente e saúde, agrupamento opcional, tag de e-mail da conta | `src/app/(app)/page.tsx`, `PortfolioGrid.tsx` |
| 3, Detalhe do projeto | 5 abas: Visão geral, Tabelas, SQL Runner, Auth, Storage | `src/app/(app)/projetos/[id]/` |
| 4, Clientes | CRUD, vínculo com projetos, visão de projetos órfãos | `src/app/(app)/clientes/` |
| 5, Auditoria | Registro de toda ação sensível, tela com busca e filtros, destaque para destrutivas | `src/lib/audit.ts`, `src/app/(app)/auditoria/` |
| 6, Monitoramento | Coletor com as 3 fontes, Vercel Cron, snapshots, histórico 24h/7d, tela de saúde geral, coleta sob demanda | `src/lib/gateway/collector.ts`, `src/app/(app)/saude/` |

### Divergências em relação ao plano

**1. Chave do cofre em variável de ambiente, não derivada da senha (§6, Módulo 0).**
O plano previa derivar a chave de criptografia da senha-mestra via Argon2id. A implementação usa `APP_ENCRYPTION_KEY` numa env var, com AES-256-GCM.

*Motivo:* a Vercel é serverless e stateless. Derivar da senha exigiria manter o material de chave no cookie de sessão a cada requisição, o que aumenta a exposição em vez de reduzir. A propriedade de segurança que motivava a decisão original (dump do banco ≠ credenciais vazadas) fica preservada, porque a chave vive apenas nas env vars.

*Consequência prática:* a `APP_ENCRYPTION_KEY` precisa de backup próprio. Está sinalizado no `genkey`, no `.env.example` e no SETUP.

**2. scrypt no lugar de Argon2id.**
Ambos são KDFs adequados para senha. O scrypt é nativo do Node, o que mantém o projeto sem dependências nativas, relevante para builds previsíveis na Vercel.

**3. Descoberta de tabelas via OpenAPI, não via SQL.**
O plano assumia SQL para mapear o schema, o que exigiria PAT. A implementação lê o spec OpenAPI que o PostgREST publica em `/rest/v1/`, o que faz a aba Tabelas funcionar também em projetos cadastrados manualmente, uma capacidade a mais do que o previsto.

**4. Storage sem upload nesta entrega.**
Listagem, navegação por pastas, download por link assinado e exclusão estão prontos. O upload ficou de fora por depender de streaming multipart, que merece ser validado com arquivos reais.

**5. Pausar/restaurar projeto (F4.1) não exposto na UI.**
As funções existem no gateway (`pauseProject`, `restoreProject`), mas não há botão. É uma ação de alto impacto no cliente e ficou aguardando decisão sobre onde colocá-la com segurança.

### Verificação realizada

- `npm run build`, build de produção limpo, 25 rotas.
- `npm run typecheck`, sem erros.
- `npm run selftest`, 23 testes passando: cofre (ida e volta, adulteração rejeitada, chave errada rejeitada), senha (scrypt), TOTP (vetores oficiais da RFC 4226), parser Prometheus (escolha do filesystem, CPU por delta, contador reiniciado) e detecção de comandos de escrita.
- Smoke test HTTP sem configuração: `/login` responde 200 com aviso de sistema não configurado, área autenticada redireciona (307), APIs devolvem 503, cron devolve 401 sem o secret.

### Pendências (dependem de dados reais)

1. Criar o projeto Supabase do sistema e rodar a migration.
2. Preencher as variáveis de ambiente e criar o usuário de login.
3. Conectar as contas e importar os 8 projetos.
4. **Validar o endpoint de métricas nos planos reais da carteira**: o spike 0.4 do plano original. É a única incerteza técnica que sobrou; o fallback já está implementado e degrada com elegância se algum plano não expuser o endpoint.
5. Criar o repositório no GitHub e conectar à Vercel (decisão D1).
