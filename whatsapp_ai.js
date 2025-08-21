const { OpenAI } = require("openai");

class WhatsAppAI {
  constructor(apiKey) {
    this.openai = new OpenAI({ apiKey });
    this.comprovantesEmAberto = {};
    this.historicoMensagens = [];
    this.maxHistorico = 200; // AUMENTADO: 200 mensagens para melhor histórico
    
    // Limpeza automática a cada 10 minutos
    setInterval(() => {
      this.limparComprovantesAntigos();
    }, 10 * 60 * 1000);
    
    console.log('🧠 IA WhatsApp inicializada com legendas melhoradas e histórico expandido');
  }

  // === EXTRAIR PREÇOS DA TABELA ===
  extrairPrecosTabela(tabelaTexto) {
    console.log(`   📋 Extraindo preços da tabela...`);
    
    const precos = [];
    const linhas = tabelaTexto.split('\n');
    
    for (const linha of linhas) {
      // Padrões para detectar preços - MELHORADOS
      const padroes = [
        // Formato: 1G. 16MT, 2G. 32MT, etc
        /(\d+)G[B\.]?\s*[➔→\-]*\s*(\d+)MT/gi,
        // Formato: 1024MB 16MT, 2048MB 32MT, etc  
        /(\d+)MB\s*[➔→\-💎]*\s*(\d+)MT/gi,
        // Formato: 12.8GB 250MT, 22.8GB 430MT, etc
        /(\d+\.?\d*)GB\s*[➔→\-💎]*\s*(\d+)MT/gi,
        // Formato: 10GB➜125MT
        /(\d+)GB➜(\d+)MT/gi,
        // Formato com emojis: 📱 10GB➜125MT
        /📱\s*(\d+)GB➜(\d+)MT/gi,
        // Formato: 50💫 45MT (para saldo)
        /(\d+)💫\s*(\d+)MT/gi,
        // Novos padrões para maior compatibilidade
        /(\d+)\s*GB?\s*[-–—]\s*(\d+)\s*MT/gi,
        /(\d+)\s*MB?\s*[-–—]\s*(\d+)\s*MT/gi
      ];
      
      for (const padrao of padroes) {
        let match;
        while ((match = padrao.exec(linha)) !== null) {
          const quantidade = parseFloat(match[1]);
          const preco = parseInt(match[2]);
          
          // Determinar unidade e converter para MB se necessário
          let quantidadeMB = quantidade;
          let descricao = '';
          
          if (linha.toLowerCase().includes('gb') || linha.toLowerCase().includes('giga')) {
            quantidadeMB = quantidade * 1024;
            descricao = `${quantidade}GB`;
          } else if (linha.toLowerCase().includes('mb') || linha.toLowerCase().includes('mega')) {
            quantidadeMB = quantidade;
            descricao = `${quantidade}MB`;
          } else if (linha.includes('💫')) {
            descricao = `${quantidade} Saldo`;
            quantidadeMB = 0;
          } else {
            quantidadeMB = quantidade * 1024;
            descricao = `${quantidade}GB`;
          }
          
          // Determinar tipo de pacote
          let tipo = 'diario';
          if (linha.toLowerCase().includes('mensal') || linha.toLowerCase().includes('30 dias')) {
            tipo = 'mensal';
          } else if (linha.toLowerCase().includes('semanal') || linha.toLowerCase().includes('7 dias')) {
            tipo = 'semanal';
          } else if (linha.toLowerCase().includes('diamante')) {
            tipo = 'diamante';
          } else if (linha.includes('💫')) {
            tipo = 'saldo';
          }
          
          precos.push({
            quantidade: quantidadeMB,
            preco: preco,
            descricao: descricao,
            tipo: tipo,
            original: linha.trim()
          });
        }
      }
    }
    
    // Remover duplicatas e ordenar por preço
    const precosUnicos = precos.filter((preco, index, self) => 
      index === self.findIndex(p => p.preco === preco.preco && p.quantidade === preco.quantidade)
    ).sort((a, b) => a.preco - b.preco);
    
    console.log(`   ✅ Preços extraídos: ${precosUnicos.length} pacotes encontrados`);
    
    return precosUnicos;
  }

  // === FUNÇÃO MELHORADA PARA EXTRAIR NÚMEROS DE LEGENDAS ===
  extrairNumerosDeLegenda(legendaImagem) {
    console.log(`   🔍 LEGENDA: Analisando "${legendaImagem}"`);
    
    if (!legendaImagem || typeof legendaImagem !== 'string' || legendaImagem.trim().length === 0) {
      console.log(`   ❌ LEGENDA: Vazia ou inválida`);
      return [];
    }
    
    // Limpar a legenda de forma mais robusta
    let legendaLimpa = legendaImagem
      .replace(/[📱📲📞☎️🔢💳🎯🤖✅❌⏳💰📊💵📋⚡]/g, ' ') // Remover emojis comuns
      .replace(/\s+/g, ' ') // Normalizar espaços
      .trim();
    
    console.log(`   📝 LEGENDA: Limpa "${legendaLimpa}"`);
    
    // Buscar números de 9 dígitos que começam com 8
    const regexNumeros = /\b8[0-9]{8}\b/g;
    const numerosEncontrados = legendaLimpa.match(regexNumeros) || [];
    
    if (numerosEncontrados.length === 0) {
      console.log(`   ❌ LEGENDA: Nenhum número encontrado`);
      return [];
    }
    
    console.log(`   📱 LEGENDA: Números brutos encontrados: ${numerosEncontrados.join(', ')}`);
    
    const numerosValidos = [];
    
    for (const numero of numerosEncontrados) {
      const posicao = legendaLimpa.indexOf(numero);
      const comprimentoLegenda = legendaLimpa.length;
      
      console.log(`   🔍 LEGENDA: Analisando ${numero} na posição ${posicao}/${comprimentoLegenda}`);
      
      // Contexto antes e depois do número
      const contextoBefore = legendaLimpa.substring(Math.max(0, posicao - 30), posicao).toLowerCase();
      const contextoAfter = legendaLimpa.substring(posicao + numero.length, posicao + numero.length + 30).toLowerCase();
      const contextoCompleto = (contextoBefore + contextoAfter).toLowerCase();
      
      console.log(`   📖 LEGENDA: Contexto antes: "${contextoBefore}"`);
      console.log(`   📖 LEGENDA: Contexto depois: "${contextoAfter}"`);
      
      // PALAVRAS QUE INDICAM NÚMERO DE PAGAMENTO (REJEITAR)
      const indicadoresPagamento = [
        'transferiste', 'para o número', 'para número', 'para conta',
        'beneficiário', 'destinatario', 'nome:', 'mpesa:', 'emola:',
        'pagar para', 'enviou para', 'taxa foi', 'conta de'
      ];
      
      // PALAVRAS QUE INDICAM NÚMERO DE DESTINO (ACEITAR)
      const indicadoresDestino = [
        'para receber', 'manda para', 'enviar para', 'envia para',
        'ativar para', 'activar para', 'este número', 'este numero',
        'número:', 'numero:', 'megas para', 'dados para', 'comprovante'
      ];
      
      // PADRÕES ESPECÍFICOS PARA LEGENDAS
      const padroesTipicos = [
        new RegExp(`comprovante\\s*${numero}`, 'i'),
        new RegExp(`${numero}\\s*comprovante`, 'i'),
        new RegExp(`numero\\s*${numero}`, 'i'),
        new RegExp(`${numero}\\s*numero`, 'i'),
        new RegExp(`^${numero}$`, 'i'), // Número isolado
        new RegExp(`${numero}\\s*$`, 'i'), // Número no final
        new RegExp(`^\\s*${numero}`, 'i') // Número no início
      ];
      
      // Verificar indicadores
      const eNumeroPagamento = indicadoresPagamento.some(indicador => 
        contextoCompleto.includes(indicador)
      );
      
      const eNumeroDestino = indicadoresDestino.some(indicador => 
        contextoCompleto.includes(indicador)
      );
      
      const temPadraoTipico = padroesTipicos.some(padrao => 
        padrao.test(legendaLimpa)
      );
      
      // NOVA LÓGICA: Verificar se está no final da legenda (mais provável ser destino)
      const percentualPosicao = (posicao / comprimentoLegenda) * 100;
      const estaNofinal = percentualPosicao > 70; // Últimos 30% da legenda
      
      console.log(`   📊 LEGENDA: Está no final (>70%): ${estaNofinal} (${percentualPosicao.toFixed(1)}%)`);
      console.log(`   📊 LEGENDA: É número de pagamento: ${eNumeroPagamento}`);
      console.log(`   📊 LEGENDA: É número de destino: ${eNumeroDestino}`);
      console.log(`   📊 LEGENDA: Tem padrão típico: ${temPadraoTipico}`);
      
      // LÓGICA DE DECISÃO MELHORADA PARA LEGENDAS
      if (eNumeroDestino || temPadraoTipico) {
        numerosValidos.push(numero);
        console.log(`   ✅ LEGENDA: ACEITO por contexto/padrão: ${numero}`);
      } else if (eNumeroPagamento) {
        console.log(`   ❌ LEGENDA: REJEITADO por ser pagamento: ${numero}`);
      } else if (estaNofinal) {
        // Se está no final e não é claramente pagamento, assumir destino
        numerosValidos.push(numero);
        console.log(`   ✅ LEGENDA: ACEITO por estar no final: ${numero}`);
      } else {
        // Para legendas, ser mais permissivo que mensagens de texto
        numerosValidos.push(numero);
        console.log(`   ✅ LEGENDA: ACEITO por padrão permissivo: ${numero}`);
      }
    }
    
    // Remover duplicatas
    const numerosUnicos = [...new Set(numerosValidos)];
    console.log(`   📱 LEGENDA: Números válidos finais: ${numerosUnicos.join(', ')}`);
    
    return numerosUnicos;
  }

  // === EXTRAIR NÚMEROS DE TEXTO (MELHORADO) ===
  extrairTodosNumeros(mensagem) {
    console.log(`   🔍 TEXTO: Extraindo números da mensagem...`);
    
    if (!mensagem || typeof mensagem !== 'string') {
      console.log(`   ❌ TEXTO: Mensagem inválida`);
      return [];
    }
    
    // Procurar números de 9 dígitos que começam com 8
    const regex = /\b8[0-9]{8}\b/g;
    const matches = mensagem.match(regex);
    
    if (!matches || matches.length === 0) {
      console.log(`   ❌ TEXTO: Nenhum número encontrado`);
      return [];
    }
    
    console.log(`   📱 TEXTO: Números brutos encontrados: ${matches.join(', ')}`);
    
    const numerosValidos = [];
    
    for (const numero of matches) {
      const posicao = mensagem.indexOf(numero);
      const tamanhoMensagem = mensagem.length;
      const percentualPosicao = (posicao / tamanhoMensagem) * 100;
      
      console.log(`   🔍 TEXTO: Analisando ${numero} na posição ${posicao}/${tamanhoMensagem} (${percentualPosicao.toFixed(1)}%)`);
      
      const contextoBefore = mensagem.substring(Math.max(0, posicao - 50), posicao).toLowerCase();
      const contextoAfter = mensagem.substring(posicao + numero.length, posicao + numero.length + 50).toLowerCase();
      
      // PALAVRAS QUE INDICAM NÚMERO DE PAGAMENTO (IGNORAR)
      const indicadoresPagamento = [
        'transferiste', 'taxa foi', 'para o número', 'para número', 'para conta',
        'conta de', 'beneficiário', 'destinatario', 'nome:', 'para 8'
      ];
      
      // PALAVRAS QUE INDICAM NÚMERO DE DESTINO (USAR)
      const indicadoresDestino = [
        'megas para', 'manda para', 'enviar para', 'envia para', 
        'ativar para', 'este número', 'este numero', 'receber',
        'activar para', 'ativa para', 'para receber'
      ];
      
      const eNumeroPagamento = indicadoresPagamento.some(indicador => 
        contextoBefore.includes(indicador)
      );
      
      const eNumeroDestino = indicadoresDestino.some(indicador => {
        const contextoCompleto = contextoBefore + contextoAfter;
        return contextoCompleto.includes(indicador);
      });
      
      // LÓGICA ESPECIAL: Número isolado no final da mensagem
      const estaNofinalAbsoluto = posicao > tamanhoMensagem * 0.8;
      const contextoAposFinal = contextoAfter.trim();
      const estaIsoladoNoFinal = estaNofinalAbsoluto && (contextoAposFinal === '' || contextoAposFinal.length < 10);
      
      console.log(`   📊 TEXTO: No final absoluto (>80%): ${estaNofinalAbsoluto}`);
      console.log(`   📊 TEXTO: Isolado no final: ${estaIsoladoNoFinal}`);
      console.log(`   📊 TEXTO: É pagamento: ${eNumeroPagamento}`);
      console.log(`   📊 TEXTO: É destino: ${eNumeroDestino}`);
      
      if (eNumeroDestino) {
        numerosValidos.push(numero);
        console.log(`   ✅ TEXTO: ACEITO por contexto de destino: ${numero}`);
      } else if (eNumeroPagamento) {
        console.log(`   ❌ TEXTO: REJEITADO por ser pagamento: ${numero}`);
      } else if (estaIsoladoNoFinal) {
        numerosValidos.push(numero);
        console.log(`   ✅ TEXTO: ACEITO por estar isolado no final: ${numero}`);
      } else if (estaNofinalAbsoluto && !eNumeroPagamento) {
        numerosValidos.push(numero);
        console.log(`   ✅ TEXTO: ACEITO por estar no final: ${numero}`);
      } else {
        console.log(`   ❌ TEXTO: REJEITADO por ser ambíguo: ${numero}`);
      }
    }
    
    // Remover duplicatas
    const numerosUnicos = [...new Set(numerosValidos)];
    console.log(`   📱 TEXTO: Números válidos finais: ${numerosUnicos.join(', ')}`);
    
    return numerosUnicos;
  }

  // === SEPARAR COMPROVANTE E NÚMEROS (CORRIGIDO) ===
  separarComprovanteENumeros(mensagem, ehLegenda = false) {
    console.log(`   🔍 Separando comprovante e números ${ehLegenda ? '(LEGENDA)' : '(TEXTO)'}...`);
    
    if (!mensagem || typeof mensagem !== 'string') {
      console.log(`   ❌ Mensagem inválida para separação`);
      return { textoComprovante: '', numeros: [] };
    }
    
    // Usar função específica para legendas
    const numeros = ehLegenda ? 
      this.extrairNumerosDeLegenda(mensagem) : 
      this.extrairTodosNumeros(mensagem);
    
    // Criar texto do comprovante removendo números e contexto
    let textoComprovante = mensagem;
    
    for (const numero of numeros) {
      // Remover o número e possível contexto ao redor
      const padroes = [
        new RegExp(`\\s*megas? para\\s*${numero}\\s*`, 'gi'),
        new RegExp(`\\s*manda para\\s*${numero}\\s*`, 'gi'),
        new RegExp(`\\s*envia para\\s*${numero}\\s*`, 'gi'),
        new RegExp(`\\s*enviar para\\s*${numero}\\s*`, 'gi'),
        new RegExp(`\\s*este\\s+número\\s*${numero}\\s*`, 'gi'),
        new RegExp(`\\s*número\\s*${numero}\\s*`, 'gi'),
        new RegExp(`\\s*numero\\s*${numero}\\s*`, 'gi'),
        new RegExp(`\\s*comprovante\\s*${numero}\\s*`, 'gi'),
        new RegExp(`\\s*${numero}\\s*`, 'gi'), // Número no final
        new RegExp(`\\s+${numero}\\s*`, 'gi') // Número com espaços
      ];
      
      for (const padrao of padroes) {
        textoComprovante = textoComprovante.replace(padrao, ' ');
      }
    }
    
    // Limpar espaços extras
    textoComprovante = textoComprovante.replace(/\s+/g, ' ').trim();
    
    console.log(`   📄 Texto do comprovante: ${textoComprovante.substring(0, 50)}...`);
    console.log(`   📱 Números extraídos: ${numeros.join(', ')}`);
    
    return {
      textoComprovante: textoComprovante,
      numeros: numeros
    };
  }

  // === ANALISAR DIVISÃO AUTOMÁTICA ===
  async analisarDivisaoAutomatica(valorPago, configGrupo) {
    console.log(`   🧮 Analisando divisão automática para ${valorPago}MT...`);
    
    try {
      const precos = this.extrairPrecosTabela(configGrupo.tabela);
      
      if (precos.length === 0) {
        console.log(`   ❌ Nenhum preço encontrado na tabela do grupo`);
        return { deveDividir: false, motivo: 'Não foi possível extrair preços da tabela' };
      }
      
      const valorNumerico = parseFloat(valorPago);
      
      // Verificar se o valor é exatamente um pacote
      const pacoteExato = precos.find(p => p.preco === valorNumerico);
      if (pacoteExato) {
        console.log(`   ⚡ Valor exato para: ${pacoteExato.descricao}`);
        return { deveDividir: false, motivo: `Valor corresponde exatamente a ${pacoteExato.descricao}` };
      }
      
      // Tentar encontrar divisões otimizadas
      const divisoes = this.encontrarMelhoresDivisoes(valorNumerico, precos);
      
      if (divisoes.length > 0) {
        const melhorDivisao = divisoes[0];
        
        if (melhorDivisao.pacotes.length > 1 && melhorDivisao.valorRestante <= 15) {
          console.log(`   ✅ Divisão encontrada: ${melhorDivisao.descricao}`);
          
          return {
            deveDividir: true,
            pacotes: melhorDivisao.pacotes,
            valorTotalUsado: melhorDivisao.valorUsado,
            valorRestante: melhorDivisao.valorRestante,
            divisaoCompleta: melhorDivisao.descricao,
            mensagemCliente: `Detectei que seu valor de ${valorPago}MT pode ser dividido em: ${melhorDivisao.descricao}. Envie os números para ativação!`,
            motivo: 'Divisão otimizada encontrada'
          };
        }
      }
      
      console.log(`   ❌ Nenhuma divisão eficiente encontrada`);
      return { 
        deveDividir: false, 
        motivo: 'Não foi possível encontrar divisão eficiente com os preços disponíveis'
      };
      
    } catch (error) {
      console.error('❌ Erro ao analisar divisão automática:', error);
      return { deveDividir: false, motivo: 'Erro na análise' };
    }
  }

  // === ENCONTRAR MELHORES DIVISÕES ===
  encontrarMelhoresDivisoes(valorTotal, precos) {
    console.log(`   🔍 Procurando divisões para ${valorTotal}MT...`);
    
    const divisoes = [];
    
    const encontrarCombinacoes = (valorRestante, pacotesUsados, nivelRecursao = 0) => {
      if (nivelRecursao > 5) return;
      
      if (valorRestante <= 15 && pacotesUsados.length > 0) {
        const valorUsado = valorTotal - valorRestante;
        const descricao = this.gerarDescricaoDivisao(pacotesUsados);
        
        divisoes.push({
          pacotes: [...pacotesUsados],
          valorUsado: valorUsado,
          valorRestante: valorRestante,
          descricao: descricao,
          eficiencia: valorUsado / valorTotal
        });
        return;
      }
      
      for (const preco of precos) {
        if (preco.preco <= valorRestante && preco.tipo !== 'saldo') {
          const novosPacotes = [...pacotesUsados];
          
          const pacoteExistente = novosPacotes.find(p => p.preco === preco.preco);
          if (pacoteExistente) {
            pacoteExistente.quantidade++;
          } else {
            novosPacotes.push({
              descricao: preco.descricao,
              preco: preco.preco,
              quantidade: 1,
              tipo: preco.tipo
            });
          }
          
          encontrarCombinacoes(valorRestante - preco.preco, novosPacotes, nivelRecursao + 1);
        }
      }
    };
    
    encontrarCombinacoes(valorTotal, []);
    
    divisoes.sort((a, b) => {
      if (Math.abs(a.eficiencia - b.eficiencia) < 0.1) {
        return a.pacotes.length - b.pacotes.length;
      }
      return b.eficiencia - a.eficiencia;
    });
    
    console.log(`   📊 ${divisoes.length} divisões encontradas`);
    
    return divisoes.slice(0, 5);
  }

  // === GERAR DESCRIÇÃO DA DIVISÃO ===
  gerarDescricaoDivisao(pacotes) {
    const grupos = {};
    
    pacotes.forEach(pacote => {
      const chave = `${pacote.descricao}-${pacote.preco}`;
      if (grupos[chave]) {
        grupos[chave].quantidade += pacote.quantidade;
      } else {
        grupos[chave] = { ...pacote };
      }
    });
    
    const descricoes = Object.values(grupos).map(grupo => {
      if (grupo.quantidade > 1) {
        return `${grupo.quantidade}x ${grupo.descricao}`;
      } else {
        return `1x ${grupo.descricao}`;
      }
    });
    
    return descricoes.join(' + ');
  }

  // === ANALISAR PEDIDOS ESPECÍFICOS ===
  analisarPedidosEspecificos(mensagem, configGrupo) {
    console.log(`   🔍 Analisando pedidos específicos na mensagem...`);
    
    const precos = this.extrairPrecosTabela(configGrupo.tabela);
    if (precos.length === 0) {
      console.log(`   ❌ Sem tabela de preços para análise`);
      return null;
    }
    
    // Padrões melhorados para pedidos específicos
    const padroesPedidos = [
      // Formato: quantidade + unidade + número
      /(\d+(?:\.\d+)?)\s*(gb|g|giga|gigas?|mb|m|mega|megas?)\s+([8][0-9]{8})/gi,
      // Formato: número + quantidade + unidade
      /([8][0-9]{8})\s+(\d+(?:\.\d+)?)\s*(gb|g|giga|gigas?|mb|m|mega|megas?)/gi,
      // Formato com "para": 2gb para 852413946
      /(\d+(?:\.\d+)?)\s*(gb|g|giga|gigas?|mb|m|mega|megas?)\s+(?:para\s+)?([8][0-9]{8})/gi
    ];
    
    const pedidos = [];
    
    for (const padrao of padroesPedidos) {
      let match;
      while ((match = padrao.exec(mensagem)) !== null) {
        let quantidade, unidade, numero;
        
        if (match[1] && /\d/.test(match[1]) && match[2] && /[8][0-9]{8}/.test(match[3])) {
          quantidade = parseFloat(match[1]);
          unidade = match[2].toLowerCase();
          numero = match[3];
        } else if (match[1] && /[8][0-9]{8}/.test(match[1]) && match[2] && /\d/.test(match[2])) {
          numero = match[1];
          quantidade = parseFloat(match[2]);
          unidade = match[3].toLowerCase();
        }
        
        if (quantidade && unidade && numero) {
          let quantidadeGB;
          if (unidade.includes('gb') || unidade.includes('giga') || unidade === 'g') {
            quantidadeGB = quantidade;
          } else if (unidade.includes('mb') || unidade.includes('mega') || unidade === 'm') {
            quantidadeGB = quantidade / 1024;
          } else {
            continue;
          }
          
          const precoEncontrado = this.encontrarPrecoParaQuantidade(quantidadeGB, precos);
          
          if (precoEncontrado) {
            pedidos.push({
              numero: numero,
              quantidade: quantidadeGB,
              descricao: `${quantidadeGB}GB`,
              preco: precoEncontrado.preco,
              original: match[0]
            });
            
            console.log(`   ✅ Pedido específico: ${quantidadeGB}GB para ${numero} = ${precoEncontrado.preco}MT`);
          }
        }
      }
    }
    
    if (pedidos.length > 0) {
      const valorTotal = pedidos.reduce((sum, p) => sum + p.preco, 0);
      console.log(`   📊 Total de pedidos específicos: ${pedidos.length}`);
      console.log(`   💰 Valor total calculado: ${valorTotal}MT`);
      
      return {
        pedidos: pedidos,
        valorTotal: valorTotal,
        numeros: pedidos.map(p => p.numero)
      };
    }
    
    console.log(`   ❌ Nenhum pedido específico encontrado`);
    return null;
  }

  // === ENCONTRAR PREÇO PARA QUANTIDADE ===
  encontrarPrecoParaQuantidade(quantidadeGB, precos) {
    const quantidadeMB = quantidadeGB * 1024;
    
    // Procurar preço exato primeiro
    const precoExato = precos.find(p => {
      if (p.descricao.includes('GB')) {
        const gbNaTabela = parseFloat(p.descricao.replace('GB', ''));
        return Math.abs(gbNaTabela - quantidadeGB) < 0.1;
      } else if (p.descricao.includes('MB')) {
        const mbNaTabela = parseFloat(p.descricao.replace('MB', ''));
        return Math.abs(mbNaTabela - quantidadeMB) < 10;
      }
      return false;
    });
    
    if (precoExato) {
      console.log(`      ✅ Preço exato encontrado: ${quantidadeGB}GB = ${precoExato.preco}MT`);
      return precoExato;
    }
    
    // Se não encontrou exato, procurar o mais próximo
    const precoProximo = precos
      .filter(p => p.tipo !== 'saldo')
      .sort((a, b) => {
        const diffA = Math.abs(a.quantidade - quantidadeMB);
        const diffB = Math.abs(b.quantidade - quantidadeMB);
        return diffA - diffB;
      })[0];
    
    if (precoProximo) {
      console.log(`      ⚡ Preço aproximado: ${quantidadeGB}GB ≈ ${precoProximo.descricao} = ${precoProximo.preco}MT`);
      return precoProximo;
    }
    
    return null;
  }

  // === BUSCAR COMPROVANTE RECENTE NO HISTÓRICO (MELHORADO) ===
  async buscarComprovanteRecenteNoHistorico(remetente, timestamp) {
    console.log(`   🔍 Buscando comprovante recente no histórico...`);

    // AUMENTADO: 30 minutos para dar mais tempo
    const mensagensRecentes = this.historicoMensagens.filter(msg => {
      const timeDiff = timestamp - msg.timestamp;
      return msg.remetente === remetente && timeDiff <= 1800000; // 30 minutos
    });

    if (mensagensRecentes.length === 0) {
      console.log(`   ❌ Nenhuma mensagem recente de ${remetente} nos últimos 30 minutos`);
      return null;
    }

    console.log(`   📊 Analisando ${mensagensRecentes.length} mensagens dos últimos 30 minutos...`);

    // Procurar comprovante nas mensagens recentes (mais recentes primeiro)
    for (let msg of mensagensRecentes.reverse()) {
      if (msg.tipo === 'texto') {
        console.log(`   🔍 Verificando mensagem: "${msg.mensagem.substring(0, 50)}..."`);
        
        const comprovante = await this.analisarComprovante(msg.mensagem);
        if (comprovante) {
          const tempoDecorrido = Math.floor((timestamp - msg.timestamp) / 60000);
          console.log(`   ✅ Comprovante encontrado no histórico: ${comprovante.referencia} - ${comprovante.valor}MT (${tempoDecorrido} min atrás)`);
          return comprovante;
        }
      }
    }

    console.log(`   ❌ Comprovante não encontrado no histórico`);
    return null;
  }

  // === FUNÇÃO PRINCIPAL PARA O BOT (MELHORADA) ===
  async processarMensagemBot(mensagem, remetente, tipoMensagem = 'texto', configGrupo = null, legendaImagem = null) {
    const timestamp = Date.now();
    
    // Log melhorado para debug
    if (tipoMensagem === 'imagem') {
      console.log(`\n🧠 IA processando IMAGEM de ${remetente}`);
      if (legendaImagem && legendaImagem.trim().length > 0) {
        console.log(`📝 Com legenda: "${legendaImagem.substring(0, 100)}..."`);
      } else {
        console.log(`📝 Sem legenda ou legenda vazia`);
      }
    } else {
      console.log(`\n🧠 IA processando TEXTO de ${remetente}: ${mensagem.substring(0, 50)}...`);
    }
    
    // Adicionar ao histórico
    this.adicionarAoHistorico(mensagem, remetente, timestamp, tipoMensagem);
    
    try {
      if (tipoMensagem === 'imagem') {
        return await this.processarImagem(mensagem, remetente, timestamp, configGrupo, legendaImagem);
      } else {
        return await this.processarTexto(mensagem, remetente, timestamp, configGrupo);
      }
    } catch (error) {
      console.error('❌ Erro na IA:', error);
      return { erro: true, mensagem: error.message };
    }
  }

  // === PROCESSAR TEXTO (MELHORADO) ===
  async processarTexto(mensagem, remetente, timestamp, configGrupo = null) {
    console.log(`   📝 Analisando mensagem: "${mensagem}"`);
    
    // VERIFICAR PEDIDOS ESPECÍFICOS PRIMEIRO
    if (configGrupo) {
      const pedidosEspecificos = this.analisarPedidosEspecificos(mensagem, configGrupo);
      if (pedidosEspecificos) {
        console.log(`   🎯 PEDIDOS ESPECÍFICOS DETECTADOS!`);
        
        // Verificar se há comprovante na mensagem ou no histórico
        const { textoComprovante } = this.separarComprovanteENumeros(mensagem);
        let comprovante = null;
        
        if (textoComprovante && textoComprovante.length > 10) {
          comprovante = await this.analisarComprovante(textoComprovante);
        }
        
        // Se não encontrou comprovante na mensagem, buscar no histórico
        if (!comprovante) {
          comprovante = await this.buscarComprovanteRecenteNoHistorico(remetente, timestamp);
        }
        
        if (comprovante) {
          const valorPago = parseFloat(comprovante.valor);
          const valorCalculado = pedidosEspecificos.valorTotal;
          
          console.log(`   💰 Valor pago: ${valorPago}MT`);
          console.log(`   🧮 Valor calculado: ${valorCalculado}MT`);
          
          // Verificar se valores batem (tolerância de ±5MT)
          if (Math.abs(valorPago - valorCalculado) <= 5) {
            console.log(`   ✅ VALORES COMPATÍVEIS! Processando pedidos específicos...`);
            
            const resultados = pedidosEspecificos.pedidos.map(pedido => 
              `${comprovante.referencia}|${pedido.preco}|${pedido.numero}`
            );
            
            console.log(`   ✅ PEDIDOS ESPECÍFICOS PROCESSADOS: ${resultados.join(' + ')}`);
            
            return { 
              sucesso: true, 
              dadosCompletos: resultados.join('\n'),
              tipo: 'pedidos_especificos_processados',
              numeros: pedidosEspecificos.numeros,
              pedidos: pedidosEspecificos.pedidos,
              valorTotal: valorCalculado,
              valorPago: valorPago
            };
          } else {
            console.log(`   ❌ VALORES INCOMPATÍVEIS! Diferença: ${Math.abs(valorPago - valorCalculado)}MT`);
            
            return {
              sucesso: false,
              tipo: 'valores_incompativeis',
              valorPago: valorPago,
              valorCalculado: valorCalculado,
              pedidos: pedidosEspecificos.pedidos,
              mensagem: `Valor pago (${valorPago}MT) não corresponde aos pedidos (${valorCalculado}MT). Verifique os valores.`
            };
          }
        }
      }
    }
    
    // MELHORAR DETECÇÃO: Verificar se é uma mensagem que contém apenas números
    const mensagemLimpa = mensagem.trim();
    const apenasNumeroRegex = /^8[0-9]{8}$/; // Exatamente um número de 9 dígitos
    const multiplosNumerosRegex = /^(8[0-9]{8}[\s,]*)+$/; // Múltiplos números separados por espaço ou vírgula
    
    console.log(`   🔍 Verificando se é apenas número(s)...`);
    console.log(`   📝 Mensagem limpa: "${mensagemLimpa}"`);
    
    if (apenasNumeroRegex.test(mensagemLimpa) || multiplosNumerosRegex.test(mensagemLimpa)) {
      console.log(`   📱 DETECTADO: Mensagem contém apenas número(s)!`);
      
      // Extrair números da mensagem
      const numerosDetectados = mensagemLimpa.match(/8[0-9]{8}/g) || [];
      console.log(`   📱 Números detectados: ${numerosDetectados.join(', ')}`);
      
      if (numerosDetectados.length > 0) {
        return await this.processarNumeros(numerosDetectados, remetente, timestamp, mensagem, configGrupo);
      }
    }
    
    // LÓGICA ORIGINAL: Separar comprovante e números
    const { textoComprovante, numeros } = this.separarComprovanteENumeros(mensagem);
    
    // 1. Verificar se é um comprovante
    let comprovante = null;
    if (textoComprovante && textoComprovante.length > 10) {
      comprovante = await this.analisarComprovante(textoComprovante);
    }
    
    // 2. Se encontrou comprovante E números na mesma mensagem
    if (comprovante && numeros.length > 0) {
      console.log(`   🎯 COMPROVANTE + NÚMEROS na mesma mensagem!`);
      console.log(`   💰 Comprovante: ${comprovante.referencia} - ${comprovante.valor}MT`);
      console.log(`   📱 Números: ${numeros.join(', ')}`);
      
      // Processar imediatamente como pedido completo
      if (configGrupo && parseFloat(comprovante.valor) >= 32) {
        const analiseAutomatica = await this.analisarDivisaoAutomatica(comprovante.valor, configGrupo);
        if (analiseAutomatica.deveDividir) {
          const comprovanteComDivisao = {
            referencia: comprovante.referencia,
            valor: comprovante.valor,
            timestamp: timestamp,
            fonte: comprovante.fonte,
            tipo: 'divisao_automatica',
            analiseAutomatica: analiseAutomatica
          };
          
          return await this.processarNumerosComDivisaoAutomatica(numeros, remetente, comprovanteComDivisao);
        }
      }
      
      // Processamento normal (sem divisão automática)
      if (numeros.length === 1) {
        const resultado = `${comprovante.referencia}|${comprovante.valor}|${numeros[0]}`;
        console.log(`   ✅ PEDIDO COMPLETO IMEDIATO: ${resultado}`);
        return { 
          sucesso: true, 
          dadosCompletos: resultado,
          tipo: 'numero_processado',
          numero: numeros[0]
        };
      } else {
        // Múltiplos números - dividir valor igualmente
        const valorTotal = parseFloat(comprovante.valor);
        const valorPorNumero = (valorTotal / numeros.length).toFixed(2);
        
        const resultados = numeros.map(numero => 
          `${comprovante.referencia}|${valorPorNumero}|${numero}`
        );
        
        console.log(`   ✅ PEDIDOS MÚLTIPLOS IMEDIATOS: ${resultados.join(' + ')}`);
        return { 
          sucesso: true, 
          dadosCompletos: resultados.join('\n'),
          tipo: 'numeros_multiplos_processados',
          numeros: numeros,
          valorCada: valorPorNumero
        };
      }
    }
    
    // 3. Se encontrou apenas números (sem comprovante)
    if (numeros.length > 0 && !comprovante) {
      console.log(`   📱 Apenas números detectados: ${numeros.join(', ')}`);
      return await this.processarNumeros(numeros, remetente, timestamp, mensagem, configGrupo);
    }
    
    // 4. Se encontrou apenas comprovante (sem números)
    if (comprovante && numeros.length === 0) {
      console.log(`   💰 Apenas comprovante detectado: ${comprovante.referencia} - ${comprovante.valor}MT`);
      
      // Analisar divisão automática
      if (configGrupo && parseFloat(comprovante.valor) >= 32) {
        const analiseAutomatica = await this.analisarDivisaoAutomatica(comprovante.valor, configGrupo);
        if (analiseAutomatica.deveDividir) {
          await this.processarComprovanteComDivisao(comprovante, remetente, timestamp, analiseAutomatica);
          return { 
            sucesso: true, 
            tipo: 'comprovante_com_divisao_automatica',
            referencia: comprovante.referencia,
            valor: comprovante.valor,
            pacotesSugeridos: analiseAutomatica.pacotes,
            divisaoCompleta: analiseAutomatica.divisaoCompleta,
            mensagem: analiseAutomatica.mensagemCliente
          };
        }
      }
      
      await this.processarComprovante(comprovante, remetente, timestamp);
      
      return { 
        sucesso: true, 
        tipo: 'comprovante_recebido',
        referencia: comprovante.referencia,
        valor: comprovante.valor,
        mensagem: 'Comprovante recebido! Agora envie o número que vai receber os megas.'
      };
    }
    
    // 5. Não reconheceu
    console.log(`   ❓ Mensagem não reconhecida como comprovante ou número`);
    return { 
      sucesso: false, 
      tipo: 'mensagem_nao_reconhecida',
      mensagem: null 
    };
  }

  // === PROCESSAR IMAGEM (VERSÃO MELHORADA COM LEGENDAS CORRIGIDAS) ===
  async processarImagem(imagemBase64, remetente, timestamp, configGrupo = null, legendaImagem = null) {
    console.log(`   📸 Processando imagem de ${remetente}`);
    
    // Validação melhorada da legenda
    const temLegendaValida = legendaImagem && 
                            typeof legendaImagem === 'string' && 
                            legendaImagem.trim().length > 0;
    
    if (temLegendaValida) {
      console.log(`   📝 Legenda detectada: "${legendaImagem.trim()}"`);
    } else {
      console.log(`   📝 Sem legenda válida`);
    }
    
    const prompt = `
Analisa esta imagem de comprovante de pagamento M-Pesa ou E-Mola de Moçambique.

Procura por:
1. Referência da transação (exemplos: CGC4GQ17W84, PP250712.2035.u31398, etc.)
2. Valor transferido (em MT - Meticais)

ATENÇÃO: 
- Procura por palavras como "Confirmado", "ID da transacao", "Transferiste"
- O valor pode estar em formato "100.00MT", "100MT", "100,00MT"
- A referência é geralmente um código alfanumérico

Responde APENAS no formato JSON:
{
  "referencia": "CGC4GQ17W84",
  "valor": "210",
  "encontrado": true
}

Se não conseguires ler a imagem ou extrair os dados:
{"encontrado": false}
`;

    try {
      const resposta = await this.openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: {
                  url: `data:image/jpeg;base64,${imagemBase64}`,
                  detail: "high"
                }
              }
            ]
          }
        ],
        temperature: 0.1,
        max_tokens: 300
      });

      console.log(`   🔍 Resposta da IA para imagem: ${resposta.choices[0].message.content}`);
      
      const resultado = this.extrairJSON(resposta.choices[0].message.content);
      console.log(`   ✅ JSON extraído da imagem:`, resultado);
      
      if (resultado.encontrado) {
        const comprovante = {
          referencia: resultado.referencia,
          valor: this.limparValor(resultado.valor),
          fonte: 'imagem'
        };
        
        console.log(`   ✅ Dados extraídos da imagem: ${comprovante.referencia} - ${comprovante.valor}MT`);
        
        // VERIFICAR SE HÁ LEGENDA COM NÚMEROS (VERSÃO MELHORADA)
        if (temLegendaValida) {
          console.log(`   🔍 ANALISANDO LEGENDA DA IMAGEM...`);
          
          const { textoComprovante, numeros } = this.separarComprovanteENumeros(legendaImagem, true);
          
          if (numeros.length > 0) {
            console.log(`   🎯 IMAGEM + NÚMEROS NA LEGENDA DETECTADOS!`);
            console.log(`   💰 Comprovante da imagem: ${comprovante.referencia} - ${comprovante.valor}MT`);
            console.log(`   📱 Números da legenda: ${numeros.join(', ')}`);
            
            // Processar imediatamente como pedido completo
            if (configGrupo && parseFloat(comprovante.valor) >= 32) {
              const analiseAutomatica = await this.analisarDivisaoAutomatica(comprovante.valor, configGrupo);
              if (analiseAutomatica.deveDividir) {
                const comprovanteComDivisao = {
                  referencia: comprovante.referencia,
                  valor: comprovante.valor,
                  timestamp: timestamp,
                  fonte: comprovante.fonte,
                  tipo: 'divisao_automatica',
                  analiseAutomatica: analiseAutomatica
                };
                
                return await this.processarNumerosComDivisaoAutomatica(numeros, remetente, comprovanteComDivisao);
              }
            }
            
            // Processamento normal (sem divisão automática)
            if (numeros.length === 1) {
              const resultado = `${comprovante.referencia}|${comprovante.valor}|${numeros[0]}`;
              console.log(`   ✅ PEDIDO COMPLETO IMEDIATO (IMAGEM + LEGENDA): ${resultado}`);
              return { 
                sucesso: true, 
                dadosCompletos: resultado,
                tipo: 'numero_processado',
                numero: numeros[0],
                fonte: 'imagem_com_legenda'
              };
            } else {
              // Múltiplos números - dividir valor igualmente
              const valorTotal = parseFloat(comprovante.valor);
              const valorPorNumero = (valorTotal / numeros.length).toFixed(2);
              
              const resultados = numeros.map(numero => 
                `${comprovante.referencia}|${valorPorNumero}|${numero}`
              );
              
              console.log(`   ✅ PEDIDOS MÚLTIPLOS IMEDIATOS (IMAGEM + LEGENDA): ${resultados.join(' + ')}`);
              return { 
                sucesso: true, 
                dadosCompletos: resultados.join('\n'),
                tipo: 'numeros_multiplos_processados',
                numeros: numeros,
                valorCada: valorPorNumero,
                fonte: 'imagem_com_legenda'
              };
            }
          } else {
            console.log(`   ❌ Nenhum número válido encontrado na legenda`);
          }
        } else {
          console.log(`   ⚠️ Legenda não disponível ou vazia`);
        }
        
        // Sem números na legenda - processar comprovante normalmente
        await this.processarComprovante(comprovante, remetente, timestamp);
        
        return { 
          sucesso: true, 
          tipo: 'comprovante_imagem_recebido',
          referencia: comprovante.referencia,
          valor: comprovante.valor,
          mensagem: 'Comprovante da imagem processado! Agora envie o número que vai receber os megas.'
        };
      } else {
        console.log(`   ❌ IA não conseguiu extrair dados da imagem`);
        return {
          sucesso: false,
          tipo: 'imagem_nao_reconhecida',
          mensagem: 'Não consegui ler o comprovante na imagem. Envie como texto.'
        };
      }
      
    } catch (error) {
      console.error('❌ Erro ao processar imagem:', error);
      return {
        sucesso: false,
        tipo: 'erro_processamento_imagem',
        mensagem: 'Erro ao processar imagem. Tente enviar como texto.'
      };
    }
  }

  // === PROCESSAR COMPROVANTE COM DIVISÃO ===
  async processarComprovanteComDivisao(comprovante, remetente, timestamp, analiseAutomatica) {
    console.log(`   🧮 Processando comprovante com divisão automática...`);
    
    this.comprovantesEmAberto[remetente] = {
      referencia: comprovante.referencia,
      valor: comprovante.valor,
      timestamp: timestamp,
      fonte: comprovante.fonte,
      tipo: 'divisao_automatica',
      analiseAutomatica: analiseAutomatica
    };

    console.log(`   ⏳ Comprovante com divisão automática guardado, aguardando números...`);
  }

  // === PROCESSAR NÚMEROS (MELHORADO) ===
  async processarNumeros(numeros, remetente, timestamp, mensagemOriginal, configGrupo = null) {
    console.log(`   🔢 Processando ${numeros.length} número(s) para ${remetente}`);
    console.log(`   📝 Mensagem original: "${mensagemOriginal}"`);
    
    // Verificar se tem comprovante em aberto PRIMEIRO
    if (this.comprovantesEmAberto[remetente]) {
      const comprovante = this.comprovantesEmAberto[remetente];
      console.log(`   ✅ Comprovante em aberto encontrado: ${comprovante.referencia} - ${comprovante.valor}MT`);
      
      // CASO ESPECIAL: Comprovante com divisão automática
      if (comprovante.tipo === 'divisao_automatica') {
        return await this.processarNumerosComDivisaoAutomatica(numeros, remetente, comprovante);
      }
      
      if (numeros.length === 1) {
        const resultado = `${comprovante.referencia}|${comprovante.valor}|${numeros[0]}`;
        delete this.comprovantesEmAberto[remetente];
        
        console.log(`   ✅ PEDIDO COMPLETO: ${resultado}`);
        return { 
          sucesso: true, 
          dadosCompletos: resultado,
          tipo: 'numero_processado',
          numero: numeros[0],
          origem: 'comprovante_em_aberto'
        };
        
      } else {
        const valorTotal = parseFloat(comprovante.valor);
        const valorPorNumero = (valorTotal / numeros.length).toFixed(2);
        
        console.log(`   🔄 Dividindo ${valorTotal}MT por ${numeros.length} números = ${valorPorNumero}MT cada`);
        
        const resultados = numeros.map(numero => 
          `${comprovante.referencia}|${valorPorNumero}|${numero}`
        );
        
        delete this.comprovantesEmAberto[remetente];
        
        console.log(`   ✅ PEDIDOS MÚLTIPLOS: ${resultados.join(' + ')}`);
        return { 
          sucesso: true, 
          dadosCompletos: resultados.join('\n'),
          tipo: 'numeros_multiplos_processados',
          numeros: numeros,
          valorCada: valorPorNumero,
          origem: 'comprovante_em_aberto'
        };
      }
    }

    // SE NÃO TEM COMPROVANTE EM ABERTO, buscar no histórico
    console.log(`   ❌ Nenhum comprovante em aberto. Buscando no histórico...`);
    const resultadoHistorico = await this.buscarComprovanteNoHistoricoMultiplo(numeros, remetente, timestamp);
    if (resultadoHistorico) {
      console.log(`   ✅ Comprovante encontrado no histórico!`);
      return resultadoHistorico;
    }

    // Sem comprovante
    console.log(`   ❌ Nenhum comprovante encontrado`);
    return { 
      sucesso: false, 
      tipo: 'numeros_sem_comprovante',
      numeros: numeros,
      mensagem: `${numeros.length} número(s) detectado(s), mas não encontrei comprovante nos últimos 30 minutos. Envie o comprovante primeiro.`
    };
  }

  // === PROCESSAR NÚMEROS COM DIVISÃO AUTOMÁTICA ===
  async processarNumerosComDivisaoAutomatica(numeros, remetente, comprovante) {
    console.log(`   🧮 Processando números com divisão automática...`);
    
    const analise = comprovante.analiseAutomatica;
    const totalPacotes = analise.pacotes.reduce((sum, p) => sum + p.quantidade, 0);
    
    console.log(`   📊 Total de pacotes na divisão: ${totalPacotes}`);
    console.log(`   📱 Números fornecidos: ${numeros.length}`);
    
    if (numeros.length === 1) {
      console.log(`   🎯 Enviando todos os pacotes para um número: ${numeros[0]}`);
      
      const resultados = [];
      
      for (const pacote of analise.pacotes) {
        for (let i = 0; i < pacote.quantidade; i++) {
          resultados.push(`${comprovante.referencia}|${pacote.preco}|${numeros[0]}`);
        }
      }
      
      if (this.comprovantesEmAberto[remetente]) {
        delete this.comprovantesEmAberto[remetente];
      }
      
      console.log(`   ✅ DIVISÃO AUTOMÁTICA COMPLETA: ${resultados.length} pacotes para ${numeros[0]}`);
      
      return { 
        sucesso: true, 
        dadosCompletos: resultados.join('\n'),
        tipo: 'divisao_automatica_processada',
        numero: numeros[0],
        totalPacotes: resultados.length,
        divisaoCompleta: analise.divisaoCompleta,
        detalhePacotes: analise.pacotes
      };
      
    } else if (numeros.length === totalPacotes) {
      console.log(`   🎯 Distribuindo um pacote para cada número`);
      
      const resultados = [];
      let indicePacote = 0;
      
      for (const pacote of analise.pacotes) {
        for (let i = 0; i < pacote.quantidade; i++) {
          if (indicePacote < numeros.length) {
            resultados.push(`${comprovante.referencia}|${pacote.preco}|${numeros[indicePacote]}`);
            indicePacote++;
          }
        }
      }
      
      if (this.comprovantesEmAberto[remetente]) {
        delete this.comprovantesEmAberto[remetente];
      }
      
      console.log(`   ✅ DISTRIBUIÇÃO 1:1 COMPLETA: ${resultados.length} pacotes distribuídos`);
      
      return { 
        sucesso: true, 
        dadosCompletos: resultados.join('\n'),
        tipo: 'divisao_automatica_distribuida',
        numeros: numeros,
        totalPacotes: resultados.length,
        divisaoCompleta: analise.divisaoCompleta,
        distribuicao: '1 pacote por número'
      };
      
    } else {
      console.log(`   🔄 Números diferentes dos pacotes, dividindo valor igualmente`);
      
      const valorTotal = parseFloat(comprovante.valor);
      const valorPorNumero = (valorTotal / numeros.length).toFixed(2);
      
      const resultados = numeros.map(numero => 
        `${comprovante.referencia}|${valorPorNumero}|${numero}`
      );
      
      if (this.comprovantesEmAberto[remetente]) {
        delete this.comprovantesEmAberto[remetente];
      }
      
      console.log(`   ✅ DIVISÃO IGUALITÁRIA: ${valorPorNumero}MT para cada número`);
      
      return { 
        sucesso: true, 
        dadosCompletos: resultados.join('\n'),
        tipo: 'divisao_automatica_igualitaria',
        numeros: numeros,
        valorCada: valorPorNumero,
        observacao: `Valor dividido igualmente entre ${numeros.length} números`
      };
    }
  }

  // === FUNÇÃO AUXILIAR PARA EXTRAIR JSON ===
  extrairJSON(texto) {
    try {
      return JSON.parse(texto);
    } catch (e) {
      try {
        let limpo = texto.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(limpo);
      } catch (e2) {
        try {
          const match = texto.match(/\{[\s\S]*\}/);
          if (match) {
            return JSON.parse(match[0]);
          }
        } catch (e3) {
          throw new Error(`Não foi possível extrair JSON: ${texto}`);
        }
      }
    }
  }

  // === ANALISAR COMPROVANTE ===
  async analisarComprovante(mensagem) {
    const temConfirmado = /^confirmado/i.test(mensagem.trim());
    const temID = /^id\s/i.test(mensagem.trim());
    
    if (!temConfirmado && !temID) {
      return null;
    }

    const prompt = `
Analisa esta mensagem de comprovante de pagamento M-Pesa ou E-Mola:

"${mensagem}"

Extrai a referência da transação e o valor transferido.

Responde APENAS no formato JSON:
{
  "referencia": "CGC4GQ17W84",
  "valor": "210",
  "encontrado": true
}

Se não conseguires extrair, responde:
{"encontrado": false}
`;

    const resposta = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "Você é especialista em analisar comprovantes de pagamento moçambicanos M-Pesa e E-Mola." },
        { role: "user", content: prompt }
      ],
      temperature: 0.1,
      max_tokens: 200
    });

    try {
      const resultado = this.extrairJSON(resposta.choices[0].message.content);
      
      if (resultado.encontrado) {
        return {
          referencia: resultado.referencia,
          valor: this.limparValor(resultado.valor),
          fonte: 'texto'
        };
      }
    } catch (parseError) {
      console.error('❌ Erro ao parsear resposta da IA:', parseError);
    }

    return null;
  }

  // === PROCESSAR COMPROVANTE ===
  async processarComprovante(comprovante, remetente, timestamp) {
    this.comprovantesEmAberto[remetente] = {
      referencia: comprovante.referencia,
      valor: comprovante.valor,
      timestamp: timestamp,
      fonte: comprovante.fonte
    };

    console.log(`   ⏳ Comprovante de ${remetente} guardado, aguardando número...`);
  }

  // === BUSCAR NO HISTÓRICO (MÚLTIPLOS) - MELHORADO ===
  async buscarComprovanteNoHistoricoMultiplo(numeros, remetente, timestamp) {
    console.log(`   🔍 Buscando comprovante no histórico para múltiplos números...`);

    // AUMENTADO: 30 minutos para dar mais tempo
    const mensagensRecentes = this.historicoMensagens.filter(msg => {
      const timeDiff = timestamp - msg.timestamp;
      return msg.remetente === remetente && timeDiff <= 1800000; // 30 minutos
    });

    if (mensagensRecentes.length === 0) {
      console.log(`   ❌ Nenhuma mensagem recente de ${remetente} nos últimos 30 minutos`);
      return null;
    }

    console.log(`   📊 Analisando ${mensagensRecentes.length} mensagens dos últimos 30 minutos...`);

    for (let msg of mensagensRecentes.reverse()) {
      if (msg.tipo === 'texto') {
        console.log(`   🔍 Verificando mensagem: "${msg.mensagem.substring(0, 50)}..."`);
        
        const comprovante = await this.analisarComprovante(msg.mensagem);
        if (comprovante) {
          const valorTotal = parseFloat(comprovante.valor);
          const tempoDecorrido = Math.floor((timestamp - msg.timestamp) / 60000);
          
          console.log(`   ✅ Comprovante encontrado: ${comprovante.referencia} - ${comprovante.valor}MT (${tempoDecorrido} min atrás)`);
          
          if (numeros.length === 1) {
            const resultado = `${comprovante.referencia}|${comprovante.valor}|${numeros[0]}`;
            console.log(`   ✅ ENCONTRADO NO HISTÓRICO: ${resultado}`);
            return { 
              sucesso: true, 
              dadosCompletos: resultado,
              tipo: 'numero_processado',
              numero: numeros[0],
              tempoDecorrido: tempoDecorrido
            };
          } else {
            const valorPorNumero = (valorTotal / numeros.length).toFixed(2);
            const resultados = numeros.map(numero => 
              `${comprovante.referencia}|${valorPorNumero}|${numero}`
            );
            
            console.log(`   ✅ ENCONTRADO NO HISTÓRICO (MÚLTIPLO): ${resultados.join(' + ')}`);
            return { 
              sucesso: true, 
              dadosCompletos: resultados.join('\n'),
              tipo: 'numeros_multiplos_processados',
              numeros: numeros,
              valorCada: valorPorNumero,
              tempoDecorrido: tempoDecorrido
            };
          }
        }
      }
    }

    console.log(`   ❌ Comprovante não encontrado no histórico`);
    return null;
  }

  // === LIMPAR VALOR MONETÁRIO ===
  limparValor(valor) {
    if (!valor) return '0';
    
    let valorStr = valor.toString();
    valorStr = valorStr.replace(/\s*(MT|mt|meticais?|metical)\s*/gi, '');
    valorStr = valorStr.trim();
    
    if (valorStr.includes(',') && valorStr.includes('.')) {
      valorStr = valorStr.replace(/,/g, '');
    } else if (valorStr.includes(',')) {
      const parts = valorStr.split(',');
      if (parts.length === 2 && parts[1].length <= 2) {
        valorStr = valorStr.replace(',', '.');
      } else {
        valorStr = valorStr.replace(/,/g, '');
      }
    }
    
    const match = valorStr.match(/\d+\.?\d*/);
    if (match) {
      const numero = parseFloat(match[0]);
      return numero.toString();
    }
    
    const digitos = valorStr.replace(/[^\d]/g, '');
    return digitos || '0';
  }

  // === EXTRAIR NÚMERO (MANTIDO PARA COMPATIBILIDADE) ===
  extrairNumero(mensagem) {
    const numeros = this.extrairTodosNumeros(mensagem);
    return numeros.length > 0 ? numeros[numeros.length - 1] : null;
  }

  // === HISTÓRICO ===
  adicionarAoHistorico(mensagem, remetente, timestamp, tipo = 'texto') {
    this.historicoMensagens.push({
      mensagem,
      remetente,
      timestamp,
      tipo
    });

    if (this.historicoMensagens.length > this.maxHistorico) {
      this.historicoMensagens = this.historicoMensagens.slice(-this.maxHistorico);
    }
  }

  // === LIMPEZA (MELHORADA) ===
  limparComprovantesAntigos() {
    const agora = Date.now();
    const timeout = 45 * 60 * 1000; // AUMENTADO: 45 minutos
    let removidos = 0;

    Object.keys(this.comprovantesEmAberto).forEach(remetente => {
      const comprovante = this.comprovantesEmAberto[remetente];
      if (agora - comprovante.timestamp > timeout) {
        delete this.comprovantesEmAberto[remetente];
        removidos++;
      }
    });

    if (removidos > 0) {
      console.log(`🗑️ Removidos ${removidos} comprovantes antigos (>45min)`);
    }
  }

  // === STATUS ===
  getStatus() {
    return {
      comprovantesEmAberto: Object.keys(this.comprovantesEmAberto).length,
      mensagensNoHistorico: this.historicoMensagens.length,
      detalhesComprovantes: this.comprovantesEmAberto
    };
  }

  // === FUNÇÃO PARA COMANDOS ADMIN (ATUALIZADA) ===
  getStatusDetalhado() {
    let status = `🧠 *STATUS DA IA MELHORADA v3.0*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    status += `💾 Mensagens no histórico: ${this.historicoMensagens.length}\n`;
    status += `⏳ Comprovantes em aberto: ${Object.keys(this.comprovantesEmAberto).length}\n\n`;
    
    if (Object.keys(this.comprovantesEmAberto).length > 0) {
      status += `📋 *Comprovantes aguardando número:*\n`;
      Object.entries(this.comprovantesEmAberto).forEach(([remetente, comp]) => {
        const tempo = Math.floor((Date.now() - comp.timestamp) / 60000);
        const tipo = comp.tipo === 'divisao_automatica' ? ' 🧮' : '';
        status += `• ${remetente.replace('@c.us', '')}: ${comp.referencia} - ${comp.valor}MT${tipo} (${tempo}min)\n`;
      });
    }
    
    status += `\n🔧 *MELHORIAS APLICADAS v3.0:*\n`;
    status += `✅ Detecção de legendas CORRIGIDA!\n`;
    status += `✅ Validação de dados melhorada!\n`;
    status += `✅ Logs mais detalhados!\n`;
    status += `✅ Tratamento de erros robusto!\n`;
    status += `✅ Contexto de legendas otimizado!\n`;
    status += `✅ Padrões de números expandidos!\n`;
    status += `✅ Divisão automática estável!\n`;
    status += `✅ Processamento multi-modal!\n`;
    status += `❌ Respostas interativas REMOVIDAS!\n`;
    
    return status;
  }
}

module.exports = WhatsAppAI;