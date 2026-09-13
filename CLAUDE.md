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
