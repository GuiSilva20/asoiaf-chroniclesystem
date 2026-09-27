# CLAUDE.md — Diretrizes do projeto

Leia este arquivo como primeira ação em qualquer tarefa. Atualize-o ao final
de toda mudança relevante na arquitetura, decisões de stack ou convenções.
Se este arquivo não existir ainda, crie-o antes de prosseguir e pergunte ao
usuário sobre as convenções que faltam em vez de assumi-las.

## 1. Prioridade entre princípios

Quando dois princípios colidirem, siga esta ordem:

1. Segurança (OWASP) — nunca é sacrificada por simplicidade ou prazo.
2. KISS — prefira a solução mais simples que resolve o problema.
3. SOLID — aplique só quando o ganho de manutenibilidade for real; não
   force abstração para um caso de uso único.
4. Clean code — nomes claros, funções pequenas, baixo acoplamento.

Use o contexto do próprio código como base. Extrapole padrões novos apenas
quando o código existente não oferecer um exemplo aplicável.

## 2. Comunicação com o usuário

- Quando o escopo estiver vago, a observação não estiver coberta pelo pedido,
  ou uma adição parecer relevante, pergunte antes de assumir.
- Ao propor código vindo da solicitação do usuário, não confie cegamente:
  valide viabilidade, segurança e confiabilidade antes de finalizar o plano.
  Se encontrar um problema, explique o risco e sugira alternativa.
- Substitua emojis por ícones do pacote já instalado no projeto (ex: Tabler,
  Lucide — verifique qual está disponível antes de usar).

## 3. Testes

- Use specs/ com o framework de teste já configurado no projeto (verifique
  package.json / config antes de assumir Jest — pode ser Vitest, Pytest etc.)
  como base para critérios de aceite.
- Se não existir spec para a funcionalidade, planeje a criação da spec junto
  com a implementação, não depois.

## 4. Orquestração de modelos e agentes

- Use o modelo mais leve disponível (ex: Sonnet) para exploração, leitura de
  código e tarefas de baixa complexidade.
- Reserve o modelo mais robusto (ex: Opus) para planejamento extenso ou
  tarefas de alta complexidade/risco.
- Delegue a agentes quando a tarefa envolver múltiplas frentes paralelas.
- Otimize tokens ativamente: prefira grep/busca direcionada a ler arquivos
  inteiros, resuma contexto já explorado antes de repassá-lo, e evite reler
  arquivos sem necessidade.

## 5. Arquitetura de dados

- Aplique SSoT (Single Source of Truth) sempre que o escopo permitir:
  - Preferencialmente backend first, com payloads read-only no frontend.
  - Onde não for viável, use SSoT's locais centralizados (um único módulo/
    store responsável pelo dado, nunca duplicado).

## 6. Estilo de código

- Python: siga o Zen do Python quando o projeto for majoritariamente Python.
  Não force PEP 20 em stacks de outra linguagem.
- Comentários: antes de adicionar um comentário, pergunte-se — "isso é
  relevante para quem ler a codebase depois, ou é só uma observação pontual
  desta tarefa?" Se for pontual, descarte.

### 6.1. TypeScript

Quando o projeto utilizar TypeScript, trate o sistema de tipos como parte da
arquitetura — não apenas como documentação.

- `any` é proibido por padrão. Não utilize `any` para contornar erros de
  tipagem ou acelerar implementação.
- Quando o tipo for genuinamente desconhecido, prefira `unknown` e faça o
  narrowing/validação necessário antes do uso.
- Evite type assertions (`as`) quando uma inferência, type guard ou
  validação puder resolver o problema. Nunca use casts apenas para silenciar
  o compilador.
- Não use `@ts-ignore` ou `@ts-nocheck`. Se houver uma exceção inevitável,
  explique o motivo e prefira `@ts-expect-error` com justificativa.
- Evite duplicar definições de tipos para representar o mesmo domínio.
  Defina uma fonte canônica e derive os demais tipos quando possível.

### Modelos e domínio

- Crie models/types para entidades e conceitos relevantes do domínio.
- Não crie interfaces ou abstrações apenas por antecipação ("talvez
  precisemos disso depois"). Tipos devem representar necessidades reais do
  domínio, contratos ou fronteiras da aplicação.
- Diferencie claramente, quando aplicável:
  - Domain Model — representação das regras e conceitos do domínio.
  - DTO — contrato de entrada/saída entre fronteiras.
  - Persistence Model — representação específica do banco/ORM.
  - View/UI Model — representação necessária exclusivamente pela interface.
- Não reutilize automaticamente o model do banco como contrato público da
  API ou como estado da UI. Faça isso apenas quando as responsabilidades
  forem realmente idênticas.

### Schemas e validação

- TypeScript não valida dados em runtime. Todo dado que atravesse uma
  fronteira não confiável deve ser validado em runtime.
- Considere fronteiras externas:
  - requests HTTP;
  - query params e route params;
  - webhooks;
  - variáveis de ambiente;
  - respostas de APIs externas;
  - dados persistidos quando sua integridade não puder ser garantida.
- Use o mecanismo de schema/validação já adotado pelo projeto (ex: Zod,
  Valibot, Yup, class-validator). Não introduza uma nova biblioteca sem
  necessidade.
- Quando possível, derive tipos TypeScript dos schemas para evitar
  divergência entre validação runtime e tipagem estática.
- Schemas devem ser a fonte de verdade para contratos que exigem validação
  runtime.

### Inferência e simplicidade

- Prefira inferência quando o tipo for óbvio pelo contexto.
- Declare tipos explicitamente em APIs públicas, contratos, retornos
  complexos e pontos onde isso melhora a legibilidade.
- Não crie tipos excessivamente genéricos ou condicionais quando uma
  estrutura simples e explícita resolver o problema.
- Tipagem deve aumentar segurança e compreensão — não transformar código
  simples em metaprogramação.

## 7. Design / UI / UX

- Qualquer tarefa que envolva design, UI, UX ou alteração visual deve
  consultar a skill de design correspondente antes de implementar. Não pule
  essa etapa mesmo em ajustes aparentemente pequenos.

## 8. Fluxo Git

### Antes de começar qualquer tarefa

1. Verifique se a branch atual está atualizada em relação a dev.
2. Se a task exigir nova branch, confirme que existe um ID de task
   (padrão: HMAXX-5555). Sem ID, recuse o serviço e peça o ID ao
   usuário — não prossiga de forma alguma.

### Branches

- Padrão: type/compact-name_TASKID
  (ex: fix/render-bug_MAX-5555)
- Nomes compactos, sem descrições longas.

### Commits e Pull Requests

- Formato: type(target): descrição curta
  (ex: fix(engine): corrigido bug de renderização no form)
- Título sempre compacto; detalhes específicos vão na descrição do commit/PR,
  não no título.
- Todo commit/PR é escrito em pt-br.
- Nunca inclua co-author ou menções como "Generated with Claude" em
  commits ou PRs — isso é proibido.

## 9. Manutenção deste arquivo

Ao final de qualquer mudança que afete:
- decisões arquiteturais,
- convenções de código,
- estrutura de pastas,
- ou stack/ferramentas usadas,

atualize este CLAUDE.md na mesma tarefa, não depois.

## 10. CSS, SCSS, Bootstrap e Tailwind

Antes de criar ou alterar estilos, identifique qual abordagem de estilização já é utilizada no projeto. Não introduza uma nova solução de CSS apenas por preferência pessoal.

### Regra geral

* Respeite a estratégia de estilização existente no projeto.
* Não misture Tailwind, Bootstrap, CSS Modules, SCSS ou styled-components arbitrariamente.
* Antes de criar estilos globais, verifique se o componente pode ser estilizado localmente.
* Evite duplicação de regras visuais. Se um padrão já existir, reutilize-o.
* Não use `!important`, exceto quando necessário para sobrescrever comportamento de bibliotecas externas e não houver alternativa arquitetural adequada.
* Evite valores mágicos repetidos para cores, espaçamentos, breakpoints, sombras ou tamanhos. Utilize tokens, variáveis ou a configuração do framework quando disponíveis.
* Prefira classes semânticas e reutilizáveis a seletores excessivamente dependentes da estrutura HTML.
* Não estilize elementos com base em tags (`div div div`, `button > span`, etc.) quando uma classe ou componente específico puder representar a intenção.
* Evite especificidade excessiva. Não crie CSS que exija uma cadeia maior de seletores para ser sobrescrito.

### Responsividade

* Toda alteração visual deve considerar os breakpoints e comportamentos responsivos já definidos pelo projeto.
* Não crie breakpoints arbitrários quando o projeto já possuir uma escala definida.
* Prefira uma abordagem consistente com o projeto (`mobile-first`, `desktop-first` etc.).
* Não use dimensões fixas quando o layout exigir adaptação ao conteúdo ou à viewport.
* Teste comportamentos em telas pequenas e grandes quando a alteração afetar layout, navegação ou componentes estruturais.

### Acessibilidade visual

* Não remova `outline` ou indicadores de foco sem fornecer uma alternativa acessível.
* Estados de `hover` não devem ser a única forma de comunicar uma ação ou estado.
* Garanta contraste adequado entre texto e fundo.
* Estados `disabled`, `loading`, `error`, `focus` e `active` devem seguir os padrões visuais existentes.
* Não comunique informações exclusivamente por cor.

---

### SCSS / Sass

Quando o projeto utilizar SCSS:

* Use variáveis, mixins e funções apenas quando reduzirem repetição ou centralizarem regras relevantes.
* Não crie mixins para abstrações utilizadas apenas uma vez.
* Evite nesting profundo. Como regra, mantenha o aninhamento no menor nível possível.
* Não replique estruturas inteiras do HTML dentro do SCSS.
* Prefira organização por componente ou domínio em vez de grandes arquivos globais monolíticos.
* Use variáveis SCSS apenas para valores que pertençam ao sistema de estilos e não sejam melhor representados por CSS Custom Properties.
* Quando um valor precisar ser alterado dinamicamente em runtime, prefira CSS Custom Properties (`--variavel`) em vez de variáveis SCSS.
* Evite `@extend` quando ele produzir seletores difíceis de prever ou acoplamento entre componentes.
* Não use arquivos SCSS globais como depósito de correções pontuais.

Exemplo a evitar:

```scss
.page {
  .container {
    .content {
      .card {
        .title {
        }
      }
    }
  }
}
```

Prefira estilos com baixo acoplamento à estrutura:

```scss
.card {
}

.card__title {
}
```

---

### Tailwind CSS

Quando o projeto utilizar Tailwind:

* Use as utilities do Tailwind como abordagem principal de estilização.
* Não crie CSS customizado para algo que já possua uma utility clara e consistente no Tailwind.
* Não introduza valores arbitrários repetidamente (`w-[347px]`, `mt-[13px]`, etc.) quando o design puder utilizar a escala existente.
* Se um valor arbitrário precisar ser reutilizado, avalie adicioná-lo à configuração/tokens do projeto.
* Não extraia componentes apenas porque uma sequência de classes está longa. Extraia quando houver reutilização, responsabilidade própria ou ganho real de legibilidade.
* Para padrões visuais reutilizados em múltiplos componentes, prefira abstrações compatíveis com a arquitetura do projeto: componentes, variantes ou utilities centralizadas.
* Não use `@apply` como substituto indiscriminado para escrever CSS tradicional.
* Preserve a consistência da escala de espaçamento, tipografia, cores, radius e breakpoints configurada no projeto.
* Antes de adicionar novas cores, tamanhos ou tokens à configuração, verifique se já existe um equivalente.

Classes devem continuar legíveis. Quando a complexidade visual tornar o JSX difícil de manter, considere separar variantes ou criar um componente dedicado — não apenas mover todas as classes para outro lugar.

---

### Bootstrap

Quando o projeto utilizar Bootstrap:

* Utilize primeiro os componentes, utilities e tokens fornecidos pela versão já instalada.
* Não recrie manualmente componentes que o Bootstrap já fornece sem necessidade.
* Não misture versões diferentes do Bootstrap.
* Antes de sobrescrever estilos do Bootstrap, verifique se existe uma variável Sass, CSS Custom Property ou API oficial de customização adequada.
* Evite sobrescrever componentes globalmente quando a alteração for específica de uma única tela ou componente.
* Não altere diretamente arquivos da biblioteca.
* Utilize o sistema de grid e breakpoints do Bootstrap de forma consistente com o restante do projeto.
* Ao customizar componentes, preserve estados de acessibilidade e comportamento nativo fornecidos pela biblioteca.

---

### Convivência entre tecnologias

Se o projeto possuir mais de uma solução de estilização:

* Não escolha automaticamente a tecnologia preferida pelo agente.
* Identifique qual solução é responsável pelo módulo que está sendo alterado.
* Novos componentes devem seguir o padrão predominante da área correspondente.
* Não migre CSS/SCSS/Bootstrap para Tailwind, ou vice-versa, dentro de uma task não destinada explicitamente à migração.
* Migrações de sistema de estilos devem possuir escopo explícito, estratégia incremental e critérios de compatibilidade.

---

### Qualidade e manutenção

Antes de considerar uma alteração visual concluída, verifique:

* existência de estilos duplicados;
* responsividade;
* estados interativos;
* foco e acessibilidade;
* regressões em componentes compartilhados;
* uso consistente dos tokens e convenções existentes;
* ausência de `!important` desnecessário;
* ausência de valores mágicos repetidos;
* compatibilidade com o sistema de estilos já adotado pelo projeto.

Se uma mudança visual alterar componentes compartilhados, avalie o impacto em todas as telas consumidoras antes de finalizar.


## 11. Cyvasse (simulação entre personagens)

Estrutura e convenções do módulo `module/cyvasse/`:

- **Motor puro** (`module/cyvasse/*.js`): sem globais do Foundry, testável com Node. Todo número
  de regra ou de equilíbrio fica em `cyvasse-data.js` (SSoT); os demais módulos só leem dele.
  - `cyvasse-hex.js` geometria; `cyvasse-board.js` estado, posicionamento, jogadas e captura;
    `cyvasse-eval.js` avaliação e escada de jogadas; `cyvasse-tiers.js` rolagem → faixa → tier →
    jogada; `cyvasse-match.js` a partida (rolador injetado, RNG com semente);
    `cyvasse-record.js` validação em runtime e reprodução do registro.
- **Cola com o Foundry** (`module/cyvasse/foundry/`): perfil/rolador do personagem, cartas de
  chat, launcher (botão só para o Mestre no diretório de Atores) e visualizador ApplicationV2.
  A API pública é `ChronicleSystem.cyvasse.play(atorA, atorB, opções)`.
- **O Rei sempre começa na fileira de trás** (`KING_DEPLOY_ROW`), em qualquer posicionamento, até no aleatório: só ela
  fica fora do alcance de 6 casas de um Dragão na linha de frente inimiga. Há spec garantindo que nenhum Rei pode ser
  capturado no primeiro movimento, para quaisquer dois posicionamentos.
- **As regras das peças são fixas**, como as de um jogo de tabuleiro (ex.: Dragões capturam
  Dragões). Diferença de habilidade vem da IA/tiers, nunca de alterar regra de peça para "equilibrar".
- **Partida ao vivo e compartilhada** (`cyvasse-live.js` + `foundry/cyvasse-live-client.js`): o cliente do
  Mestre roda a partida e é a única fonte de verdade; os demais recebem `sync` de snapshots pelo socket
  do sistema (`system.chroniclesystem`, `"socket": true` no manifesto). O dono de um personagem envia
  ordens (Atacar / Recuar / Automático) na janela de ordens de cada rodada; o Mestre controla qualquer
  lado, pausa, encerra a espera, para a partida e muda o ritmo.
- **A partida nunca anda sozinha**: toda rodada ESPERA até os dois lados estarem decididos (pelo dono do
  personagem ou pelo Mestre, que sempre pode decidir). Só `autoPlay: true` (opção explícita, desligada por
  padrão) pula a espera. Não condicione a espera a haver jogador conectado: com só o Mestre na mesa a
  partida seguiria sozinha.
- **Ordens valem uma rodada só** e começam vazias (nenhuma selecionada, partida não pausada); podem ser
  dadas a qualquer momento, inclusive durante a rodada anterior. O timer (padrão 0 = sem timer) só define
  quando um lado sem ordem passa para decisão automática do personagem. O resultado dos testes de
  **toda** rodada vai para o chat, ao vivo (`reporter` do `LiveMatch`); não há filtro de destaques.
- **Mudou o `system.json`? Reinicie o MUNDO** (volte à configuração e inicie de novo): o servidor só lê o manifesto
  ao iniciar o mundo, então recarregar o navegador (F5) não ativa `"socket": true`, e sem isso ninguém além do Mestre
  recebe a partida. `socketIsOn()` (`game.system.socket`) detecta o caso e avisa o Mestre.
- **Modelo de confiança do socket**: toda mensagem passa por `parseMessage`/`parseSnapshot` (validação
  em runtime); só um usuário Mestre pode emitir `sync`/`open`; ordens só valem se o remetente for dono do
  personagem daquele lado (`LiveMatch#handle` confere `io.canControl`). Nunca confie no cliente.
- **Ambiente injetado**: `LiveMatch` recebe `io` (socket, timers, permissões) para ser testado sem Foundry.
- **Atacar e Recuar** mudam quanto vale a margem da rodada (`STANCE_MARGIN_SCALE`): Atacar dobra a vantagem e
  não piora a desvantagem; Recuar protege quem está perdendo e desperdiça parte da vantagem. Ordem explícita
  usa a coluna "medida" da tabela de tiers; só o modo automático infere ousadia pelo temperamento.
- **A ordem limita os movimentos** (`restrictByOrder`): Atacar não recua peça em jogada tranquila; Recuar não avança, salvo para
  capturar uma AMEAÇA (peça na própria zona ou que já poderia capturar algo nosso, ex.: um Dragão à vista). Tiros ficam sempre
  abertos. Se a ordem não deixar jogada, vale qualquer jogada legal. Capturas óbvias e lucrativas (`SELECTION.obviousGain`)
  são tomadas por todo tier, menos o Erro Crasso: deixar um Dragão passear livre não é estilo, é burrice.
- **Ações menores** (Blefar, Provocar, Intimidar, Truque, Pensar, Trapacear): regras puras em `cyvasse-minor.js`,
  números em `MINOR` (`cyvasse-data.js`). Uma por jogador, com recarga de 3 rodadas contada por jogador; o teste é
  rolado na hora contra o passivo do alvo e o efeito vale para as rolagens daquela rodada (`roundModifiers`).
  O nível/benefícios do personagem só decidem se o teste acerta; o EFEITO é fixo e limitado (`MINOR.caps`), porque
  qualquer bônus recorrente decide a partida (medido com o simulador). Só o resultado do Pensar é privado.
  Trapacear tem risco real (falha no teste ou 15% de piso) e pego = derrota imediata (`reason: "caught"`).
- **Rolagem sem chat**: use `CSRoll#evaluate()`; `doRoll()` continua sendo o que posta no chat.
- **Registro da partida** é persistido em `flags.chroniclesystem.cyvasse.record` da carta final e
  é dado não confiável ao ser relido: sempre passe por `validateRecord()` antes de renderizar.
- **Testes**: `npm test` (runner nativo do Node, `specs/**/*.spec.js`, sem dependências). O
  simulador de equilíbrio (`npm run balance [partidas] [tier]`) é manual e não roda no `npm test`.
