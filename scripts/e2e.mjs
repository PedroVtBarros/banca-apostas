// Teste ponta a ponta com o Electron REAL (dev: node_modules/electron; empacotado: --exe caminho.exe).
// Uso: node scripts/e2e.mjs [--exe "C:\\caminho\\Gestao de Banca.exe"] [--keep] [--shots pasta]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const exe = opt('--exe');
const shotsDir = path.resolve(opt('--shots') ?? '.e2e-data/shots');
fs.mkdirSync(shotsDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'banca-e2e-'));

const env = { ...process.env, BANCA_USER_DATA: dataDir };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;

let n = 0;
const ok = (msg) => console.log(`  ✔ ${msg}`);
const fail = (msg) => {
  throw new Error(msg);
};
const eq = (a, b, msg) => (a === b ? ok(`${msg}: ${a}`) : fail(`${msg}: esperado "${b}", obtido "${a}"`));
const nb = (s) => s.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

async function launch() {
  const app = exe
    ? await electron.launch({ executablePath: exe, env })
    : await electron.launch({ executablePath: require('electron'), args: ['.'], env, cwd: process.cwd() });
  const page = await app.firstWindow();
  await page.waitForSelector('.app', { timeout: 20000 });
  return { app, page };
}

const shot = async (page, name) => page.screenshot({ path: path.join(shotsDir, `${String(++n).padStart(2, '0')}-${name}.png`) });
const sidebar = async (page) => nb(await page.locator('.side-balance').innerText()).replace('DISPONÍVEL', 'Disponível').replace('EM APOSTAS PENDENTES', 'Em apostas pendentes');
const goto = async (page, label) => page.getByRole('button', { name: label }).first().click();
const waitSide = (page, text) =>
  page.waitForFunction((t) => document.querySelector('.side-balance')?.textContent?.replace(/\u00a0/g, ' ').includes(t), text);

async function addBet(page, { stake, odds, desc }) {
  await goto(page, 'Adicionar apostas');
  await page.getByLabel('Valor da aposta').fill(stake);
  await page.getByLabel('Odd (decimal)').fill(odds);
  if (desc) await page.getByLabel(/Evento ou mercado/).fill(desc);
  await page.getByRole('button', { name: 'Salvar aposta' }).click();
}

console.log(`Dados do teste: ${dataDir}`);
console.log(exe ? `Executável: ${exe}` : 'Modo desenvolvimento (Electron local)');

// ------------------------------------------------------------------ 1ª execução
let { app, page } = await launch();
console.log('1) Primeira execução (banco vazio)');
const info = await page.evaluate(() => window.banca.appInfo());
eq(info.ok, true, 'appInfo via IPC');
eq(info.data.dbPath.startsWith(dataDir), true, 'banco fica no diretório de dados do usuário');
eq(await page.evaluate(() => typeof window.require + typeof window.process), 'undefinedundefined', 'sem Node no renderer (nodeIntegration off)');
eq(await page.getByText('Cadastre sua primeira casa de apostas').isVisible(), true, 'estado vazio, sem dados fictícios');
await shot(page, 'vazio');

console.log('2) Casa e saldo inicial');
await goto(page, 'Banca e casas');
await page.getByRole('button', { name: 'Nova casa' }).first().click();
await page.getByLabel('Nome da casa').fill('Casa A');
await page.getByLabel('Saldo inicial', { exact: true }).fill('1.000,00');
await page.getByRole('button', { name: 'Salvar', exact: true }).click();
await page.getByRole('cell', { name: 'Casa A', exact: true }).waitFor();
eq(await sidebar(page), 'Disponível R$ 1.000,00 Em apostas pendentes R$ 0,00', 'saldo após cadastrar casa');

console.log('3) Validação do formulário');
await addBet(page, { stake: '0', odds: '2,5' });
eq(await page.getByText('O valor da aposta deve ser maior que zero.').isVisible(), true, 'valor zero recusado');
await page.getByLabel('Valor da aposta').fill('100');
await page.getByLabel('Odd (decimal)').fill('1');
await page.getByRole('button', { name: 'Salvar aposta' }).click();
eq(await page.getByText('A odd deve ser maior que 1,00.').isVisible(), true, 'odd 1,00 recusada');
await page.getByLabel('Valor da aposta').fill('1500');
await page.getByLabel('Odd (decimal)').fill('2,5');
await page.getByRole('button', { name: 'Salvar aposta' }).click();
eq(await page.getByText(/maior que o saldo disponível da casa/).first().isVisible(), true, 'valor acima do saldo recusado');
await shot(page, 'validacao');

console.log('4) Cadastro de aposta + prévia');
await page.getByLabel('Valor da aposta').fill('100');
await page.getByLabel('Odd (decimal)').fill('2,50');
await page.getByLabel(/Evento ou mercado/).fill('Teste 1 — Over 2,5');
const prev = nb(await page.locator('.preview').innerText());
eq(prev.includes('R$ 250,00') && prev.includes('+R$ 150,00'), true, 'retorno potencial R$ 250,00 e lucro potencial +R$ 150,00');
await page.getByRole('button', { name: 'Salvar aposta' }).click();
await page.getByText(/Aposta salva/).waitFor();
eq(await page.getByLabel('Valor da aposta').inputValue(), '', 'formulário limpo para a próxima aposta');
eq(await page.getByLabel('Valor da aposta').evaluate((el) => el === document.activeElement), true, 'foco volta ao valor');
await shot(page, 'aposta-salva');
eq(await sidebar(page), 'Disponível R$ 900,00 Em apostas pendentes R$ 100,00', 'Pendente: disponível 900 / reservado 100');

console.log('5) Trocas de status em Resultados');
await goto(page, 'Resultados');
const row = page.locator('tbody tr', { hasText: 'Teste 1' });
await row.getByRole('button', { name: 'Green', exact: true }).click();
await waitSide(page, '1.150,00');
eq(nb(await row.innerText()).includes('+R$ 150,00'), true, 'Green: lucro +R$ 150,00 na tabela');
eq(await sidebar(page), 'Disponível R$ 1.150,00 Em apostas pendentes R$ 0,00', 'Green: disponível 1.150');
await row.getByRole('button', { name: 'Red', exact: true }).click();
await waitSide(page, 'R$ 900,00');
eq(nb(await row.innerText()).includes('−R$ 100,00'), true, 'Red: prejuízo −R$ 100,00');
await row.getByRole('button', { name: 'Anulada', exact: true }).click();
await waitSide(page, 'R$ 1.000,00');
eq(await sidebar(page), 'Disponível R$ 1.000,00 Em apostas pendentes R$ 0,00', 'Anulada: disponível 1.000');
await row.getByRole('button', { name: /Mais ações/ }).click();
await page.getByRole('menuitem', { name: 'Voltar para Pendente' }).click();
await waitSide(page, 'R$ 100,00');
eq(await sidebar(page), 'Disponível R$ 900,00 Em apostas pendentes R$ 100,00', 'Pendente de novo: 900 / 100');
await row.getByRole('button', { name: 'Green', exact: true }).click();
await waitSide(page, '1.150,00');
await row.getByRole('button', { name: 'Green', exact: true }).click(); // já é Green: não deve fazer nada
await page.waitForTimeout(300);
eq(await sidebar(page), 'Disponível R$ 1.150,00 Em apostas pendentes R$ 0,00', 'repetir Green não duplica o crédito');
await shot(page, 'resultados');

console.log('6) Edição e histórico');
await row.getByRole('button', { name: /Mais ações/ }).click();
await page.getByRole('menuitem', { name: 'Editar' }).click();
await page.getByLabel('Valor da aposta').fill('200');
await page.getByRole('button', { name: 'Salvar alterações' }).click();
await waitSide(page, 'R$ 1.300,00');
eq(await sidebar(page), 'Disponível R$ 1.300,00 Em apostas pendentes R$ 0,00', 'editar valor de Green 100→200: 1.000−200+500');
await row.getByRole('button', { name: /Mais ações/ }).click();
await page.getByRole('menuitem', { name: 'Histórico' }).click();
const hist = nb(await page.locator('.timeline').innerText());
eq(hist.includes('Green → Red') && hist.includes('R$ 100,00 → R$ 200,00') && hist.includes('Aposta criada'), true, 'histórico registra criação, status e edição');
await shot(page, 'historico');
await page.keyboard.press('Escape');

console.log('7) Depósitos e saques não viram lucro');
await goto(page, 'Banca e casas');
await page.getByRole('button', { name: 'Depositar' }).first().click();
await page.getByLabel('Valor', { exact: true }).fill('500');
await page.getByRole('button', { name: 'Salvar', exact: true }).click();
await page.getByText('Depósito registrado.').waitFor();
await page.getByRole('button', { name: 'Sacar' }).first().click();
await page.getByLabel('Valor', { exact: true }).fill('300');
await page.getByRole('button', { name: 'Salvar', exact: true }).click();
await page.getByText('Saque registrado.').waitFor();
eq(await sidebar(page), 'Disponível R$ 1.500,00 Em apostas pendentes R$ 0,00', 'saldo: 1.300 + 500 − 300');
await shot(page, 'banca');
await goto(page, 'Painel e gráficos');
await page.getByText('Evolução do patrimônio da banca').waitFor();
const kpis = nb(await page.locator('.kpi-strip').nth(1).innerText());
eq(kpis.includes('+R$ 300,00'), true, 'lucro realizado = +R$ 300,00 (depósitos/saques fora)');
eq(kpis.includes('100,0%'), true, 'taxa de acerto 100,0%');
await page.waitForTimeout(800);
await shot(page, 'painel');
eq((await page.locator('svg.recharts-surface').count()) >= 4, true, 'gráficos renderizados');
await shot(page, 'painel');

console.log('8) Excluir aposta ajusta saldo');
await goto(page, 'Resultados');
await page.locator('tbody tr', { hasText: 'Teste 1' }).getByRole('button', { name: /Mais ações/ }).click();
await page.getByRole('menuitem', { name: 'Excluir' }).click();
await shot(page, 'excluir');
await page.getByRole('button', { name: 'Excluir aposta' }).click();
await waitSide(page, 'R$ 1.200,00');
eq(await sidebar(page), 'Disponível R$ 1.200,00 Em apostas pendentes R$ 0,00', 'sem a aposta: 1.000 + 500 − 300');
await addBet(page, { stake: '50', odds: '2', desc: 'Persistente' }); // deixa uma pendente para a checagem de persistência
await page.getByText(/Aposta salva/).waitFor();
await app.close();

// ------------------------------------------------------------------ 2ª execução (persistência)
console.log('9) Fechar e reabrir: persistência');
({ app, page } = await launch());
eq(await sidebar(page), 'Disponível R$ 1.150,00 Em apostas pendentes R$ 50,00', 'saldos preservados após reabrir');
await goto(page, 'Resultados');
await page.locator('tbody tr', { hasText: 'Persistente' }).waitFor();
ok('aposta pendente continua na lista');
await goto(page, 'Dados e backup');
const dataTxt = nb(await page.locator('main').innerText());
eq(dataTxt.includes('Casa "Casa A" cadastrada') && dataTxt.includes('Aposta excluída'), true, 'histórico de alterações preservado');
await shot(page, 'dados');

console.log('10) Cenário com vários dias (capturas dos gráficos)');
const day = (d, h = 12) => { const x = new Date(); x.setDate(x.getDate() - d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
const call = (fn, ...a) => page.evaluate(([fn, a]) => window.banca[fn](...a), [fn, a]);
const hB = (await call('createHouse', { name: 'Casa B', initialBalanceCents: 200000, initialBalanceAt: day(30, 9) })).data;
const hs = (await call('listHouses')).data;
const hA = hs.find((h) => h.name === 'Casa A');
await call('updateHouse', hA.id, { name: 'Casa A', initialBalanceCents: 100000, initialBalanceAt: day(30, 9) });
const plan = [
  [hA, 10000, 2000, 25, 'green'], [hA, 15000, 1800, 22, 'red'], [hB, 20000, 2500, 20, 'green'],
  [hB, 20000, 1900, 17, 'red'], [hA, 5000, 3000, 14, 'void'], [hB, 30000, 2100, 11, 'green'],
  [hA, 10000, 1500, 8, 'red'], [hB, 10000, 2800, 5, 'green'], [hA, 12000, 2200, 2, 'red'],
];
for (const [h, stake, odds, d, st] of plan) {
  const b = (await call('createBet', { houseId: h.id, stakeCents: stake, oddsMilli: odds, placedAt: day(d), description: 'Jogo ' + d, notes: '' })).data;
  await call('setBetStatus', b.id, st, day(d - 1 < 0 ? 0 : d - 1, 20));
}
await call('createTransaction', { houseId: hA.id, kind: 'deposit', amountCents: 50000, occurredAt: day(15), note: '' });
await call('createTransaction', { houseId: hB.id, kind: 'withdrawal', amountCents: 40000, occurredAt: day(6), note: '' });
await page.reload();
await page.waitForSelector('.app');
await goto(page, 'Painel e gráficos');
await page.waitForSelector('.recharts-line-curve');
await page.waitForTimeout(500);
await shot(page, 'painel-multi-1');
await page.locator('main').evaluate((el) => el.scrollTo(0, 620));
await page.waitForTimeout(300);
await shot(page, 'painel-multi-2');
await page.locator('main').evaluate((el) => el.scrollTo(0, 1400));
await page.waitForTimeout(300);
await shot(page, 'painel-multi-3');
await goto(page, 'Resultados');
await page.waitForTimeout(300);
await shot(page, 'resultados-multi');
await app.close();

console.log(`\nOK — todas as verificações passaram. Capturas em ${shotsDir}`);
if (!args.includes('--keep')) fs.rmSync(dataDir, { recursive: true, force: true });
