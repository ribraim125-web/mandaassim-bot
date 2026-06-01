/**
 * compare-main-model.js — comparativo lado a lado GPT-5 mini × Haiku.
 *
 * Roda a MESMA situação nos dois modelos com o SYSTEM_PROMPT real do Tom Certo
 * e imprime: texto montado, malformado?, latência, tokens e custo. Pra você
 * conferir TOM e FORMATO antes de liberar em produção.
 *
 * Uso (no servidor, onde existem as duas chaves):
 *   node scripts/compare-main-model.js
 *
 * Precisa de OPENROUTER_API_KEY (GPT-5 mini) e ANTHROPIC_API_KEY (Haiku) no .env.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chamarModelo, montarRespostaEstruturada } = require('../src/lib/mainGeneration');
const { estimateCost } = require('../src/lib/tracking');

// Extrai o SYSTEM_PROMPT real do index.js sem dar require (evita subir o bot).
function extrairSystemPrompt() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  const marker = 'const SYSTEM_PROMPT = `';
  const i = src.indexOf(marker);
  if (i === -1) throw new Error('SYSTEM_PROMPT não encontrado no index.js');
  const start = i + marker.length;
  const end = src.indexOf('`;', start);
  return src.slice(start, end);
}

// 6 situações de paquera (as que você pediu).
const SITUACOES = [
  { nome: 'Abertura fria',        texto: 'match no tinder, ela não respondeu minha primeira mensagem ainda, quero mandar algo que ela responda' },
  { nome: 'Ela respondeu seco',   texto: 'perguntei como foi o fim de semana dela e ela só respondeu "foi bom"' },
  { nome: 'Marcar encontro',      texto: 'a conversa tá boa, já trocamos uns áudios, quero chamar ela pra sair sem parecer afobado' },
  { nome: 'Reagir a áudio',       texto: 'ela mandou um áudio rindo contando que o cachorro dela aprontou, quero responder no clima' },
  { nome: 'Provocação',           texto: 'ela falou "você parece ser cheio de conversa" meio testando' },
  { nome: 'Sumiu e voltou',       texto: 'ela tinha sumido 4 dias e agora mandou um "oi sumido", quero responder com leveza sem dar bola demais' },
];

const MODELOS = {
  'GPT-5 mini': { model: 'openai/gpt-5-mini',                key: 'OPENROUTER_API_KEY' },
  'Haiku 4.5':  { model: 'claude-haiku-4-5-20251001',        key: 'ANTHROPIC_API_KEY' },
};

async function rodar() {
  const systemPrompt = extrairSystemPrompt();
  console.log(`[Harness] SYSTEM_PROMPT carregado (${systemPrompt.length} chars)\n`);

  for (const sit of SITUACOES) {
    console.log('═'.repeat(78));
    console.log(`SITUAÇÃO: ${sit.nome}\n"${sit.texto}"`);
    console.log('═'.repeat(78));

    const userContent = `Situação atual: "${sit.texto}"\n\nGere as 3 opções mais certeiras pra essa situação. Não seja genérico.`;

    for (const [nome, cfg] of Object.entries(MODELOS)) {
      if (!process.env[cfg.key]) { console.log(`\n[${nome}] PULADO — falta ${cfg.key} no .env\n`); continue; }
      const t0 = Date.now();
      try {
        const r = await chamarModelo(cfg.model, { systemPrompt, userContent, maxTokens: 900, temperature: 0.85 });
        const ms = Date.now() - t0;
        const cost = estimateCost(r.modelUsed, r.usage.inputTokens, r.usage.outputTokens, r.usage.cacheReadTokens, r.usage.cacheWriteTokens);
        console.log(`\n──── ${nome} (${r.modelUsed}) ────`);
        console.log(`malformado: ${r.malformed ? '⚠️ SIM' : 'não'} | ${ms}ms | in:${r.usage.inputTokens} cache:${r.usage.cacheReadTokens} out:${r.usage.outputTokens} | $${cost ? cost.usd.toFixed(5) : '?'}`);
        console.log('─ saída montada ─');
        console.log(r.text);
      } catch (err) {
        console.log(`\n[${nome}] ERRO: ${err.message}`);
      }
    }
    console.log('');
  }
}

rodar().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
