#!/usr/bin/env node
/**
 * spike-vision.js — Validação de viabilidade das features Vision do Wingman Pro
 *
 * Uso:
 *   node scripts/spike-vision.js --type perfil_meu  --image /caminho/para/imagem.jpg
 *   node scripts/spike-vision.js --type perfil_dela --image /caminho/para/imagem.jpg
 *   node scripts/spike-vision.js --batch ./scripts/spike-images/
 *
 * Requisitos: .env com ANTHROPIC_API_KEY
 *
 * Critérios de aprovação:
 *   Latência P95 < 10s
 *   Custo médio < R$ 0,30/análise
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs   = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

// ── Configuração ──────────────────────────────────────────────────────────────

const HAIKU_MODEL  = 'claude-haiku-4-5-20251001';
const USD_TO_BRL   = 5.75;

// Preços Haiku 4.5 por 1M tokens (USD)
const PRICES = { input: 1.00, output: 5.00, cache_write: 1.25, cache_read: 0.10 };

// ── System Prompts ────────────────────────────────────────────────────────────

const PROMPT_PERFIL_MEU = `Você é o MandaAssim — analisa perfis de apps de relacionamento com honestidade direta, sem rebaixar.

Analise este perfil e retorne APENAS JSON válido (sem markdown, sem texto extra):

{
  "platform_detected": "tinder | bumble | hinge | unknown",
  "photos_analyzed": [
    {
      "position": 1,
      "type": "selfie | full_body | activity | with_friends | mirror_gym | other",
      "verdict": "keep | replace | remove",
      "rationale": "por que essa decisão — 1 linha",
      "specific_feedback": "o que mudar exatamente — ação concreta"
    }
  ],
  "bio_analysis": {
    "current_text": "texto atual da bio (ou vazio se não tiver)",
    "verdict": "great | ok | bad",
    "issues": ["problema 1", "problema 2"],
    "rewritten_suggestion": "versão reescrita — máx 150 chars, natural, sem clichê"
  },
  "ordering_advice": "conselho sobre ordem das fotos — 1-2 linhas",
  "missing_elements": ["o que está faltando no perfil — ex: foto de atividade, bio, foto sorrindo"],
  "overall_verdict": "avaliação geral honesta — 2-3 linhas, sem rebaixar",
  "top_3_changes": ["mudança 1 mais impactante", "mudança 2", "mudança 3"]
}

Tom: honesto e direto. "Troca essa foto" em vez de "essa foto poderia ser melhorada".
Nunca: "horrível, refaz tudo". Sempre: "não funciona porque X, troca por algo do tipo Y".`;

const PROMPT_PERFIL_DELA = `Você é o MandaAssim — lê a intenção por trás do perfil dela para gerar a primeira mensagem certa.

Analise este perfil e retorne APENAS JSON válido (sem markdown, sem texto extra):

{
  "platform_detected": "tinder | bumble | hinge | instagram | unknown",
  "name_detected": "nome ou null",
  "age_detected": "idade ou null",
  "bio_text": "texto da bio ou vazio",
  "interests_detected": ["interesse 1", "interesse 2"],
  "photos_themes": ["academia", "viagem", "pet", "comida", "natureza", "praia", "balada", "trabalho", "arte"],
  "personality_signals": ["aventureira", "intelectual", "fitness", "artística", "tranquila", "agitada", "divertida", "séria"],
  "potential_hooks": [
    {"hook": "gancho específico baseado no perfil", "rationale": "por que esse gancho funciona"},
    {"hook": "...", "rationale": "..."},
    {"hook": "...", "rationale": "..."}
  ],
  "risks_to_watch": ["sinal de alerta 1", "sinal de alerta 2"],
  "recommended_first_message": {
    "soft_curious": "mensagem mais leve/curiosa — abre sem pressão",
    "playful_clever": "mensagem principal — inteligente, mostra que leu o perfil",
    "direct_charming": "mensagem mais direta/charmosa"
  },
  "what_NOT_to_send": ["erro clássico 1 pra evitar com esse perfil", "erro 2"]
}

Regras: nunca genérico. Cada mensagem deve referenciar algo específico do perfil.
Nunca: "oi linda", "que perfil incrível", elogio de aparência.
Tom: maduro, direto, brasileiro.`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function calcularCusto(usage) {
  const usd =
    ((usage.input_tokens || 0)                  / 1e6 * PRICES.input)       +
    ((usage.output_tokens || 0)                 / 1e6 * PRICES.output)      +
    ((usage.cache_creation_input_tokens || 0)   / 1e6 * PRICES.cache_write) +
    ((usage.cache_read_input_tokens || 0)       / 1e6 * PRICES.cache_read);
  return { usd, brl: usd * USD_TO_BRL };
}

function imageToBase64(imagePath) {
  const buf = fs.readFileSync(imagePath);
  const ext = path.extname(imagePath).toLowerCase();
  const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
  const mimeType = mimeMap[ext] || 'image/jpeg';
  return { base64: buf.toString('base64'), mimeType };
}

function percentil(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ── Core: analisa uma imagem ──────────────────────────────────────────────────

async function analisarImagem(imagePath, tipo) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { base64, mimeType } = imageToBase64(imagePath);
  const systemPrompt = tipo === 'perfil_meu' ? PROMPT_PERFIL_MEU : PROMPT_PERFIL_DELA;
  const userText = tipo === 'perfil_meu'
    ? 'Analise este perfil próprio e retorne o JSON completo.'
    : 'Analise este perfil e retorne o JSON completo com primeira mensagem personalizada.';

  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model:      HAIKU_MODEL,
    max_tokens: 1200,
    system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
        { type: 'text', text: userText },
      ],
    }],
  });

  const latencyMs = Date.now() - t0;
  const rawText   = response.content[0]?.text || '';
  const custo     = calcularCusto(response.usage);

  let parsed = null;
  try {
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (_) {
    parsed = null;
  }

  return {
    imagePath: path.basename(imagePath),
    tipo,
    latencyMs,
    costUsd: custo.usd,
    costBrl: custo.brl,
    inputTokens:  response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    jsonOk:   parsed !== null,
    parsed,
    rawText: parsed ? null : rawText.slice(0, 500), // só loga raw se falhou
  };
}

// ── Relatório ─────────────────────────────────────────────────────────────────

function imprimirRelatorio(resultados) {
  console.log('\n' + '═'.repeat(60));
  console.log('SPIKE VISION — RELATÓRIO');
  console.log('═'.repeat(60));

  const latencias  = resultados.map(r => r.latencyMs);
  const custos     = resultados.map(r => r.costBrl);
  const sucessos   = resultados.filter(r => r.jsonOk).length;

  console.log(`\nAmostras analisadas : ${resultados.length}`);
  console.log(`JSON válidos        : ${sucessos}/${resultados.length}`);
  console.log(`Latência P50        : ${percentil(latencias, 50)}ms`);
  console.log(`Latência P95        : ${percentil(latencias, 95)}ms`);
  console.log(`Custo médio         : R$ ${(custos.reduce((a, b) => a + b, 0) / custos.length).toFixed(4)}`);
  console.log(`Custo máximo        : R$ ${Math.max(...custos).toFixed(4)}`);

  console.log('\n' + '─'.repeat(60));
  console.log('POR IMAGEM:');
  for (const r of resultados) {
    const status = r.jsonOk ? '✅' : '❌';
    console.log(`  ${status} ${r.imagePath} [${r.tipo}] — ${r.latencyMs}ms — R$${r.costBrl.toFixed(4)}`);
    if (!r.jsonOk) console.log(`     RAW: ${r.rawText}`);
    if (r.jsonOk && r.tipo === 'perfil_meu') {
      console.log(`     Fotos: ${r.parsed?.photos_analyzed?.length || 0} | Top mudança: ${r.parsed?.top_3_changes?.[0] || 'N/A'}`);
    }
    if (r.jsonOk && r.tipo === 'perfil_dela') {
      const msg = r.parsed?.recommended_first_message?.playful_clever;
      console.log(`     Msg principal: "${msg || 'N/A'}"`);
    }
  }

  console.log('\n' + '─'.repeat(60));
  const p95  = percentil(latencias, 95);
  const custoMedio = custos.reduce((a, b) => a + b, 0) / custos.length;
  const aprovado = p95 < 10000 && custoMedio < 0.30;

  if (aprovado) {
    console.log('✅ SPIKE APROVADO — latência e custo dentro dos critérios');
    console.log('   Pode prosseguir para implementação em produção.');
  } else {
    console.log('❌ SPIKE REPROVADO');
    if (p95 >= 10000) console.log(`   ⚠️  P95 latência: ${p95}ms (limite: 10.000ms)`);
    if (custoMedio >= 0.30) console.log(`   ⚠️  Custo médio: R$${custoMedio.toFixed(4)} (limite: R$0,30)`);
  }
  console.log('═'.repeat(60) + '\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args    = process.argv.slice(2);
  const typeIdx = args.indexOf('--type');
  const imgIdx  = args.indexOf('--image');
  const batchIdx = args.indexOf('--batch');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY não configurada no .env');
    process.exit(1);
  }

  const resultados = [];

  if (batchIdx !== -1) {
    // Modo batch: pasta com sub-pastas perfil_meu/ e perfil_dela/
    const pastaBase = args[batchIdx + 1];
    const TIPOS = ['perfil_meu', 'perfil_dela'];

    for (const tipo of TIPOS) {
      const pasta = path.join(pastaBase, tipo);
      if (!fs.existsSync(pasta)) {
        console.log(`⚠️  Pasta não encontrada: ${pasta} — pulando`);
        continue;
      }
      const arquivos = fs.readdirSync(pasta)
        .filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f))
        .slice(0, 5); // máx 5 de cada

      console.log(`\nAnalisando ${arquivos.length} imagens de [${tipo}]...`);
      for (const arquivo of arquivos) {
        const fullPath = path.join(pasta, arquivo);
        console.log(`  → ${arquivo}`);
        try {
          const result = await analisarImagem(fullPath, tipo);
          resultados.push(result);
        } catch (err) {
          console.error(`  ❌ Erro em ${arquivo}: ${err.message}`);
          resultados.push({ imagePath: arquivo, tipo, latencyMs: 0, costBrl: 0, jsonOk: false, rawText: err.message });
        }
      }
    }

  } else if (typeIdx !== -1 && imgIdx !== -1) {
    // Modo single: --type perfil_meu --image ./foto.jpg
    const tipo    = args[typeIdx + 1];
    const imgPath = args[imgIdx + 1];

    if (!['perfil_meu', 'perfil_dela'].includes(tipo)) {
      console.error('❌ --type deve ser perfil_meu ou perfil_dela');
      process.exit(1);
    }
    if (!fs.existsSync(imgPath)) {
      console.error(`❌ Imagem não encontrada: ${imgPath}`);
      process.exit(1);
    }

    console.log(`Analisando ${imgPath} como [${tipo}]...`);
    const result = await analisarImagem(imgPath, tipo);
    resultados.push(result);

    if (result.jsonOk) {
      console.log('\n── JSON retornado ──');
      console.log(JSON.stringify(result.parsed, null, 2));
    }

  } else {
    console.log(`
Uso:
  node scripts/spike-vision.js --type perfil_meu --image ./foto.jpg
  node scripts/spike-vision.js --type perfil_dela --image ./foto.jpg
  node scripts/spike-vision.js --batch ./scripts/spike-images/

Estrutura para --batch:
  scripts/spike-images/
    perfil_meu/    (5 fotos: bom, mediano, ruim, selfie, atividade)
    perfil_dela/   (5 fotos: tinder, bumble, hinge, instagram, variados)
    `);
    process.exit(0);
  }

  if (resultados.length > 0) {
    imprimirRelatorio(resultados);
    // Salva resultados em JSON para análise posterior
    const outputPath = path.join(__dirname, '../docs/features-pro/spike-results.json');
    fs.writeFileSync(outputPath, JSON.stringify({ timestamp: new Date().toISOString(), resultados }, null, 2));
    console.log(`Resultados salvos em: ${outputPath}`);
  }
}

main().catch(err => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
