/**
 * models.js — fonte única de verdade para as model strings do projeto.
 *
 * Cada modelo lê de uma env var (pra trocar sem deploy) com fallback pro
 * valor vigente. Substituímos os Gemini 2.0 (desligados pelo Google em
 * 01/06/2026) por `google/gemini-2.5-flash-lite` (substituto oficial, mesmo preço).
 *
 * NÃO mexer no MAIN_MODEL (geração principal / Haiku) sem cuidado.
 */
module.exports = {
  // Geração principal — Claude Haiku 4.5 (Anthropic direto).
  MAIN_MODEL:             process.env.MAIN_MODEL             || 'claude-haiku-4-5-20251001',
  // Mesma coisa, com prefixo de provedor usado no roteamento do index.js.
  MAIN_MODEL_ROUTED:      process.env.MAIN_MODEL_ROUTED      || 'anthropic/claude-haiku-4-5-20251001',

  // Classificador de intenção (toda mensagem passa por aqui).
  CLASSIFIER_MODEL:       process.env.CLASSIFIER_MODEL       || 'google/gemini-2.5-flash-lite',
  // Fallback da geração principal quando a Anthropic cai.
  FALLBACK_MODEL:         process.env.FALLBACK_MODEL         || 'google/gemini-2.5-flash-lite',
  // Visão — pipeline legado de análise de imagem (Gemini).
  VISION_LEGACY_MODEL:    process.env.VISION_LEGACY_MODEL    || 'google/gemini-2.5-flash-lite',
  // Classificador de imagem (self/other, print vs perfil).
  IMAGE_CLASSIFIER_MODEL: process.env.IMAGE_CLASSIFIER_MODEL || 'google/gemini-2.5-flash-lite',
  // Transcrição de áudio.
  AUDIO_MODEL:            process.env.AUDIO_MODEL            || 'google/gemini-2.5-flash-lite',
  // Parse de data (ex.: Pré-Date).
  DATE_PARSE_MODEL:       process.env.DATE_PARSE_MODEL       || 'google/gemini-2.5-flash-lite',
  // Utilitários curtos: perguntas de contexto, decisões sim/não, outcome.
  UTILITY_MODEL:          process.env.UTILITY_MODEL          || 'google/gemini-2.5-flash-lite',
};
