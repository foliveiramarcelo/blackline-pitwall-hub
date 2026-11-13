'use strict';
/* Blackline Pitwall — prompt da leitura das impressões do piloto (compartilhado entre o app e o servidor da equipe). */
function buildImpressions(d) {
    const syms = (d.symptoms || []).slice(0, 40), ids = syms.map((x) => x.id);
    const system = [
      'Você é o engenheiro virtual (engenheiro de pista) da equipe Blackline Motorsport no jogo Project Motor Racing, carros GT3.',
      'Sua tarefa: ler as impressões do piloto, escritas ou ditadas em português informal, e traduzi-las nos sintomas de setup da lista abaixo, para o app sugerir ajustes.',
      'Regras:',
      '- Use só os ids da lista. Um trecho pode gerar mais de um sintoma; não invente sintomas que o piloto não descreveu.',
      '- Interprete linguagem coloquial de piloto: "moroso/preguiçoso/demora para entrar/não aponta" = sai de frente na entrada (entry_us); "escapa/foge/lava de frente" = sai de frente; "traseira solta/nervosa/quer rodar" = sai de traseira; "pula/quica" = zebras ou ondulações; etc. Use a fase (entrada, meio, saída) e o tipo de curva (lenta/rápida) que o piloto citar; se não citar, escolha pela descrição e pela velocidade mínima das curvas no contexto.',
      '- Curvas: devolva os números que o piloto citou (ex.: "curvas 3,4 e 5" = [3,4,5]). Não converta para outra numeração.',
      '- intensidade: "leve" quando o piloto atenua ("bem pouco", "um pouco", "levemente"), "forte" quando enfatiza ("muito", "demais", "rodei"), senão "moderado".',
      '- Cruze com a evidência e os números da telemetria quando houver e diga numa frase se ela apoia ou não.',
      '- No campo parecer, responda ao piloto como engenheiro, em 2 a 5 frases: o que a telemetria confirma, o que ela não mostra ou contradiz (cite os números do contexto), e responda diretamente aos pedidos dele (por exemplo, "verificar a velocidade máxima": diga o valor medido e se parece baixo para a pista e o carro; "deixar o carro mais ágil": diga por onde começar). Não invente números que não estão no contexto.',
      '- Se algo não for de setup (erro de pilotagem, tráfego, estratégia), coloque em outros. Se faltar informação para decidir, faça até 2 perguntas curtas ao piloto.',
      '- Escreva em português do Brasil, frases curtas, sem jargão desnecessário.',
      '- Responda sempre chamando a ferramenta registrar_leitura uma única vez, sem texto fora dela.',
      '',
      'Base de engenharia (use para o parecer; recomende uma mudança por vez, a mais simples primeiro, SEMPRE em valores das métricas do setup — ex.: "barra traseira 40 → 30 N/mm", "+1,5 psi", "balanço 0,6% para trás" — e NUNCA em quantidade de cliques, porque o passo muda de carro para carro):',
      '- Transferência lateral de carga: o eixo mais rígido (mola/barra) perde aderência. Frente mais rígida = mais subesterço; traseira mais rígida = mais sobresterço. Barras são a ferramenta principal de equilíbrio em curva lenta; asa e inclinação (rake) mandam em curva rápida.',
      '- Entrada: balanço de freio (mais à frente = estável mas sai de frente e trava a dianteira), rampa de desaceleração do diferencial (no PMR ângulo menor = mais trava = mais estável e mais subesterço), compressão lenta dianteira e retorno lento traseiro, trail braking.',
      '- Saída: tração depende de diferencial (rampa de aceleração menor = mais trava), controle de tração (alto demais corta potência: acelerador no fundo e saída lenta), barra/mola traseira mais macia, pneus traseiros na janela.',
      '- Pneus GT3: janela de 70–95 °C; abaixo falta aderência, picos >105 °C na frente indicam travada/arrasto. Pressão quente alvo de referência 26–28 psi; maior = resposta rápida e menos contato, menor = mais aderência mecânica e resposta lenta.',
      '- Alinhamento: mais cambagem negativa = mais aderência lateral e menos em reta; no PMR baixar o carro deixa a cambagem exibida mais negativa. Divergência dianteira = entrada mais viva; convergência traseira = estabilidade.',
      '- Amortecedor mais duro num eixo age como barra mais dura naquele eixo durante a transição; rápidos controlam zebras e ondulações. Batente (bump stop) segura a plataforma em alta e nas freadas, mas endurece de repente quando encosta.',
      '- Asa traseira: mais asa = estável em alta e mais arrasto (menos reta); mais rake = balanço aero para a frente.',
      '- Ordem de prioridade: pilotagem/consistência, pressão, balanço de freio/TC/ABS, barras, asa e alturas, molas, diferencial, amortecedores, alinhamento.',
      '',
      'Sintomas disponíveis (id: descrição):',
      ...syms.map((x) => `${x.id}: ${x.label}${x.phase ? ' [' + x.phase + ']' : ''}${x.hint ? ' — ' + x.hint : ''}`)
    ].join('\n');
    const ctx = d.context || {};
    const user = [
      `Carro: ${ctx.car || '?'} · Pista: ${ctx.track || '?'} · Sessão: ${ctx.kind || '?'}`,
      ctx.corners && ctx.corners.length ? `Curvas detectadas pelo app (numeração do app, pode diferir da oficial) e velocidade mínima: ${ctx.corners.map((c) => `C${c.id} ${c.vmin} km/h`).join(', ')}` : '',
      ctx.tele ? `Números da telemetria desta sessão:\n${Object.entries(ctx.tele).filter(([, v]) => v != null && v !== '').map(([k, v]) => '- ' + k + ': ' + v).join('\n')}` : '',
      d.evidence && d.evidence.length ? `Evidência da telemetria:\n${d.evidence.map((x) => '- ' + x.sym + ': ' + x.txt).join('\n')}` : 'Evidência da telemetria: nenhuma relevante.',
      '', 'Impressões do piloto (entre as marcas <texto>):', '<texto>' + String(d.text).slice(0, 4000) + '</texto>'
    ].filter(Boolean).join('\n');
    const tool = { name: 'registrar_leitura', description: 'Registra a leitura do engenheiro sobre as impressões do piloto.', input_schema: { type: 'object', additionalProperties: false, required: ['resumo', 'parecer', 'sintomas'], properties: {
      resumo: { type: 'string', description: 'Uma ou duas frases: o que o piloto está sentindo, em linguagem de engenheiro.' },
      parecer: { type: 'string', description: 'Resposta do engenheiro ao piloto: o que a telemetria confirma ou não nas impressões, com números, e resposta direta aos pedidos dele. 2 a 5 frases.' },
      sintomas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sym', 'curvas', 'intensidade', 'citacao', 'explicacao'], properties: {
        sym: { type: 'string', enum: ids }, curvas: { type: 'array', items: { type: 'integer' } }, intensidade: { type: 'string', enum: ['leve', 'moderado', 'forte'] },
        citacao: { type: 'string', description: 'Trecho do texto do piloto que gerou o sintoma.' }, explicacao: { type: 'string', description: 'Por que esse trecho é esse sintoma, e se a telemetria apoia. Uma frase.' } } } },
      outros: { type: 'array', items: { type: 'string' }, description: 'Pontos que não são de setup.' },
      perguntas: { type: 'array', items: { type: 'string' }, maxItems: 2, description: 'Perguntas curtas ao piloto, se faltar informação.' } } } };
    return { system, user, tool, ids, maxTokens: 4000 };
}
// alguns modelos não aceitam forçar a ferramenta: pede a ferramenta em modo automático e, se vier texto, tenta ler o JSON
function pickResult(content, toolName) {
  const tu = (content || []).find((b) => b.type === 'tool_use' && (!toolName || !b.name || b.name === toolName));
  if (tu) return tu.input;
  const txt = (content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const m = txt.match(/\{[\s\S]*\}/); if (!m) return null;
  try { const j = JSON.parse(m[0]); return j && Array.isArray(j.sintomas) ? j : null; } catch (e) { return null; }
}
function cleanResult(result, ids) { if (result && Array.isArray(result.sintomas)) result.sintomas = result.sintomas.filter((x) => ids.includes(x.sym)); return result; }
module.exports = { buildImpressions, cleanResult, pickResult };
