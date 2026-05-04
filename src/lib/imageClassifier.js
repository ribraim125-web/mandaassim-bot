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

// ── Classificador: perfil próprio vs perfil dela ──────────────────────────────

const SELF_VS_OTHER_PROMPT = `Look at this dating app profile screenshot.

Determine if this is the user's OWN profile (they are showing their own profile for review) or SOMEONE ELSE'S profile (they are showing a woman's profile they want to message).

"self" — signals:
- Edit/pencil buttons, "Edit Profile", boost buttons visible
- Profile creation or settings interface
- The profile clearly shows a man (male photos, male name)
- "Your profile" or similar UI text visible

"other" — signals:
- Female name and/or female photos
- Swipe card interface (Like/Nope buttons)
- Profile viewed in browse/discover mode
- No edit buttons visible, just viewing mode

"ambiguous" — when:
- Can't determine gender
- No clear UI indicators
- Image is cropped or unclear

Respond with ONLY one word: self, other, or ambiguous`;

/**
 * Classifica se o perfil é do próprio usuário ou de outra pessoa.
 *
 * @param {string} base64Data
 * @param {string} mimeType
 * @returns {Promise<'self'|'other'|'ambiguous'>}
 */
async function classificarPerfilSelfVsOther(base64Data, mimeType) {
  try {
    const openrouter = getOpenRouter();
    const response = await openrouter.chat.completions.create({
      model: 'google/gemini-2.0-flash-lite-001',
      max_tokens: 5,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}` } },
          { type: 'text', text: SELF_VS_OTHER_PROMPT },
        ],
      }],
    });

    const raw = (response.choices[0]?.message?.content || '').trim().toLowerCase();

    if (raw.includes('self'))      return 'self';
    if (raw.includes('other'))     return 'other';
    if (raw.includes('ambiguous')) return 'ambiguous';

    console.warn(`[ImageClassifier] selfVsOther resposta inesperada: "${raw}" — fallback other`);
    return 'other';

  } catch (err) {
    console.error('[ImageClassifier] Erro em selfVsOther:', err.message, '— fallback other');
    return 'other';
  }
}

module.exports = { classificarTipoImagem, classificarPerfilSelfVsOther };
