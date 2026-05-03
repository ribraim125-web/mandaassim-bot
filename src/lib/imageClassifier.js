/**
 * imageClassifier.js — classifica tipo de imagem antes do pipeline principal
 *
 * Chamada rápida e barata (Gemini Flash Lite) para decidir:
 *   'conversation' → print de chat com balões de mensagem
 *   'profile'      → perfil de app de relacionamento ou rede social
 *   'ambiguous'    → foto comum, print genérico, ou não identificável
 *
 * Nunca lança exceção — retorna 'conversation' como fallback seguro em caso de erro.
 */

const OpenAI = require('openai');

let _openrouter = null;
function getOpenRouter() {
  if (!_openrouter) {
    _openrouter = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://mandaassim.com',
        'X-Title': 'MandaAssim',
      },
    });
  }
  return _openrouter;
}

const CLASSIFIER_PROMPT = `Look at this image and classify it as exactly one of three types:

"conversation" — screenshot of a chat app with message bubbles between two people (WhatsApp, Tinder chat, Bumble chat, Instagram DMs, etc.)

"profile" — screenshot showing a person's profile page on a dating app or social network: name, age, bio text, interests, photo grid, or swipe card (Tinder, Bumble, Hinge, Instagram profile, etc.)

"ambiguous" — a regular photo (not a screenshot), a screenshot that doesn't fit either above, or an unclear image

Respond with ONLY one word: conversation, profile, or ambiguous`;

/**
 * Classifica o tipo de imagem recebida.
 *
 * @param {string} base64Data — imagem em base64
 * @param {string} mimeType — ex: 'image/jpeg'
 * @returns {Promise<'conversation'|'profile'|'ambiguous'>}
 */
async function classificarTipoImagem(base64Data, mimeType) {
  try {
    const openrouter = getOpenRouter();
    const response = await openrouter.chat.completions.create({
      model: 'google/gemini-2.0-flash-lite-001',
      max_tokens: 5,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${base64Data}` },
            },
            { type: 'text', text: CLASSIFIER_PROMPT },
          ],
        },
      ],
    });

    const raw = (response.choices[0]?.message?.content || '').trim().toLowerCase();

    if (raw.includes('profile'))      return 'profile';
    if (raw.includes('ambiguous'))    return 'ambiguous';
    if (raw.includes('conversation')) return 'conversation';

    console.warn(`[ImageClassifier] Resposta inesperada: "${raw}" — fallback conversation`);
    return 'conversation';

  } catch (err) {
    console.error('[ImageClassifier] Erro na classificação:', err.message, '— fallback conversation');
    return 'conversation'; // fallback seguro
  }
}

module.exports = { classificarTipoImagem };
