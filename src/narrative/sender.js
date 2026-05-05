/**
 * sender.js — envia mensagens da engine narrativa com efeito dopamínico
 *
 * Cada mensagem (bloco separado por --- no .md) é enviada com delay aleatório
 * de 1.5s a 3s, simulando digitação humana. Cria efeito de "mensagem chegando
 * em ondas" ao invés de tudo de uma vez.
 */

'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;
let _supabase = null;

function setClient(client) { _client = client; }
function getSupabase() {
  if (!_supabase) _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
  return _supabase;
}

const MIN_DELAY_MS = 1_500;
const MAX_DELAY_MS = 3_000;

function randomDelay() {
  return MIN_DELAY_MS + Math.floor(Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Busca o wa_chat_id salvo do usuário (evita erros de LID).
 * @param {string} phone
 * @returns {Promise<string>}
 */
async function getChatId(phone) {
  try {
    const { data } = await getSupabase()
      .from('users')
      .select('wa_chat_id')
      .eq('phone', phone)
      .maybeSingle();
    return data?.wa_chat_id || `${phone}@c.us`;
  } catch (_) {
    return `${phone}@c.us`;
  }
}

/**
 * Envia um array de mensagens para o usuário com delays entre elas.
 * Retorna true se todas foram enviadas, false se alguma falhou.
 *
 * @param {string} phone
 * @param {string[]} messages — array de strings, uma por mensagem WhatsApp
 * @returns {Promise<boolean>}
 */
async function sendNarrativeMessages(phone, messages) {
  if (!_client) {
    console.error('[NarrativeSender] Cliente WhatsApp não configurado. Chame setClient(client) primeiro.');
    return false;
  }

  if (!messages || messages.length === 0) return true;

  const chatId = await getChatId(phone);

  let allSent = true;
  for (let i = 0; i < messages.length; i++) {
    try {
      // Delay antes de cada mensagem (exceto a primeira, que já tem delay natural)
      if (i > 0) await sleep(randomDelay());

      await _client.sendMessage(chatId, messages[i]);
    } catch (err) {
      console.error(`[NarrativeSender] Erro ao enviar msg ${i + 1}/${messages.length} para ${phone}:`, err.message);
      allSent = false;
    }
  }

  return allSent;
}

module.exports = { setClient, sendNarrativeMessages };
