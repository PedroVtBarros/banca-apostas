# Gestão de Banca

Aplicativo desktop (Windows) para gestão de banca de apostas esportivas. Funciona 100% offline; os dados ficam em um arquivo SQLite no computador.

**Stack:** Electron 45 · React 19 · TypeScript · SQLite (módulo `node:sqlite` embutido no Electron — não há dependência nativa para compilar/empacotar) · Vite · electron-builder (NSIS).

## Usar o aplicativo instalado

1. Execute `release\Gestao-de-Banca-Setup-1.0.0.exe` e siga o assistente (instalação por usuário, sem necessidade de administrador; permite escolher a pasta). Cria atalhos na Área de Trabalho e no Menu Iniciar.
2. Não é preciso instalar Node.js nem abrir terminal.
3. **Onde ficam os dados:** `%APPDATA%\GestaoBanca\banca.db` (fora da pasta de instalação). Eles são preservados ao fechar, reiniciar, atualizar a versão e até ao desinstalar. Backups automáticos diários ficam em `%APPDATA%\GestaoBanca\backups`.

> O instalador não é assinado digitalmente; o Windows SmartScreen pode exibir "Windows protegeu seu computador" → *Mais informações* → *Executar assim mesmo*.

## Desenvolvimento

Requisitos: Node.js 22+ (testado com 24) e npm.

```powershell
npm install
npm run dev        # Vite (HMR) + Electron; dados de teste em .dev-data\
npm test           # testes unitários e de banco (Vitest)
npm run typecheck
npm run e2e        # teste ponta a ponta no Electron real (Playwright)
```

Se o seu terminal definir `ELECTRON_RUN_AS_NODE` (comum no terminal do VS Code), os scripts já o removem ao iniciar o Electron.

## Gerar o instalador (.exe)

```powershell
npm install
npm run dist       # typecheck + build + electron-builder  ->  release\Gestao-de-Banca-Setup-<versão>.exe
npm run pack       # apenas a pasta release\win-unpacked\ (sem instalador)
npm run icon       # regenera build\icon.ico / icon.png (opcional)
```

Para testar o executável empacotado: `node scripts/e2e.mjs --exe "release\win-unpacked\GestaoDeBanca.exe"`.

Para lançar uma nova versão sem perder dados: aumente `version` no `package.json`, rode `npm run dist` e instale por cima — o `appId` é fixo e os dados ficam em `%APPDATA%`. Mudanças no banco entram como **novas migrations** (veja abaixo).

## Arquitetura

```
src/
  shared/    tipos, dinheiro/odds (centavos, milésimos, arredondamento) e contrato IPC tipado
  core/      regras de negócio PURAS: ledger (saldos, séries, alertas, painel) e validação
  main/      processo principal: SQLite (db/), serviço transacional, backup, IPC, janela
  preload/   expõe window.banca com lista FECHADA de métodos (contextBridge)
  renderer/  interface React (sem acesso a Node, sem localStorage como banco)
tests/       Vitest: regras, banco, migrations, backup
scripts/     build (esbuild), dev, ícone, e2e (Playwright + Electron)
```

- **Segurança:** `contextIsolation` ligado, `nodeIntegration` desligado, `sandbox` ligado, CSP restritiva no build, navegação externa bloqueada, remetente do IPC verificado, toda entrada revalidada no main, SQL somente parametrizado.
- **Persistência:** `PRAGMA synchronous = FULL` (cada commit vai ao disco), chaves estrangeiras ligadas, `CHECK`s no esquema. Migrations por `PRAGMA user_version`, cada uma em transação; antes de migrar um banco existente é feita uma cópia de segurança.
- **Migrations:** adicione um item ao fim de `MIGRATIONS` em `src/main/db/migrations.ts`. Nunca altere as já publicadas.

## Regras de cálculo

- Valores em **centavos** (inteiros); odds em **milésimos** (até 3 casas decimais).
- Retorno = `round_half_up(valor × odd)` ao centavo, uma única vez por aposta (aritmética inteira). Lucro = retorno − valor.
- **Nada de saldo é gravado.** Saldos, reservas, lucro e gráficos são derivados do estado atual de casas, movimentações e apostas. Trocar o status N vezes apenas muda "o estado atual" da aposta — impossível duplicar crédito/débito.

| Status | Disponível | Reservado | Resultado realizado |
|---|---|---|---|
| Pendente | −valor | +valor | — |
| Green | −valor + retorno | 0 | +(retorno − valor) |
| Red | −valor | 0 | −valor |
| Anulada | 0 (valor devolvido) | 0 | 0 |

- Patrimônio = disponível + reservado. Depósitos/saques e saldo inicial alteram o saldo e o patrimônio, **nunca** o lucro.
- Taxa de acerto = Greens ÷ (Greens + Reds). ROI = lucro de Green+Red ÷ total apostado em Green+Red × 100. Sem base de cálculo → "—".
- Datas separadas: data da aposta (`placed_at`) e da liquidação (`settled_at`). Os gráficos usam a data de cada evento financeiro; corrigir uma aposta antiga reposiciona o efeito no tempo.
- Filtros do painel: lucro/acerto/ROI usam apostas **liquidadas** no período; quantidade e distribuição usam apostas **feitas** no período; saldos mostram a situação atual.
- Correção retroativa que deixa o saldo negativo (atual ou em algum momento do histórico) **não bloqueia nem apaga nada**: aparece um aviso permanente com a casa, a data e o valor mínimo.
- Casas com movimentações não podem ser excluídas (apenas arquivadas; não se arquiva casa com apostas pendentes).

## Backup

Em **Dados e backup**: *Exportar* gera uma cópia consistente (`VACUUM INTO`) em um `.db`; *Restaurar* valida o arquivo (integridade, esquema, versão), pede confirmação, guarda uma cópia dos dados atuais em `backups\antes-da-restauracao-*.db` e só então substitui — com reversão automática em caso de falha.
