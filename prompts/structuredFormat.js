/**
 * structuredFormat.js — ajuste de formato pro caminho de SAÍDA ESTRUTURADA.
 *
 * Aplica-se a QUALQUER modelo que gere via structured output (tool use no
 * Haiku, json_schema no GPT-5 mini). Substitui a mecânica antiga de "imprima
 * 🎯/⎯⎯⎯ em texto livre" por uma nota curta — porque com structured output o
 * modelo preenche campos, e a instrução velha faz ele às vezes enfiar
 * emoji/header DENTRO do campo `mensagem`.
 *
 * Preserva role, mission, tonalidades (tons + limite de palavras), voz,
 * exemplos e safety — IDÊNTICOS. Nenhuma regra de produto nova.
 *
 * O SYSTEM_PROMPT original (index.js) continua intacto e é a fonte da verdade;
 * isto é uma derivação aplicada só no momento da chamada estruturada.
 */

// Substitui o miolo do <output_format> (só a mecânica de formato).
const OUTPUT_FORMAT_ESTRUTURADO = `<output_format>
Você devolve a resposta de forma ESTRUTURADA (o sistema cuida do formato visual).
Para cada opção, você fornece o tom e a mensagem pronta. O campo da mensagem leva
SOMENTE o texto pronto pra ele copiar e mandar — sem emoji de tom, sem header, sem
"⎯⎯⎯", sem aspas, sem ponto final. As regras de escolha de tom e limite de palavras
da seção <tonalidades> continuam valendo integralmente. Normalmente 3 opções com
tons diferentes que se encaixem na situação.
</output_format>`;

/**
 * Deriva o prompt pro caminho estruturado, trocando só a mecânica de formato.
 * @param {string} original — system prompt original (fonte da verdade)
 * @returns {string}
 */
function aplicarFormatoEstruturado(original) {
  return String(original).replace(/<output_format>[\s\S]*?<\/output_format>/, OUTPUT_FORMAT_ESTRUTURADO);
}

module.exports = { aplicarFormatoEstruturado, OUTPUT_FORMAT_ESTRUTURADO };
