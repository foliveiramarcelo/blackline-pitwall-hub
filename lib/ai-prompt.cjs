'use strict';
/* Blackline Pitwall — prompt da leitura das impressões do piloto (compartilhado entre o app e o servidor da equipe). */
function buildImpressions(d) {
    const syms = (d.symptoms || []).slice(0, 40), ids = syms.map((x) => x.id);
    const system = [
      'Você é o engenheiro de pista (race engineer) da equipe Blackline Motorsport no jogo Project Motor Racing, carros GT3.',
      'Sua tarefa: ler as impressões do piloto, escritas ou ditadas em português informal, e traduzi-las nos sintomas de setup da lista abaixo, para o app sugerir ajustes.',
      'Regras:',
      '- Use só os ids da lista. Um trecho pode gerar mais de um sintoma; não invente sintomas que o piloto não descreveu.',
      '- Interprete linguagem coloquial de piloto: "moroso/preguiçoso/demora para entrar/não aponta" = sai de frente na entrada (entry_us); "escapa/foge/lava de frente" = sai de frente; "traseira solta/nervosa/quer rodar" = sai de traseira; "pula/quica" = zebras ou ondulações; etc. Use a fase (entrada, meio, saída) e o tipo de curva (lenta/rápida) que o piloto citar; se não citar, escolha pela descrição e pela velocidade mínima das curvas no contexto.',
      '- Curvas: devolva os números que o piloto citou (ex.: "curvas 3,4 e 5" = [3,4,5]). Não converta para outra numeração.',
      '- intensidade: "leve" quando o piloto atenua ("bem pouco", "um pouco", "levemente"), "forte" quando enfatiza ("muito", "demais", "rodei"), senão "moderado".',
      '- Cruze com a evidência da telemetria quando houver e diga numa frase se ela apoia ou não.',
      '- Se algo não for de setup (erro de pilotagem, tráfego, estratégia), coloque em outros. Se faltar informação para decidir, faça até 2 perguntas curtas ao piloto.',
      '- Escreva em português do Brasil, frases curtas, sem jargão desnecessário.',
      '',
      'Sintomas disponíveis (id: descrição):',
      ...syms.map((x) => `${x.id}: ${x.label}${x.phase ? ' [' + x.phase + ']' : ''}${x.hint ? ' — ' + x.hint : ''}`)
    ].join('\n');
    const ctx = d.context || {};
    const user = [
      `Carro: ${ctx.car || '?'} · Pista: ${ctx.track || '?'} · Sessão: ${ctx.kind || '?'}`,
      ctx.corners && ctx.corners.length ? `Curvas detectadas pelo app (numeração do app, pode diferir da oficial) e velocidade mínima: ${ctx.corners.map((c) => `C${c.id} ${c.vmin} km/h`).join(', ')}` : '',
      d.evidence && d.evidence.length ? `Evidência da telemetria:\n${d.evidence.map((x) => '- ' + x.sym + ': ' + x.txt).join('\n')}` : 'Evidência da telemetria: nenhuma relevante.',
      '', 'Impressões do piloto (entre as marcas <texto>):', '<texto>' + String(d.text).slice(0, 4000) + '</texto>'
    ].filter(Boolean).join('\n');
    const tool = { name: 'registrar_leitura', description: 'Registra a leitura do engenheiro sobre as impressões do piloto.', input_schema: { type: 'object', additionalProperties: false, required: ['resumo', 'sintomas'], properties: {
      resumo: { type: 'string', description: 'Uma ou duas frases: o que o piloto está sentindo, em linguagem de engenheiro.' },
      sintomas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['sym', 'curvas', 'intensidade', 'citacao', 'explicacao'], properties: {
        sym: { type: 'string', enum: ids }, curvas: { type: 'array', items: { type: 'integer' } }, intensidade: { type: 'string', enum: ['leve', 'moderado', 'forte'] },
        citacao: { type: 'string', description: 'Trecho do texto do piloto que gerou o sintoma.' }, explicacao: { type: 'string', description: 'Por que esse trecho é esse sintoma, e se a telemetria apoia. Uma frase.' } } } },
      outros: { type: 'array', items: { type: 'string' }, description: 'Pontos que não são de setup.' },
      perguntas: { type: 'array', items: { type: 'string' }, maxItems: 2, description: 'Perguntas curtas ao piloto, se faltar informação.' } } } };
    return { system, user, tool, ids, maxTokens: 1500 };
}
function cleanResult(result, ids) { if (result && Array.isArray(result.sintomas)) result.sintomas = result.sintomas.filter((x) => ids.includes(x.sym)); return result; }
module.exports = { buildImpressions, cleanResult };
