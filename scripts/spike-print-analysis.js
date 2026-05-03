#!/usr/bin/env node
/**
 * spike-print-analysis.js
 *
 * Spike técnico: valida Haiku 4.5 vision para análise de prints de conversas.
 *
 * Uso:
 *   node scripts/spike-print-analysis.js <caminho-da-imagem>
 *   node scripts/spike-print-analysis.js --batch   (gera prints sintéticos e testa os 10)
 *
 * Saída:
 *   JSON estruturado + métricas de latência/tokens/custo
 *
 * Requer: ANTHROPIC_API_KEY no .env
 */

require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

// ─── Preços Haiku 4.5 (por 1M tokens) ────────────────────────────────────────
const PRICES = {
  input:        1.00,   // USD/1M
  output:       5.00,   // USD/1M
  cache_write:  1.25,   // USD/1M
  cache_read:   0.10,   // USD/1M
};
const USD_TO_BRL = 5.75;

// ─── System prompt ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é um especialista em análise de conversas de relacionamento.

Sua tarefa: analisar o print de uma conversa (WhatsApp, Tinder, Bumble ou Instagram DM) e retornar uma análise estruturada em JSON.

Regras:
- Retorne APENAS JSON válido, sem markdown, sem texto fora do JSON.
- Se não conseguir identificar mensagens, retorne messages_extracted: []
- match_interest_level: "low" | "medium" | "high" | "very_high"
- conversation_temperature: "cold" | "warm" | "hot" | "unknown"
- Todos os arrays podem ser vazios se não houver ocorrências

Schema obrigatório:
{
  "platform_detected": "whatsapp" | "tinder" | "bumble" | "instagram" | "unknown",
  "messages_extracted": [
    { "sender": "user" | "match", "text": "...", "timestamp": "..." }
  ],
  "match_interest_level": "low" | "medium" | "high" | "very_high",
  "conversation_temperature": "cold" | "warm" | "hot" | "unknown",
  "red_flags": ["..."],
  "green_flags": ["..."],
  "user_mistakes_detected": ["..."],
  "suggested_next_message": {
    "safe": "...",
    "balanced": "...",
    "bold": "..."
  },
  "rationale": "..."
}`;

// ─── Lógica de análise ─────────────────────────────────────────────────────────

const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Analisa um print via Haiku 4.5 vision.
 * @param {string} imagePath - caminho absoluto ou relativo da imagem
 * @returns {Promise<{result: object, metrics: object}>}
 */
async function analyzeConversationPrint(imagePath) {
  const absPath = path.resolve(imagePath);
  if (!fs.existsSync(absPath)) throw new Error(`Arquivo não encontrado: ${absPath}`);

  const imageBuffer = fs.readFileSync(absPath);
  const base64 = imageBuffer.toString('base64');
  const ext = path.extname(absPath).toLowerCase().replace('.', '');
  const mediaTypeMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
  const mediaType = mediaTypeMap[ext] || 'image/jpeg';

  const startTime = Date.now();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      }
    ],
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          {
            type: 'text',
            text: 'Analise este print de conversa e retorne o JSON conforme o schema.',
          },
        ],
      },
    ],
  });

  const latencyMs = Date.now() - startTime;

  // Calcula custo
  const usage = response.usage;
  const inputTokens       = usage.input_tokens || 0;
  const outputTokens      = usage.output_tokens || 0;
  const cacheWriteTokens  = usage.cache_creation_input_tokens || 0;
  const cacheReadTokens   = usage.cache_read_input_tokens || 0;

  const costUsd = (
    (inputTokens       / 1_000_000 * PRICES.input)      +
    (outputTokens      / 1_000_000 * PRICES.output)     +
    (cacheWriteTokens  / 1_000_000 * PRICES.cache_write) +
    (cacheReadTokens   / 1_000_000 * PRICES.cache_read)
  );

  const metrics = {
    latencyMs,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    costUsd: parseFloat(costUsd.toFixed(6)),
    costBrl: parseFloat((costUsd * USD_TO_BRL).toFixed(6)),
    model: response.model,
    stopReason: response.stop_reason,
  };

  // Parse do JSON retornado
  const rawText = response.content[0]?.text || '';
  let result;
  try {
    // Remove possível markdown code fence
    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim();
    result = JSON.parse(cleaned);
  } catch (_) {
    result = { parse_error: true, raw_output: rawText };
  }

  return { result, metrics };
}

// ─── Prints sintéticos para batch ─────────────────────────────────────────────
// Como não temos imagens reais no spike, geramos SVGs simples simulando prints

/**
 * Gera um SVG simples simulando um print de conversa.
 * @param {object} opts
 */
function generateSyntheticPrint({ platform, messages, filename }) {
  const colors = {
    whatsapp: { bg: '#E5DDD5', sent: '#DCF8C6', received: '#FFFFFF', header: '#075E54' },
    tinder:   { bg: '#F5F5F5', sent: '#FE3C72', received: '#E8E8E8', header: '#FE3C72' },
    bumble:   { bg: '#F5F5F5', sent: '#FFD700', received: '#E8E8E8', header: '#FFD700' },
    instagram: { bg: '#FAFAFA', sent: '#3797EF', received: '#E8E8E8', header: '#3797EF' },
  };
  const c = colors[platform] || colors.whatsapp;
  const name = platform.charAt(0).toUpperCase() + platform.slice(1);

  let msgY = 80;
  let msgBlocks = '';
  for (const msg of messages) {
    const isUser = msg.sender === 'user';
    const x = isUser ? 200 : 20;
    const textColor = isUser && (platform === 'tinder' || platform === 'bumble') ? '#fff' : '#000';
    msgBlocks += `
    <rect x="${x}" y="${msgY}" width="180" height="35" rx="10" fill="${isUser ? c.sent : c.received}"/>
    <text x="${x + 10}" y="${msgY + 15}" font-size="10" fill="${textColor}">${msg.sender === 'user' ? 'Você' : 'Match'}</text>
    <text x="${x + 10}" y="${msgY + 28}" font-size="9" fill="${textColor}">${(msg.text || '').substring(0, 28)}</text>`;
    msgY += 50;
  }

  const svgHeight = Math.max(300, msgY + 40);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="${svgHeight}">
  <rect width="400" height="${svgHeight}" fill="${c.bg}"/>
  <rect width="400" height="60" fill="${c.header}"/>
  <text x="20" y="25" font-size="14" fill="white" font-weight="bold">${name}</text>
  <text x="20" y="45" font-size="11" fill="white">Maria, 29</text>
  ${msgBlocks}
</svg>`;

  fs.writeFileSync(filename, svg);
  return filename;
}

/**
 * Suite de 10 prints sintéticos para o spike.
 */
function buildSyntheticBatch(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  const cases = [
    {
      id: 'tinder_01', platform: 'tinder', label: 'Tinder — match novo, interesse alto',
      messages: [
        { sender: 'match', text: 'Oi! Amei seu perfil' },
        { sender: 'user',  text: 'Oi! Obrigado :)' },
        { sender: 'match', text: 'Você é de SP?' },
      ],
    },
    {
      id: 'tinder_02', platform: 'tinder', label: 'Tinder — conversa esfriando',
      messages: [
        { sender: 'user',  text: 'Oi, tudo bem?' },
        { sender: 'match', text: 'Oi' },
        { sender: 'user',  text: 'O que você faz?' },
        { sender: 'match', text: 'Trabalho' },
      ],
    },
    {
      id: 'tinder_03', platform: 'tinder', label: 'Tinder — usuário clicando demais',
      messages: [
        { sender: 'user',  text: 'Oi!' },
        { sender: 'user',  text: 'Você é linda' },
        { sender: 'user',  text: 'Me fala de você' },
        { sender: 'user',  text: 'Tá aí?' },
      ],
    },
    {
      id: 'whatsapp_01', platform: 'whatsapp', label: 'WhatsApp — conversa quente',
      messages: [
        { sender: 'match', text: 'Que saudade de você!' },
        { sender: 'user',  text: 'Também senti falta' },
        { sender: 'match', text: 'Quando nos vemos?' },
      ],
    },
    {
      id: 'whatsapp_02', platform: 'whatsapp', label: 'WhatsApp — após 3 dias sem resposta',
      messages: [
        { sender: 'user',  text: 'Oi, sumiu?' },
        { sender: 'match', text: 'Oi, tava ocupada' },
        { sender: 'user',  text: 'Tudo bem?' },
      ],
    },
    {
      id: 'whatsapp_03', platform: 'whatsapp', label: 'WhatsApp — red flag ciúme',
      messages: [
        { sender: 'match', text: 'Quem é essa na foto?' },
        { sender: 'user',  text: 'Uma amiga' },
        { sender: 'match', text: 'Sua ex?' },
      ],
    },
    {
      id: 'bumble_01', platform: 'bumble', label: 'Bumble — ela abrindo conversa',
      messages: [
        { sender: 'match', text: 'Oi! Gostei do seu perfil' },
        { sender: 'user',  text: 'Oi! Obrigado' },
        { sender: 'match', text: 'Você é chef?' },
      ],
    },
    {
      id: 'bumble_02', platform: 'bumble', label: 'Bumble — conversa fria, pouco engajamento',
      messages: [
        { sender: 'match', text: 'Oi' },
        { sender: 'user',  text: 'Oi, tudo certo?' },
        { sender: 'match', text: 'Sim' },
      ],
    },
    {
      id: 'instagram_01', platform: 'instagram', label: 'Instagram DM — abordagem via story',
      messages: [
        { sender: 'user',  text: 'Que foto incrível!' },
        { sender: 'match', text: 'Obrigada! Você curte surf?' },
        { sender: 'user',  text: 'Adoro! Onde você surfa?' },
      ],
    },
    {
      id: 'instagram_02', platform: 'instagram', label: 'Instagram DM — match sumiu',
      messages: [
        { sender: 'user',  text: 'Oi!' },
        { sender: 'match', text: 'Oi' },
        { sender: 'user',  text: 'Viu meu story?' },
      ],
    },
  ];

  return cases.map(c => {
    const filename = path.join(outputDir, `${c.id}.svg`);
    generateSyntheticPrint({ platform: c.platform, messages: c.messages, filename });
    return { ...c, filename };
  });
}

// ─── Runner ────────────────────────────────────────────────────────────────────

async function runSingle(imagePath) {
  console.log(`\nAnalisando: ${imagePath}`);
  const { result, metrics } = await analyzeConversationPrint(imagePath);
  console.log('\n── Resultado ──────────────────────────────');
  console.log(JSON.stringify(result, null, 2));
  console.log('\n── Métricas ───────────────────────────────');
  console.log(JSON.stringify(metrics, null, 2));
}

async function runBatch() {
  const batchDir = path.join(__dirname, '../tmp/spike-prints');
  console.log(`\nGerando prints sintéticos em: ${batchDir}`);
  const cases = buildSyntheticBatch(batchDir);
  console.log(`${cases.length} prints gerados.\n`);

  const results = [];
  let totalCostUsd = 0;

  for (const c of cases) {
    process.stdout.write(`[${c.id}] ${c.label}... `);
    const start = Date.now();
    try {
      const { result, metrics } = await analyzeConversationPrint(c.filename);
      totalCostUsd += metrics.costUsd;

      const ok = !result.parse_error && result.platform_detected && result.conversation_temperature;
      process.stdout.write(`${ok ? 'OK' : 'PARSE_ERR'} — ${metrics.latencyMs}ms — $${metrics.costUsd} (R$${metrics.costBrl})\n`);

      results.push({
        id: c.id,
        label: c.label,
        platform_expected: c.platform,
        ...metrics,
        parse_ok: !result.parse_error,
        platform_detected: result.platform_detected,
        conversation_temperature: result.conversation_temperature,
        match_interest_level: result.match_interest_level,
        messages_count: (result.messages_extracted || []).length,
        red_flags_count: (result.red_flags || []).length,
        green_flags_count: (result.green_flags || []).length,
        has_suggested_messages: !!(result.suggested_next_message?.safe),
        full_result: result,
      });
    } catch (err) {
      process.stdout.write(`ERRO — ${err.message}\n`);
      results.push({ id: c.id, label: c.label, error: err.message });
    }

    // Pequena pausa para não saturar rate limit
    await new Promise(r => setTimeout(r, 500));
  }

  // ── Análise agregada ────────────────────────────────────────────────────────
  const successful = results.filter(r => r.parse_ok);
  const latencies  = successful.map(r => r.latencyMs);
  const costs      = successful.map(r => r.costUsd);

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const max = arr => arr.length ? Math.max(...arr) : 0;
  const p90 = arr => {
    if (!arr.length) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length * 0.9)];
  };

  const platformAccuracy = successful.filter(r => r.platform_detected === r.platform_expected).length;
  const parseSuccessRate = (successful.length / results.length * 100).toFixed(1);
  const latencyTarget    = 8000; // ms
  const costTargetUsd    = 0.15 / USD_TO_BRL; // R$0.15 → USD

  const analysis = {
    summary: {
      total_cases:         results.length,
      successful_parses:   successful.length,
      parse_success_rate:  `${parseSuccessRate}%`,
      platform_accuracy:   `${successful.length ? (platformAccuracy / successful.length * 100).toFixed(1) : 0}%`,
    },
    latency: {
      avg_ms:  Math.round(avg(latencies)),
      p90_ms:  Math.round(p90(latencies)),
      max_ms:  Math.round(max(latencies)),
      target_ms: latencyTarget,
      within_target: latencies.filter(l => l <= latencyTarget).length,
      within_target_pct: `${latencies.length ? (latencies.filter(l => l <= latencyTarget).length / latencies.length * 100).toFixed(1) : 0}%`,
    },
    cost: {
      avg_per_call_usd:    parseFloat(avg(costs).toFixed(6)),
      avg_per_call_brl:    parseFloat((avg(costs) * USD_TO_BRL).toFixed(4)),
      total_usd:           parseFloat(totalCostUsd.toFixed(6)),
      total_brl:           parseFloat((totalCostUsd * USD_TO_BRL).toFixed(4)),
      target_per_call_brl: 0.15,
      within_target:       costs.filter(c => c * USD_TO_BRL <= 0.15).length,
      within_target_pct:   `${costs.length ? (costs.filter(c => c * USD_TO_BRL <= 0.15).length / costs.length * 100).toFixed(1) : 0}%`,
    },
    quality: {
      avg_messages_extracted: parseFloat(avg(successful.map(r => r.messages_count)).toFixed(1)),
      has_suggested_messages_pct: `${successful.length ? (successful.filter(r => r.has_suggested_messages).length / successful.length * 100).toFixed(1) : 0}%`,
      avg_red_flags:   parseFloat(avg(successful.map(r => r.red_flags_count)).toFixed(1)),
      avg_green_flags: parseFloat(avg(successful.map(r => r.green_flags_count)).toFixed(1)),
    },
  };

  // ── Recomendação go/no-go ───────────────────────────────────────────────────
  const latencyOk  = analysis.latency.avg_ms <= latencyTarget;
  const costOk     = analysis.cost.avg_per_call_brl <= 0.15;
  const parseOk    = parseFloat(parseSuccessRate) >= 90;

  let verdict = 'GO';
  const concerns = [];
  if (!latencyOk)  { concerns.push(`latência média (${analysis.latency.avg_ms}ms) acima de ${latencyTarget}ms`); verdict = 'CONDITIONAL_GO'; }
  if (!costOk)     { concerns.push(`custo médio (R$${analysis.cost.avg_per_call_brl}) acima de R$0.15`); verdict = 'CONDITIONAL_GO'; }
  if (!parseOk)    { concerns.push(`taxa de parse (${parseSuccessRate}%) abaixo de 90%`); verdict = 'NO_GO'; }

  const recommendation = {
    verdict,
    rationale: concerns.length
      ? `Implementar com ajustes: ${concerns.join('; ')}.`
      : 'Haiku 4.5 vision atende todos os critérios. Pronto para produção.',
    next_steps: verdict === 'NO_GO'
      ? ['Investigar falhas de parse', 'Testar com prompt mais restritivo', 'Avaliar Sonnet como fallback']
      : verdict === 'CONDITIONAL_GO'
      ? ['Ajustar max_tokens para reduzir custo', 'Adicionar timeout de 8s com mensagem de retry', 'Testar com prints reais antes do deploy']
      : ['Integrar em index.js substituindo analisarPrintComClaude', 'Monitorar primeiros 100 usos via api_requests'],
  };

  const finalReport = { analysis, recommendation, per_case: results };

  // Salva relatório
  const reportPath = path.join(__dirname, '../relatorios/spike-print-analysis.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(finalReport, null, 2));

  console.log('\n══════════════════════════════════════════════════');
  console.log('RELATÓRIO SPIKE — Haiku 4.5 Vision');
  console.log('══════════════════════════════════════════════════');
  console.log(`Parse success:    ${analysis.summary.parse_success_rate}`);
  console.log(`Platform accuracy:${analysis.summary.platform_accuracy}`);
  console.log(`Latência média:   ${analysis.latency.avg_ms}ms (p90: ${analysis.latency.p90_ms}ms, target: ${latencyTarget}ms)`);
  console.log(`Custo médio:      R$${analysis.cost.avg_per_call_brl} (target: R$0.15)`);
  console.log(`Custo total:      $${analysis.cost.total_usd} / R$${analysis.cost.total_brl}`);
  console.log(`\nVEREDICTO: ${verdict}`);
  console.log(recommendation.rationale);
  console.log(`\nPróximos passos:`);
  recommendation.next_steps.forEach(s => console.log(`  • ${s}`));
  console.log(`\nRelatório completo: ${reportPath}`);
}

// ─── Entry point ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Erro: ANTHROPIC_API_KEY não definido no .env');
  process.exit(1);
}

if (args[0] === '--batch') {
  runBatch().catch(err => { console.error(err); process.exit(1); });
} else if (args[0]) {
  runSingle(args[0]).catch(err => { console.error(err); process.exit(1); });
} else {
  console.log(`
Uso:
  node scripts/spike-print-analysis.js <imagem.jpg>   — analisa um print
  node scripts/spike-print-analysis.js --batch         — testa 10 prints sintéticos
`);
  process.exit(0);
}
