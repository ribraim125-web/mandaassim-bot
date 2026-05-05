/**
 * acts.js — catálogo dos 13 atos da narrativa progressiva
 *
 * Cada ato define:
 *   id          — identificador único (kebab-case)
 *   description — o que o ato faz
 *   trigger     — condições, cooldown, only_once
 *   variants    — array de variantes A/B (copyFile relativo a docs/narrative/)
 *   abTestSplit — [% variante A, % variante B] (default: 100% A)
 *   templateVars — função async que retorna vars para substituição no .md
 *   isProactive — false = NÃO disparado pela engine (injetado inline)
 *   expectedResponse — padrão de resposta esperada ('choice_1_2_3_4' | null)
 *   onResponse  — callback quando user responde (async(ctx, text) => void)
 *
 * Feature flag por ato: ENABLE_ACT_01_HOOK_DIAGNOSTICO=true (default false)
 * Engine verifica o flag antes de avaliar qualquer condição.
 */

'use strict';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Detecta escolha 1-4 no texto do usuário.
 * @param {string} text
 * @returns {'1'|'2'|'3'|'4'|null}
 */
function parseUserChoice(text) {
  const t = text.trim();
  if (/^1[^\d]?/.test(t) || t === '1') return '1';
  if (/^2[^\d]?/.test(t) || t === '2') return '2';
  if (/^3[^\d]?/.test(t) || t === '3') return '3';
  if (/^4[^\d]?/.test(t) || t === '4') return '4';
  return null;
}

/** Retorna nome de display do plano (para copy). */
function planLabel(plan) {
  const labels = { parceiro: 'Parceiro', parceiro_pro: 'Parceiro Pro', trial: 'trial', free: 'free' };
  return labels[plan] || plan;
}

// ── Catálogo ──────────────────────────────────────────────────────────────────

/**
 * @typedef {import('./triggerContext').TriggerContext} TriggerContext
 *
 * @typedef {{ id: string, copyFile: string, personaCondition?: string }} Variant
 *
 * @typedef {{
 *   id: string,
 *   description: string,
 *   featureFlag: string,
 *   isProactive?: boolean,
 *   trigger?: {
 *     conditions: (ctx: TriggerContext) => Promise<boolean>,
 *     cooldown_hours: number,
 *     only_once: boolean,
 *   },
 *   variants: Variant[],
 *   abTestSplit?: number[],
 *   templateVars: (ctx: TriggerContext) => Promise<Record<string, string>>,
 *   expectedResponse?: string,
 *   onResponse?: (ctx: TriggerContext, text: string) => Promise<void>,
 * }} ActDefinition
 */

/** @type {ActDefinition[]} */
const ACTS = [
  // ── Ato 1 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_01_hook_diagnostico',
    description: 'Boas-vindas + diagnóstico inicial de momento — qual situação o user está vivendo',
    featureFlag: 'ENABLE_ACT_01_HOOK_DIAGNOSTICO',

    trigger: {
      conditions: async (ctx) => {
        if (await ctx.actAlreadySent('act_01_hook_diagnostico')) return false;
        return await ctx.hasEvent('first_message_sent');
      },
      cooldown_hours: 0,
      only_once:      true,
    },

    variants: [{ id: 'A', copyFile: 'acts/act_01_hook_diagnostico.md' }],
    templateVars: async () => ({}),
    expectedResponse: 'choice_1_2_3_4',

    onResponse: async (ctx, text) => {
      const { logJourneyEvent } = require('./journeyEvents');
      const choice = parseUserChoice(text);
      if (choice) {
        await Promise.all([
          logJourneyEvent(ctx.phone, 'act_01_persona_selected', { choice }, false),
          ctx.setUserField('entry_persona', parseInt(choice, 10)),
        ]);
      }
    },
  },

  // ── Ato 2 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_02_promessa_mecanismo',
    description: 'Apresenta mecanismo Leitura de Intenção customizado pela persona do Ato 1',
    featureFlag: 'ENABLE_ACT_02_PROMESSA_MECANISMO',

    trigger: {
      conditions: async (ctx) => {
        if (await ctx.actAlreadySent('act_02_promessa_mecanismo')) return false;
        const persona = await ctx.getUserPersona();
        if (!persona) return false;
        const act01Time = await ctx.getActSentTime('act_01_hook_diagnostico');
        if (!act01Time) return false;
        const minutesSince = (Date.now() - act01Time.getTime()) / 60_000;
        // Dispara logo após resposta ao ato 1 (dentro de 30min)
        return minutesSince >= 0 && minutesSince <= 30;
      },
      cooldown_hours: 0,
      only_once:      true,
    },

    // Variante depende da persona — engine seleciona baseado em personaCondition
    variants: [
      { id: 'A_op1', copyFile: 'acts/act_02_promessa_mecanismo_op1.md', personaCondition: '1' },
      { id: 'A_op2', copyFile: 'acts/act_02_promessa_mecanismo_op2.md', personaCondition: '2' },
      { id: 'A_op3', copyFile: 'acts/act_02_promessa_mecanismo_op3.md', personaCondition: '3' },
      { id: 'A_op4', copyFile: 'acts/act_02_promessa_mecanismo_op4.md', personaCondition: '4' },
    ],
    templateVars: async () => ({}),
  },

  // ── Ato 3 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_03_first_analysis_template',
    description: 'Não é proativo — sufixo injetado na PRIMEIRA análise de texto/print do usuário',
    featureFlag: 'ENABLE_ACT_03_FIRST_ANALYSIS_TEMPLATE',
    isProactive: false, // engine ignora — chamado diretamente pelo fluxo de análise
    trigger:     null,
    variants:    [{ id: 'A', copyFile: 'acts/act_03_first_analysis_template.md' }],
    templateVars: async () => ({}),
  },

  // ── Ato 4 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_04_reveal_papo',
    description: 'Revela que o bot entende conversas além de prints — convite a descrever situação',
    featureFlag: 'ENABLE_ACT_04_REVEAL_PAPO',

    trigger: {
      conditions: async (ctx) => {
        if (await ctx.actAlreadySent('act_04_reveal_papo')) return false;
        const totalInteractions = await ctx.getTotalInteractions();
        if (totalInteractions < 3) return false;
        const hours = ctx.hoursSinceSignup();
        return hours >= 2 && hours <= 8;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [{ id: 'A', copyFile: 'acts/act_04_reveal_papo.md' }],
    templateVars: async () => ({}),
  },

  // ── Ato 5 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_05_identificacao_amplificada',
    description: 'Agitação de dor com prova social — Schwartz puro. Identifica o padrão de comportamento.',
    featureFlag: 'ENABLE_ACT_05_IDENTIFICACAO_AMPLIFICADA',

    trigger: {
      conditions: async (ctx) => {
        if (await ctx.actAlreadySent('act_05_identificacao_amplificada')) return false;
        const hours = ctx.hoursSinceSignup();
        if (hours < 12 || hours > 24) return false;
        const totalInteractions = await ctx.getTotalInteractions();
        return totalInteractions >= 5;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [
      { id: 'A', copyFile: 'acts/act_05_identificacao_amplificada.md' },
      { id: 'B', copyFile: 'variants/act_05_variant_b.md' },
    ],
    abTestSplit: [50, 50],
    templateVars: async (ctx) => ({
      N: String(await ctx.getTotalInteractions()),
    }),
  },

  // ── Ato 6 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_06_reveal_audit',
    description: 'Revela Auditoria de Perfil Próprio — feature exclusiva Parceiro Pro',
    featureFlag: 'ENABLE_ACT_06_REVEAL_AUDIT',

    trigger: {
      conditions: async (ctx) => {
        if (ctx.user.plan === 'parceiro_pro') return false;
        if (await ctx.actAlreadySent('act_06_reveal_audit')) return false;
        const printCount = await ctx.getPrintCount();
        if (printCount < 2) return false;
        const hours = ctx.hoursSinceSignup();
        return hours >= 24 && hours <= 36;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [
      { id: 'A', copyFile: 'acts/act_06_reveal_audit.md' },
      { id: 'B', copyFile: 'variants/act_06_variant_b.md' },
    ],
    abTestSplit: [50, 50],
    templateVars: async () => ({}),
  },

  // ── Ato 7 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_07_reveal_analise_dela',
    description: 'Revela Análise do Perfil Dela — feature Direto Pro',
    featureFlag: 'ENABLE_ACT_07_REVEAL_ANALISE_DELA',

    trigger: {
      conditions: async (ctx) => {
        if (ctx.user.plan === 'parceiro_pro') return false;
        if (await ctx.actAlreadySent('act_07_reveal_analise_dela')) return false;
        const auditDone = await ctx.getAuditCount();
        const hours = ctx.hoursSinceSignup();
        return (auditDone > 0 || hours >= 30) && hours <= 48;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [{ id: 'A', copyFile: 'acts/act_07_reveal_analise_dela.md' }],
    templateVars: async () => ({}),
  },

  // ── Ato 8 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_08_reveal_predate',
    description: 'Revela Coach Pré e Pós Encontro — Parceiro Pro',
    featureFlag: 'ENABLE_ACT_08_REVEAL_PREDATE',

    trigger: {
      conditions: async (ctx) => {
        if (ctx.user.plan === 'parceiro_pro') return false;
        if (await ctx.actAlreadySent('act_08_reveal_predate')) return false;
        const encounterMentioned = await ctx.hasEvent('encounter_mentioned');
        const hours = ctx.hoursSinceSignup();
        return (encounterMentioned || hours >= 36) && hours <= 60;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [{ id: 'A', copyFile: 'acts/act_08_reveal_predate.md' }],
    templateVars: async () => ({}),
  },

  // ── Ato 9 ──────────────────────────────────────────────────────────────────
  {
    id:          'act_09_sumario_uso',
    description: 'Sumário do que rolou nas 60h — prova performada acumulada antes da oferta',
    featureFlag: 'ENABLE_ACT_09_SUMARIO_USO',

    trigger: {
      conditions: async (ctx) => {
        if (!['trial', 'free'].includes(ctx.user.plan)) return false;
        if (await ctx.actAlreadySent('act_09_sumario_uso')) return false;
        const hours = ctx.hoursSinceSignup();
        return hours >= 60 && hours <= 66;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [{ id: 'A', copyFile: 'acts/act_09_sumario_uso.md' }],
    templateVars: async (ctx) => {
      const [prints, audits, analyses, papo, interactions] = await Promise.all([
        ctx.getPrintCount(),
        ctx.getAuditCount(),
        ctx.getHerAnalysisCount(),
        ctx.getPapoCount(),
        ctx.getTotalInteractions(),
      ]);
      const isPro     = ctx.user.plan === 'parceiro_pro';
      const proBlock  = isPro
        ? `\n✓ Teu perfil auditado — ${audits} mudanças sugeridas\n✓ ${analyses} perfis dela analisados com primeira mensagem certeira`
        : '';
      return {
        N_INTERACTIONS: String(interactions),
        N_PRINTS:       String(prints),
        N_PAPO:         String(papo),
        IF_PRO_BLOCK:   proBlock,
      };
    },
  },

  // ── Ato 10 ─────────────────────────────────────────────────────────────────
  {
    id:          'act_10_oferta',
    description: 'A oferta principal — Parceiro vs Parceiro Pro com stack de valor',
    featureFlag: 'ENABLE_ACT_10_OFERTA',

    trigger: {
      conditions: async (ctx) => {
        if (!['trial', 'free'].includes(ctx.user.plan)) return false;
        if (await ctx.actAlreadySent('act_10_oferta')) return false;
        const hours = ctx.hoursSinceSignup();
        return hours >= 66 && hours <= 70;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [
      { id: 'A', copyFile: 'acts/act_10_oferta.md' },
      { id: 'B', copyFile: 'variants/act_10_variant_b.md' },
    ],
    abTestSplit: [50, 50],
    templateVars: async (ctx) => ({
      LINK_PARCEIRO:     ctx.getCheckoutLink('parceiro'),
      LINK_PARCEIRO_PRO: ctx.getCheckoutLink('parceiro_pro'),
    }),
  },

  // ── Ato 11 ─────────────────────────────────────────────────────────────────
  {
    id:          'act_11_objecao_garantia',
    description: 'Quebra de objeções comuns + garantia — 2-4h depois da oferta',
    featureFlag: 'ENABLE_ACT_11_OBJECAO_GARANTIA',

    trigger: {
      conditions: async (ctx) => {
        if (!['trial', 'free'].includes(ctx.user.plan)) return false;
        if (await ctx.actAlreadySent('act_11_objecao_garantia')) return false;
        if (!await ctx.actAlreadySent('act_10_oferta')) return false;
        const hours = ctx.hoursSinceSignup();

        // Dispara 2h depois da oferta, ou se clicou link mas não converteu em 1h
        const act10Time = await ctx.getActSentTime('act_10_oferta');
        if (!act10Time) return false;
        const hoursSinceOffer = (Date.now() - act10Time.getTime()) / 3_600_000;

        const linkClicked = await ctx.hasEvent('link_clicked');
        if (linkClicked) {
          const clickTime = await ctx.getEventTime('link_clicked');
          if (clickTime) {
            const minutesSinceClick = (Date.now() - clickTime.getTime()) / 60_000;
            if (minutesSinceClick >= 60 && minutesSinceClick <= 90) return true;
          }
        }

        return hoursSinceOffer >= 2 && hours <= 71;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [{ id: 'A', copyFile: 'acts/act_11_objecao_garantia.md' }],
    templateVars: async () => ({}),
  },

  // ── Ato 12 ─────────────────────────────────────────────────────────────────
  {
    id:          'act_12_ultima_chamada',
    description: 'Última chamada 30min antes do trial acabar',
    featureFlag: 'ENABLE_ACT_12_ULTIMA_CHAMADA',
    isProactive: false, // inline-only — disparado quando usuário manda mensagem nos últimos 30min

    trigger: {
      conditions: async (ctx) => {
        if (ctx.user.plan !== 'trial') return false;
        if (await ctx.actAlreadySent('act_12_ultima_chamada')) return false;
        const hours = ctx.hoursSinceSignup();
        return hours >= 71.5 && hours <= 72;
      },
      cooldown_hours: 24,
      only_once:      true,
    },

    variants: [{ id: 'A', copyFile: 'acts/act_12_ultima_chamada.md' }],
    templateVars: async (ctx) => ({
      LINK_PARCEIRO_PRO: ctx.getCheckoutLink('parceiro_pro'),
      LINK_PARCEIRO:     ctx.getCheckoutLink('parceiro'),
    }),
  },

  // ── Ato 13 ─────────────────────────────────────────────────────────────────
  {
    id:          'act_13_reoferta_d1',
    description: 'Re-oferta no D+1 do free quando bate o limite diário',
    featureFlag: 'ENABLE_ACT_13_REOFERTA_D1',

    trigger: {
      conditions: async (ctx) => {
        if (ctx.user.plan !== 'free') return false;
        if (await ctx.actAlreadySent('act_13_reoferta_d1')) return false;

        const trialEndedTime = await ctx.getEventTime('trial_ended');
        if (!trialEndedTime) return false;
        const hoursSinceFree = (Date.now() - trialEndedTime.getTime()) / 3_600_000;
        if (hoursSinceFree < 24 || hoursSinceFree > 72) return false;

        return ctx.hitAnyLimitToday();
      },
      cooldown_hours: 48,
      only_once:      true,
    },

    variants: [{ id: 'A', copyFile: 'acts/act_13_reoferta_d1.md' }],
    templateVars: async (ctx) => ({
      LINK_PARCEIRO: ctx.getCheckoutLink('parceiro'),
    }),
  },
];

// ── Helpers de lookup ─────────────────────────────────────────────────────────

/** @param {string} actId @returns {ActDefinition|undefined} */
function getActById(actId) {
  return ACTS.find(a => a.id === actId);
}

/** Apenas atos proativos (disparados pela engine). */
const PROACTIVE_ACTS = ACTS.filter(a => a.isProactive !== false && a.trigger !== null);

module.exports = { ACTS, PROACTIVE_ACTS, getActById, parseUserChoice };
