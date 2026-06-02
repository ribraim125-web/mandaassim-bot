/**
 * smoke.js — guardrail de carga em RUNTIME.
 *
 * `node --check` só valida sintaxe; NÃO pega erro de execução do top-level
 * (ex.: TDZ "Cannot access 'client' before initialization", import quebrado).
 * Este smoke CARREGA o index.js de verdade (require) e falha alto em qualquer
 * erro de load. Sai antes do puppeteer/WhatsApp subir.
 *
 * Seguro pra rodar em qualquer lugar: usa uma PORTA isolada (não toca no 3000
 * do bot vivo) e chaves dummy se não houver reais. Não faz chamada de rede —
 * encerra logo após o módulo carregar.
 *
 * Uso: npm run smoke   (exit 0 = OK, exit 1 = falhou no load)
 */

// Porta isolada ANTES do require (dotenv não sobrescreve env já setado).
process.env.PORT               = process.env.SMOKE_PORT || '39917';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || 'smoke-dummy';
process.env.ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY  || 'smoke-dummy';
process.env.SUPABASE_URL       = process.env.SUPABASE_URL       || 'https://smoke.invalid';
process.env.SUPABASE_KEY       = process.env.SUPABASE_KEY       || 'smoke-dummy';

const t0 = Date.now();
try {
  require('../index.js');
} catch (err) {
  console.error('\n[SMOKE] ❌ FALHOU ao carregar index.js em runtime:');
  console.error('        ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n        ') : err));
  process.exit(1);
}

console.log(`[SMOKE] ✅ OK — index.js carregou em runtime sem erros de load (${Date.now() - t0}ms)`);
process.exit(0);
