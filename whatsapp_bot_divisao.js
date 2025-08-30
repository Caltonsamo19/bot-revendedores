const axios = require('axios');
const WhatsAppAIAtacado = require('./whatsapp_ai_atacado');

class WhatsAppBotDivisao {
    constructor() {
        this.comprovantesMemorizados = {};
        this.processandoDivisoes = new Set();
        
        // Inicializar IA usando variável de ambiente (mesma do servidor)
        const openaiApiKey = process.env.OPENAI_API_KEY;
        if (openaiApiKey) {
            this.ia = new WhatsAppAIAtacado(openaiApiKey);
            console.log('🧠 IA integrada ao bot de divisão usando .env!');
        } else {
            this.ia = null;
            console.log('⚠️ IA não disponível - OPENAI_API_KEY não encontrada no .env');
        }
        
        // URLs dos Google Apps Scripts existentes
        this.SCRIPTS_CONFIG = {
            PEDIDOS: 'https://script.google.com/macros/s/AKfycbzdvM-IrH4a6gS53WZ0J-AGXY0duHfgv15DyxdqUm1BLEm3Z15T67qgstu6yPTedgOSCA/exec',
            PAGAMENTOS: 'https://script.google.com/macros/s/AKfycbzzifHGu1JXc2etzG3vqK5Jd3ihtULKezUTQQIDJNsr6tXx3CmVmKkOlsld0x1Feo0H/exec'
        };
        
        // Configuração dos grupos (mesma estrutura do sistema atual)
        this.CONFIGURACAO_GRUPOS = {
            '120363419652375064@g.us': {
                nome: 'Net Fornecedor V',
                precos: {
                    10240: 125,    // 10GB = 125MT
                    20480: 250,    // 20GB = 250MT
                    30720: 375,    // 30GB = 375MT
                    40960: 500,    // 40GB = 500MT
                    51200: 625,    // 50GB = 625MT
                    61440: 750,    // 60GB = 750MT
                    71680: 875,    // 70GB = 875MT
                    81920: 1000,   // 80GB = 1000MT
                    92160: 1125,   // 90GB = 1125MT
                    102400: 1250   // 100GB = 1250MT
                },
                // NÚMEROS DE PAGAMENTO DO GRUPO (NUNCA devem receber megas)
                numerosPagamento: [
                    '870059057',   // Número eMola do grupo
                    '840326152',   // Número M-Pesa do VASCO (sem prefixo)
                    '258840326152', // Versão completa com prefixo
                    '877777777'    // Adicionar outros números de pagamento do grupo aqui
                ]
            }
            // Adicionar outros grupos conforme necessário
        };
        
        // Limpar comprovativos antigos a cada 10 minutos
        setInterval(() => {
            this.limparComprovantesAntigos();
        }, 10 * 60 * 1000);
        
        console.log('🔄 Bot de Divisão inicializado - Múltiplos números automático!');
    }
    
    // === FUNÇÃO PRINCIPAL - PROCESSAR MENSAGEM ===
    async processarMensagem(message, remetente, grupoId) {
        try {
            let mensagem = message.body ? message.body.trim() : '';
            
            // Só processa grupos configurados
            if (!this.CONFIGURACAO_GRUPOS[grupoId]) {
                return null;
            }
            
            console.log(`\n🔍 DIVISÃO: Analisando mensagem de ${remetente}`);
            
            // VERIFICAR SE TEM IMAGEM COM COMPROVATIVO
            if (message.hasMedia && (message.type === 'image' || message.type === 'document')) {
                console.log(`📷 DIVISÃO: Mensagem contém mídia do tipo: ${message.type}`);
                try {
                    const resultadoImagem = await this.extrairTextoDeImagem(message, grupoId);
                    
                    // Se a IA já processou tudo completamente, retornar resultado direto
                    if (resultadoImagem && resultadoImagem.processadoCompleto) {
                        console.log('🎯 DIVISÃO: IA processou imagem + número completamente!');
                        return resultadoImagem.resultado;
                    }
                    
                    // Se extraiu texto do comprovativo, continuar processamento normal
                    if (resultadoImagem && typeof resultadoImagem === 'string') {
                        console.log(`📄 DIVISÃO: Texto extraído da imagem: "${resultadoImagem.substring(0, 100)}..."`);
                        mensagem = resultadoImagem + ' ' + mensagem; // Combinar texto da imagem com texto da mensagem
                    } else {
                        // Se tem imagem mas não conseguiu extrair texto, orientar o usuário
                        console.log('💡 DIVISÃO: Imagem detectada mas texto não extraído');
                        return {
                            resposta: `📷 *COMPROVATIVO EM IMAGEM DETECTADO*\n\n🧠 Tentei processar com IA avançada mas não consegui extrair os dados.\n\n💡 *Para melhor resultado:*\n• Tire uma foto mais clara e focada\n• Certifique-se que TODO o comprovativo está visível\n• Ou copie e cole o texto do comprovativo\n\n🔍 Exemplo: Confirmado ABC123 - Transferiste 250MT`
                        };
                    }
                } catch (error) {
                    console.error('❌ DIVISÃO: Erro ao extrair texto da imagem:', error);
                }
            }
            
            // 1. DETECTAR SE É COMPROVATIVO SEM NÚMEROS DE DESTINO
            const comprovativo = this.extrairComprovativo(mensagem);
            if (comprovativo && !this.temNumerosDestino(mensagem, grupoId)) {
                console.log(`💰 DIVISÃO: Comprovativo memorizado: ${comprovativo.referencia} - ${comprovativo.valor}MT para remetente: ${remetente}`);
                
                // Normalizar remetente para armazenamento consistente
                const remetenteNormalizado = this.normalizarRemetente(remetente);
                console.log(`🔄 DIVISÃO: Remetente normalizado: ${remetenteNormalizado}`);
                
                this.comprovantesMemorizados[remetenteNormalizado] = {
                    ...comprovativo,
                    timestamp: Date.now(),
                    grupoId: grupoId,
                    remetenteOriginal: remetente
                };
                return null; // Não responde ainda
            }
            
            // 2. DETECTAR MÚLTIPLOS NÚMEROS (para verificar se precisa processar)
            const numerosDetectados = this.extrairMultiplosNumeros(mensagem, grupoId);
            
            // 3. VERIFICAR SE É APENAS 1 NÚMERO - NÃO PROCESSAR DIVISÃO
            if (numerosDetectados && numerosDetectados.length === 1) {
                console.log(`👤 DIVISÃO: Apenas 1 número detectado (${numerosDetectados[0]}) - deixando para o sistema normal`);
                return null; // Deixar o sistema normal processar
            }
            
            // 4. PRIORIDADE: COMPROVATIVO + MÚLTIPLOS NÚMEROS NA MESMA MENSAGEM
            if (comprovativo && numerosDetectados && numerosDetectados.length > 1) {
                console.log(`🎯 DIVISÃO: Comprovativo + múltiplos números na mesma mensagem!`);
                console.log(`📱 DIVISÃO: ${numerosDetectados.length} números detectados: ${numerosDetectados.join(', ')}`);
                return await this.processarDivisao(comprovativo, numerosDetectados, grupoId, message);
            }
            
            // 5. CASO ALTERNATIVO: APENAS MÚLTIPLOS NÚMEROS (buscar comprovativo memorizado)
            if (numerosDetectados && numerosDetectados.length > 1 && !comprovativo) {
                console.log(`📱 DIVISÃO: ${numerosDetectados.length} números detectados sem comprovativo na mensagem`);
                
                // Procurar comprovativo memorizado usando normalização
                const remetenteNormalizado = this.normalizarRemetente(remetente);
                let comprovantivoAssociado = this.comprovantesMemorizados[remetenteNormalizado];
                
                // Se não tem memorizado, buscar no histórico (últimos 30 min)
                if (!comprovantivoAssociado) {
                    comprovantivoAssociado = await this.buscarComprovanteRecenteHist(remetente);
                }
                
                if (comprovantivoAssociado) {
                    console.log(`✅ DIVISÃO: Comprovativo memorizado encontrado para divisão!`);
                    return await this.processarDivisao(comprovantivoAssociado, numerosDetectados, grupoId, message);
                } else {
                    console.log(`❌ DIVISÃO: Nenhum comprovativo encontrado para ${remetente}`);
                    return {
                        resposta: `📱 *${numerosDetectados.length} números detectados*\n\n❌ Não encontrei seu comprovativo nos últimos 30 minutos.\n\n🔍 Envie primeiro o comprovativo de pagamento.`
                    };
                }
            }
            
            return null; // Não é caso para divisão
            
        } catch (error) {
            console.error('❌ DIVISÃO: Erro ao processar mensagem:', error);
            return {
                resposta: '❌ Erro interno no sistema de divisão. Tente novamente.'
            };
        }
    }
    
    // === EXTRAIR COMPROVATIVO ===
    extrairComprovativo(mensagem) {
        const mensagemLimpa = mensagem.trim();
        console.log(`🔍 DIVISÃO: Verificando comprovativo em: "${mensagemLimpa.substring(0, 50)}..."`);
        
        const temConfirmado = /^confirmado/i.test(mensagemLimpa);
        const temID = /^id\s/i.test(mensagemLimpa);
        const temEmola = /e-?mola|emola/i.test(mensagemLimpa);
        const temTransferencia = /transferencia\s+realizada/i.test(mensagemLimpa);
        const temRecibo = /recibo\s+de\s+transferencia/i.test(mensagemLimpa);
        
        console.log(`🔍 DIVISÃO: temConfirmado: ${temConfirmado}, temID: ${temID}, temEmola: ${temEmola}, temTransferencia: ${temTransferencia}, temRecibo: ${temRecibo}`);
        
        if (!temConfirmado && !temID && !temEmola && !temTransferencia && !temRecibo) {
            console.log(`❌ DIVISÃO: Não é comprovativo reconhecido`);
            return null;
        }
        
        // Patterns para extrair referência e valor (M-Pesa e eMola)
        const patternsRef = [
            // M-Pesa
            /Confirmado\s+([A-Z0-9]+)/i,
            // eMola - Padrões com pontos (incluindo ponto final)
            /ID da transacao\s+([A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+)\.?\s/i,
            /ID da transacao\s*:?\s*([A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+)\.?/i,
            /ID da transacao\s*:?\s*([A-Z0-9]+\.[A-Z0-9]+)\.?/i,
            /ID da transacao\s*:?\s*([A-Z0-9]+)\.?/i,
            /Referencia\s*:?\s*([A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+)\.?/i,
            /Referencia\s*:?\s*([A-Z0-9]+)\.?/i,
            /Codigo\s*:?\s*([A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+)\.?/i,
            /Codigo\s*:?\s*([A-Z0-9]+)\.?/i,
            /ID\s*:?\s*([A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+)\.?/i,
            /Numero da transacao\s*:?\s*([A-Z0-9]+\.[A-Z0-9]+\.[A-Z0-9]+)\.?/i
        ];
        
        const patternsValor = [
            // M-Pesa
            /Transferiste\s+(\d+(?:[.,]\d+)?)MT/i,
            // eMola
            /Valor\s*:?\s*(\d+(?:[.,]\d+)?)MT/i,
            /Montante\s*:?\s*(\d+(?:[.,]\d+)?)MT/i,
            /Total\s*:?\s*(\d+(?:[.,]\d+)?)MT/i,
            // Genérico
            /(\d+(?:[.,]\d+)?)\s*MT/i
        ];
        
        let referencia = null;
        let valor = null;
        
        // Extrair referência
        for (const pattern of patternsRef) {
            const match = mensagem.match(pattern);
            if (match) {
                referencia = match[1];
                break;
            }
        }
        
        // Extrair valor
        for (const pattern of patternsValor) {
            const match = mensagem.match(pattern);
            if (match) {
                valor = parseFloat(match[1].replace(',', '.'));
                // Se for número inteiro, remover decimais
                if (valor % 1 === 0) valor = parseInt(valor);
                break;
            }
        }
        
        console.log(`🔍 DIVISÃO: Referência extraída: "${referencia}", Valor: ${valor}`);
        
        if (referencia && valor) {
            console.log(`✅ DIVISÃO: Comprovativo extraído com sucesso!`);
            return { referencia, valor };
        }
        
        console.log(`❌ DIVISÃO: Falha na extração - Referência: ${referencia}, Valor: ${valor}`);
        return null;
    }
    
    // === VERIFICAR SE TEM NÚMEROS ===
    temNumeros(mensagem) {
        const regex = /(?:\+258\s*)?8[0-9]{8}/g;
        const matches = mensagem.match(regex);
        return matches && matches.length > 0;
    }

    // === VERIFICAR SE TEM NÚMEROS DE DESTINO (IGNORA PAGAMENTO) ===
    temNumerosDestino(mensagem, grupoId = null) {
        const regex = /(?:\+258\s*)?8[0-9]{8}/g;
        const matches = mensagem.match(regex) || [];
        
        if (matches.length === 0) return false;
        
        // Usar mesma filtragem que extrairMultiplosNumeros
        const numerosLimpos = matches.map(num => this.limparNumero(num))
                                    .filter(num => num && /^8[0-9]{8}$/.test(num));
        
        const numerosUnicos = [...new Set(numerosLimpos)];
        const numerosFiltrados = this.filtrarNumerosComprovante(numerosUnicos, mensagem, grupoId);
        
        return numerosFiltrados.length > 0;
    }
    
    // === EXTRAIR MÚLTIPLOS NÚMEROS ===
    extrairMultiplosNumeros(mensagem, grupoId = null) {
        // REGEX MELHORADA: Capturar números com ou sem prefixo 258
        const regex = /(?:\+?258\s*)?8[0-9]{8}/g;
        const matches = mensagem.match(regex) || [];
        
        if (matches.length === 0) return null;
        
        // Limpar e filtrar números válidos
        const numerosLimpos = matches.map(num => this.limparNumero(num))
                                    .filter(num => num && /^8[0-9]{8}$/.test(num));
        
        // Remover duplicatas
        const numerosUnicos = [...new Set(numerosLimpos)];
        
        // === FILTRAR NÚMEROS QUE ESTÃO NO MEIO DE OUTROS NÚMEROS ===
        const numerosFiltradosPorContexto = numerosUnicos.filter(numero => {
            // Encontrar TODAS as ocorrências deste número na mensagem
            let posicao = 0;
            while ((posicao = mensagem.indexOf(numero, posicao)) !== -1) {
                // Verificar caractere antes e depois desta ocorrência
                const charAntes = mensagem[posicao - 1];
                const charDepois = mensagem[posicao + numero.length];
                
                // Se há dígitos antes ou depois, é parte de um número maior
                const isPartOfLargerNumber = /\d/.test(charAntes) || /\d/.test(charDepois);
                
                if (isPartOfLargerNumber) {
                    console.log(`🚫 DIVISÃO: ${numero} REJEITADO (parte de número maior)`);
                    return false; // Rejeitar se qualquer ocorrência estiver no meio
                }
                
                posicao++; // Continuar buscando outras ocorrências
            }
            
            return true; // Aceitar se todas as ocorrências são números independentes
        });
        
        // === FILTRAR NÚMEROS QUE NÃO SÃO PARA DIVISÃO ===
        const numerosFiltrados = this.filtrarNumerosComprovante(numerosFiltradosPorContexto, mensagem, grupoId);
        
        return numerosFiltrados.length > 0 ? numerosFiltrados : null;
    }
    
    // === FILTRAR NÚMEROS DE COMPROVANTE ===
    filtrarNumerosComprovante(numeros, mensagem, grupoId = null) {
        return numeros.filter(numero => {
            console.log(`🔍 DIVISÃO: Analisando ${numero}...`);
            
            // 1. VERIFICAR SE É NÚMERO DE PAGAMENTO DO GRUPO
            if (grupoId && this.CONFIGURACAO_GRUPOS[grupoId] && this.CONFIGURACAO_GRUPOS[grupoId].numerosPagamento) {
                const numerosPagamento = this.CONFIGURACAO_GRUPOS[grupoId].numerosPagamento;
                if (numerosPagamento.includes(numero)) {
                    console.log(`🚫 DIVISÃO: ${numero} REJEITADO (é número de pagamento do grupo)`);
                    return false;
                }
            }
            
            // 2. VERIFICAR POSIÇÃO NA MENSAGEM
            const posicaoNumero = mensagem.indexOf(numero);
            const comprimentoMensagem = mensagem.length;
            const percentualPosicao = (posicaoNumero / comprimentoMensagem) * 100;
            
            console.log(`🔍 DIVISÃO: ${numero} - posição ${percentualPosicao.toFixed(1)}% da mensagem`);
            
            // Se o número está no início da mensagem (<30%), é provavelmente número de pagamento
            if (percentualPosicao < 30) {
                console.log(`🚫 DIVISÃO: ${numero} REJEITADO (está no início da mensagem - possível número de pagamento)`);
                return false;
            }
            
            // Se o número está no final da mensagem (>70%), é provavelmente para divisão
            if (percentualPosicao > 70) {
                console.log(`✅ DIVISÃO: ${numero} ACEITO (está no final da mensagem)`);
                return true;
            }
            
            // 3. VERIFICAR CONTEXTOS ESPECÍFICOS DE PAGAMENTO
            // PADRÕES PARA DETECTAR NÚMEROS DE PAGAMENTO EM CONFIRMAÇÕES M-PESA/EMOLA
            const contextosPagamentoEspecificos = [
                // eMola - padrões gerais
                new RegExp(`para\\s+conta\\s+${numero}`, 'i'),                    // "para conta 870059057"
                new RegExp(`conta\\s+${numero}`, 'i'),                            // "conta 870059057"
                new RegExp(`para\\s+${numero}\\s*,\\s*nome`, 'i'),               // "para 870059057, nome:"
                new RegExp(`${numero}\\s*,\\s*nome:`, 'i'),                      // "870059057, nome: vasco"
                
                // M-Pesa - padrões específicos (COM e SEM prefixo 258)
                new RegExp(`Transferiste.*para\\s+${numero}\\s*-`, 'i'),         // "Transferiste ... para 840326152 - VASCO"
                new RegExp(`Transferiste.*para\\s+258${numero}\\s*-`, 'i'),       // "Transferiste ... para 258840326152 - VASCO"
                new RegExp(`para\\s+${numero}\\s*-\\s*[A-Z]`, 'i'),              // "para 840326152 - VASCO"
                new RegExp(`para\\s+258${numero}\\s*-`, 'i'),                    // "para 258840326152 - VASCO"
                new RegExp(`MT.*para\\s+${numero}`, 'i'),                        // "125.00MT ... para 840326152"
                new RegExp(`MT.*para\\s+258${numero}`, 'i'),                     // "125.00MT ... para 258840326152"
                new RegExp(`taxa.*para\\s+${numero}`, 'i'),                      // "taxa foi ... para 840326152"
                new RegExp(`taxa.*para\\s+258${numero}`, 'i'),                   // "taxa foi ... para 258840326152"
                new RegExp(`${numero}\\s*-\\s*[A-Z]{2,}`, 'i'),                  // "840326152 - VASCO"
                new RegExp(`258${numero}\\s*-\\s*[A-Z]{2,}`, 'i'),               // "258840326152 - VASCO"
                
                // NOVOS: Padrões mais específicos para capturar destinatários
                new RegExp(`e\\s+a\\s+taxa\\s+foi\\s+de.*para\\s+${numero}`, 'i'),      // "e a taxa foi de 0.00MT para 840326152"
                new RegExp(`e\\s+a\\s+taxa\\s+foi\\s+de.*para\\s+258${numero}`, 'i'),   // "e a taxa foi de 0.00MT para 258840326152"
                new RegExp(`taxa\\s+foi\\s+de.*para\\s+${numero}`, 'i'),               // "taxa foi de 0.00MT para 840326152"
                new RegExp(`taxa\\s+foi\\s+de.*para\\s+258${numero}`, 'i')             // "taxa foi de 0.00MT para 258840326152"
            ];
            
            // Se o número aparece em contexto ESPECÍFICO de pagamento, não é para divisão
            for (const padrao of contextosPagamentoEspecificos) {
                if (padrao.test(mensagem)) {
                    console.log(`🚫 DIVISÃO: ${numero} REJEITADO (contexto específico de pagamento)`);
                    return false;
                }
            }
            
            console.log(`✅ DIVISÃO: ${numero} ACEITO (não está em contexto de pagamento)`);
            return true; // Número válido para divisão
        });
    }
    
    // === LIMPAR NÚMERO ===
    limparNumero(numero) {
        if (!numero || typeof numero !== 'string') return numero;
        
        let numeroLimpo = numero
            .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '') // Caracteres invisíveis
            .replace(/^\+?258\s*/, '') // Remove +258 ou 258
            .replace(/\s+/g, '') // Remove espaços
            .trim();
        
        // Se após limpar sobrou um número que começa com 8 e tem 9 dígitos, retornar apenas os últimos 9
        if (/^8[0-9]{8,}$/.test(numeroLimpo) && numeroLimpo.length > 9) {
            numeroLimpo = numeroLimpo.slice(-9); // Pegar os últimos 9 dígitos
        }
        
        return numeroLimpo;
    }
    
    // === NORMALIZAR REMETENTE PARA ARMAZENAMENTO CONSISTENTE ===
    normalizarRemetente(remetente) {
        // Extrair apenas os dígitos e pegar os últimos 9 (número de telefone)
        const numerosApenas = remetente.replace(/\D/g, '');
        if (numerosApenas.length >= 9) {
            return numerosApenas.slice(-9); // Retorna apenas os últimos 9 dígitos
        }
        return remetente; // Se não conseguir normalizar, retorna original
    }

    // === BUSCAR COMPROVATIVO NO HISTÓRICO (SIMULADO) ===
    async buscarComprovanteRecenteHist(remetente) {
        console.log(`🔍 DIVISÃO: Buscando comprovativo para remetente: ${remetente}`);
        console.log(`📋 DIVISÃO: Comprovativos memorizados:`, Object.keys(this.comprovantesMemorizados));
        
        // Normalizar o remetente atual para busca
        const remetenteNormalizado = this.normalizarRemetente(remetente);
        console.log(`🔄 DIVISÃO: Remetente normalizado para busca: ${remetenteNormalizado}`);
        
        // Buscar usando a chave normalizada
        const comprovativo = this.comprovantesMemorizados[remetenteNormalizado];
        
        // Verificar se ainda está dentro do prazo (30 min)
        if (comprovativo && (Date.now() - comprovativo.timestamp) <= 1800000) {
            console.log(`✅ DIVISÃO: Comprovativo encontrado dentro do prazo!`);
            console.log(`   Ref: ${comprovativo.referencia}, Valor: ${comprovativo.valor}MT`);
            return comprovativo;
        } else if (comprovativo) {
            const minutosExpiracao = (Date.now() - comprovativo.timestamp) / 60000;
            console.log(`❌ DIVISÃO: Comprovativo encontrado mas expirado (${minutosExpiracao.toFixed(1)} min)`);
        } else {
            console.log(`❌ DIVISÃO: Nenhum comprovativo encontrado para este remetente`);
        }
        
        return null;
    }
    
    // === EXTRAIR ESPECIFICAÇÕES DO CLIENTE ===
    extrairEspecificacoes(mensagem, numeros) {
        console.log(`🔍 DIVISÃO: Extraindo especificações da mensagem`);
        
        const especificacoes = {};
        const linhas = mensagem.split('\n').map(linha => linha.trim()).filter(linha => linha.length > 0);
        
        console.log(`   📄 Processando ${linhas.length} linhas da mensagem`);
        
        // Processar linha por linha para encontrar padrões
        for (let i = 0; i < linhas.length; i++) {
            const linha = linhas[i];
            console.log(`   🔍 Linha ${i + 1}: "${linha}"`);
            
            // Padrão 1: GB e número na mesma linha (ex: "10gb 852118624")
            const sameLinha = linha.match(/(\d+)\s*gb\s+(\d{9})/i);
            if (sameLinha) {
                const gb = parseInt(sameLinha[1]);
                const numero = sameLinha[2];
                
                if (numeros.includes(numero) && !especificacoes[numero]) {
                    especificacoes[numero] = gb * 1024;
                    console.log(`   ✅ Padrão mesma linha: ${numero} → ${gb}GB`);
                }
                continue; // Pular para próxima linha
            }
            
            // Padrão 2: Linha só com GB (ex: "10gb")
            const somenteGb = linha.match(/^(\d+)\s*gb\s*$/i);
            if (somenteGb) {
                const gb = parseInt(somenteGb[1]);
                console.log(`   🔍 GB detectado: ${gb}GB - procurando próximo número`);
                
                // Procurar o PRÓXIMO número que ainda não tem especificação
                for (let j = i + 1; j < linhas.length; j++) {
                    const linhaSeguinte = linhas[j];
                    const numeroMatch = linhaSeguinte.match(/^(\d{9})$/);
                    
                    if (numeroMatch) {
                        const numero = numeroMatch[1];
                        if (numeros.includes(numero) && !especificacoes[numero]) {
                            especificacoes[numero] = gb * 1024;
                            console.log(`   ✅ Padrão separado: ${numero} → ${gb}GB`);
                            break; // Parar na primeira correspondência
                        }
                    }
                }
                continue; // Pular para próxima linha
            }
        }
        
        console.log(`   📊 Especificações finais extraídas:`);
        Object.entries(especificacoes).forEach(([numero, megas]) => {
            console.log(`      • ${numero}: ${megas/1024}GB`);
        });
        
        return especificacoes;
    }

    // === PROCESSAR DIVISÃO ===
    async processarDivisao(comprovativo, numeros, grupoId, message) {
        const chaveProcessamento = `${comprovativo.referencia}_${numeros.join('_')}`;
        
        // Evitar processamento duplicado
        if (this.processandoDivisoes.has(chaveProcessamento)) {
            return { resposta: '⏳ Divisão já em processamento...' };
        }
        
        this.processandoDivisoes.add(chaveProcessamento);
        
        try {
            console.log(`🔄 DIVISÃO: Iniciando processamento de ${comprovativo.referencia}`);
            
            // 1. CONFIRMAR PAGAMENTO EXISTE (com retry para sincronização)
            console.log(`🔍 DIVISÃO: Verificando pagamento (pode precisar aguardar sincronização)...`);
            let pagamentoExiste = await this.buscarPagamentoNaPlanilha(
                comprovativo.referencia, 
                comprovativo.valor
            );
            
            // Se não encontrou, tentar mais 2 vezes com delay (sincronização Google Sheets)
            if (!pagamentoExiste) {
                console.log(`⏳ DIVISÃO: Primeira tentativa falhou, aguardando sincronização...`);
                await new Promise(resolve => setTimeout(resolve, 3000)); // 3 segundos
                pagamentoExiste = await this.buscarPagamentoNaPlanilha(
                    comprovativo.referencia, 
                    comprovativo.valor
                );
                
                if (!pagamentoExiste) {
                    console.log(`⏳ DIVISÃO: Segunda tentativa falhou, última tentativa...`);
                    await new Promise(resolve => setTimeout(resolve, 5000)); // +5 segundos
                    pagamentoExiste = await this.buscarPagamentoNaPlanilha(
                        comprovativo.referencia, 
                        comprovativo.valor
                    );
                }
            }
            
            if (!pagamentoExiste) {
                console.log(`❌ DIVISÃO: Pagamento não encontrado após 3 tentativas`);
                return {
                    resposta: `⏳ *PAGAMENTO NÃO ENCONTRADO*\n\n💰 Referência: ${comprovativo.referencia}\n💳 Valor: ${comprovativo.valor}MT\n\n🔍 Aguarde alguns minutos e tente novamente.\n(O sistema pode estar sincronizando com o banco)`
                };
            }
            
            console.log(`✅ DIVISÃO: Pagamento confirmado!`);
            
            // 2. EXTRAIR ESPECIFICAÇÕES DO CLIENTE
            const especificacoes = this.extrairEspecificacoes(message.body || '', numeros);
            
            // 3. CALCULAR DIVISÃO (usar especificações se disponíveis)
            let divisao = null;
            
            if (Object.keys(especificacoes).length > 0) {
                divisao = this.calcularDivisaoComEspecificacoes(comprovativo.valor, numeros, grupoId, especificacoes);
            } else {
                // Tentar divisão automática com retry
                console.log(`🔄 DIVISÃO: Tentando cálculo automático...`);
                divisao = this.calcularDivisaoPorPrioridade(comprovativo.valor, numeros, grupoId);
                
                // Se falhou, tentar diferentes estratégias
                if (!divisao || divisao.length === 0) {
                    console.log(`⚠️ DIVISÃO: Primeira tentativa falhou, tentando estratégias alternativas...`);
                    
                    // ESTRATÉGIA 2: Tentar redistribuir se possível
                    divisao = await this.tentarEstrategiaAlternativa(comprovativo.valor, numeros, grupoId);
                }
            }
            
            // Se ainda não conseguiu calcular, retornar erro detalhado
            if (!divisao || divisao.length === 0) {
                console.error(`❌ DIVISÃO: FALHA COMPLETA no cálculo`);
                
                // Obter preços disponíveis para mostrar na mensagem
                const configGrupo = this.CONFIGURACAO_GRUPOS[grupoId];
                const precosDisponiveis = Object.entries(configGrupo.precos || {})
                    .map(([megas, preco]) => `${Math.floor(megas/1024)}GB = ${preco}MT`)
                    .join('\n• ');
                
                return {
                    resposta: `❌ *ERRO NO CÁLCULO DE DIVISÃO*\n\n` +
                             `💰 **Valor:** ${comprovativo.valor}MT\n` +
                             `📱 **Números:** ${numeros.length}\n\n` +
                             `🚫 **Problema:** Este valor não pode ser dividido automaticamente entre ${numeros.length} números.\n\n` +
                             `📋 **Preços disponíveis:**\n• ${precosDisponiveis}\n\n` +
                             `💡 **Sugestões:**\n` +
                             `• Use um valor que seja soma exata dos preços disponíveis\n` +
                             `• Especifique manualmente os tamanhos (ex: "10gb 840123456")\n` +
                             `• Divida em menos números\n\n` +
                             `🔄 **Não foram enviados dados** - sistema protegido contra erros.`
                };
            }
            
            // 3. GERAR NOVAS REFERÊNCIAS
            const novasReferencias = [];
            for (let i = 0; i < divisao.length; i++) {
                novasReferencias.push(comprovativo.referencia + String(i + 1).padStart(3, '0'));
            }
            
            // 4. ENVIAR MENSAGEM INFORMATIVA
            const temEspecificacoes = Object.keys(especificacoes).length > 0;
            
            let mensagemResposta = `🔄 *MÚLTIPLOS NÚMEROS DETECTADOS!*\n\n`;
            mensagemResposta += `💰 **${comprovativo.referencia}** - ${comprovativo.valor}MT\n`;
            mensagemResposta += `📱 **${numeros.length} números** serão processados\n\n`;
            
            if (temEspecificacoes) {
                mensagemResposta += `🎯 **Divisão conforme especificado:**\n`;
            } else {
                mensagemResposta += `⚡ **Divisão automática:**\n`;
            }
            
            divisao.forEach((item, i) => {
                mensagemResposta += `   • ${item.numero}: ${item.megasTexto} (${item.valorMT}MT)\n`;
            });
            
            mensagemResposta += `\n⏳ *Criando pedidos separados...*`;
            
            // Enviar mensagem
            await message.reply(mensagemResposta);
            
            // 5. CRIAR REGISTROS DIVIDIDOS
            let sucessos = 0;
            for (let i = 0; i < divisao.length; i++) {
                const { numero, megas, valorMT } = divisao[i];
                const novaRef = novasReferencias[i];
                
                try {
                    // PEDIDO na planilha de pedidos
                    await this.enviarParaPlanilhaPedidos(novaRef, megas, numero, grupoId);
                    
                    // PAGAMENTO na planilha de pagamentos  
                    await this.enviarParaPlanilhaPagamentos(novaRef, valorMT, numero, grupoId);
                    
                    sucessos++;
                    console.log(`✅ DIVISÃO: ${novaRef} criado com sucesso`);
                    
                } catch (error) {
                    console.error(`❌ DIVISÃO: Erro ao criar ${novaRef}:`, error);
                }
            }
            
            // 6. LIMPAR DADOS E RESPONDER
            const remetenteLimpeza = this.normalizarRemetente(message.author || message.from);
            delete this.comprovantesMemorizados[remetenteLimpeza];
            
            const mensagemFinal = `✅ *DIVISÃO CONCLUÍDA!*\n\n` +
                `🎯 **${sucessos}/${divisao.length} pedidos criados**\n` +
                `📊 Referências: ${novasReferencias.join(', ')}\n\n` +
                `⏳ *O sistema principal processará as transferências em instantes...*`;
            
            // Aguardar um pouco antes da mensagem final
            setTimeout(async () => {
                try {
                    await message.reply(mensagemFinal);
                } catch (error) {
                    console.error('❌ Erro ao enviar mensagem final:', error);
                }
            }, 2000);
            
            return { processado: true, sucessos, total: divisao.length };
            
        } catch (error) {
            console.error('❌ DIVISÃO: Erro no processamento:', error);
            return {
                resposta: `❌ *ERRO NO PROCESSAMENTO*\n\n${error.message}`
            };
        } finally {
            this.processandoDivisoes.delete(chaveProcessamento);
        }
    }
    
    // === BUSCAR PAGAMENTO NA PLANILHA ===
    async buscarPagamentoNaPlanilha(referencia, valorEsperado) {
        try {
            console.log(`🔍 DIVISÃO: Buscando pagamento ${referencia} - ${valorEsperado}MT`);
            console.log(`🔍 DIVISÃO: Tipo do valor: ${typeof valorEsperado}`);
            console.log(`🔍 DIVISÃO: Valor original: "${valorEsperado}"`);
            
            // Converter valor para número para garantir consistência
            const valorNumerico = parseFloat(valorEsperado);
            console.log(`🔍 DIVISÃO: Valor numérico: ${valorNumerico}`);
            
            const response = await axios.post(this.SCRIPTS_CONFIG.PAGAMENTOS, {
                action: "buscar_por_referencia",
                referencia: referencia,
                valor: valorNumerico
            }, {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });
            
            console.log(`🔍 DIVISÃO: Resposta da busca:`, JSON.stringify(response.data));
            
            if (response.data && response.data.encontrado) {
                console.log(`✅ DIVISÃO: Pagamento encontrado!`);
                return true;
            }
            
            console.log(`❌ DIVISÃO: Pagamento não encontrado`);
            return false;
            
        } catch (error) {
            console.error(`❌ DIVISÃO: Erro ao buscar pagamento:`, error.message);
            return false;
        }
    }
    
    // === CALCULAR DIVISÃO COM ESPECIFICAÇÕES DO CLIENTE ===
    calcularDivisaoComEspecificacoes(valorTotal, numeros, grupoId, especificacoes) {
        console.log(`🎯 DIVISÃO: Calculando COM especificações do cliente`);
        
        const configGrupo = this.CONFIGURACAO_GRUPOS[grupoId];
        if (!configGrupo) {
            console.error(`❌ DIVISÃO: Grupo ${grupoId} não configurado`);
            return null;
        }
        
        const resultado = [];
        let valorUsado = 0;
        let megasUsados = 0;
        
        // Processar cada número com sua especificação
        for (let i = 0; i < numeros.length; i++) {
            const numero = numeros[i];
            const megasEspecificados = especificacoes[numero];
            
            if (!megasEspecificados) {
                console.error(`❌ DIVISÃO: Número ${numero} sem especificação encontrada`);
                return null;
            }
            
            // Encontrar preço correspondente aos megas especificados
            let valorMT = null;
            let megasTexto = '';
            
            for (const [megas, preco] of Object.entries(configGrupo.precos)) {
                if (parseInt(megas) === megasEspecificados) {
                    valorMT = preco;
                    megasTexto = `${megasEspecificados / 1024}GB`;
                    break;
                }
            }
            
            if (valorMT === null) {
                console.error(`❌ DIVISÃO: Não encontrou preço para ${megasEspecificados}MB (${megasEspecificados/1024}GB)`);
                return null;
            }
            
            resultado.push({
                numero: numero,
                megas: megasEspecificados,
                megasTexto: megasTexto,
                valorMT: valorMT
            });
            
            valorUsado += valorMT;
            megasUsados += megasEspecificados;
            
            console.log(`   📋 ${numero}: ${megasTexto} (${valorMT}MT) - especificado pelo cliente`);
        }
        
        // Verificar se o total confere
        if (valorUsado !== valorTotal) {
            console.error(`❌ DIVISÃO: Especificações totalizam ${valorUsado}MT mas comprovativo tem ${valorTotal}MT`);
            console.error(`   💡 SUGESTÃO: Verifique se as especificações estão corretas`);
            return null;
        }
        
        console.log(`✅ DIVISÃO: Especificações conferem! Total: ${valorUsado}MT (${megasUsados/1024}GB)`);
        return resultado;
    }

    // === CALCULAR DIVISÃO POR PRIORIDADE ===
    calcularDivisaoPorPrioridade(valorTotal, numeros, grupoId) {
        try {
            const configGrupo = this.CONFIGURACAO_GRUPOS[grupoId];
            if (!configGrupo || !configGrupo.precos) {
                console.error(`❌ DIVISÃO: Grupo ${grupoId} não configurado`);
                return null;
            }
            
            // VALIDAÇÃO CRÍTICA: Verificar se o valor é válido
            if (!valorTotal || isNaN(valorTotal) || valorTotal <= 0) {
                console.error(`❌ DIVISÃO: Valor inválido: ${valorTotal}MT`);
                return null;
            }
            
            // VALIDAÇÃO CRÍTICA: Verificar se há números para divisão
            if (!numeros || numeros.length === 0) {
                console.error(`❌ DIVISÃO: Nenhum número válido para divisão`);
                return null;
            }
            
            console.log(`🔍 DIVISÃO: Tentando dividir ${valorTotal}MT entre ${numeros.length} números`);
            
            // Converter valor para megas total com validação melhorada
            let megasTotal = null;
            const precosDisponiveis = [];
            
            for (const [megas, preco] of Object.entries(configGrupo.precos)) {
                precosDisponiveis.push(`${Math.floor(megas/1024)}GB=${preco}MT`);
                if (preco === valorTotal) {
                    megasTotal = parseInt(megas);
                    break;
                }
            }
            
            if (!megasTotal) {
                console.error(`❌ DIVISÃO: Valor ${valorTotal}MT não encontrado na tabela de preços`);
                console.error(`📋 DIVISÃO: Preços disponíveis: ${precosDisponiveis.join(', ')}`);
                return null;
            }
            
            console.log(`✅ DIVISÃO: ${valorTotal}MT = ${megasTotal}MB (${megasTotal/1024}GB) total`);
            
            // TENTATIVA 1: Divisão exata primeiro
            const resultado = this.tentarDivisaoExata(megasTotal, numeros, configGrupo);
            if (resultado && resultado.length > 0) {
                // Validar se a soma confere
                const somaValores = resultado.reduce((sum, item) => sum + item.valorMT, 0);
                if (somaValores === valorTotal) {
                    console.log(`✅ DIVISÃO: Divisão exata bem-sucedida`);
                    return resultado;
                } else {
                    console.log(`⚠️ DIVISÃO: Divisão exata falhou na validação - ${somaValores}MT ≠ ${valorTotal}MT`);
                }
            }
            
            // TENTATIVA 2: Divisão por aproximação
            console.log(`🔄 DIVISÃO: Tentando divisão por aproximação...`);
            const resultadoAprox = this.tentarDivisaoPorAproximacao(valorTotal, numeros, configGrupo);
            if (resultadoAprox && resultadoAprox.length > 0) {
                // Validar se a soma confere
                const somaValores = resultadoAprox.reduce((sum, item) => sum + item.valorMT, 0);
                if (somaValores === valorTotal) {
                    console.log(`✅ DIVISÃO: Divisão por aproximação bem-sucedida`);
                    return resultadoAprox;
                } else {
                    console.log(`⚠️ DIVISÃO: Divisão por aproximação falhou na validação - ${somaValores}MT ≠ ${valorTotal}MT`);
                }
            }
            
            // FALHA: Não foi possível dividir
            console.error(`❌ DIVISÃO: FALHA COMPLETA - Valor ${valorTotal}MT não pode ser dividido entre ${numeros.length} números`);
            console.error(`📋 DIVISÃO: Preços disponíveis no grupo: ${precosDisponiveis.join(', ')}`);
            
            return null;
            
        } catch (error) {
            console.error(`❌ DIVISÃO: Erro crítico no cálculo:`, error);
            return null;
        }
    }

    // === TENTATIVA 1: DIVISÃO EXATA ===
    tentarDivisaoExata(megasTotal, numeros, configGrupo) {
        try {
            console.log(`🎯 DIVISÃO: Tentando divisão exata de ${megasTotal}MB entre ${numeros.length} números`);
            
            // Calcular divisão base
            const megasPorNumero = Math.floor(megasTotal / numeros.length);
            
            // Tentar arredondar para múltiplos de 10GB primeiro
            let megasBase = Math.floor(megasPorNumero / 10240) * 10240;
            
            // Se megasBase é 0, tentar múltiplos menores
            if (megasBase === 0) {
                console.log(`🔄 DIVISÃO: Base de 10GB muito grande, tentando valores menores...`);
                return null; // Deixar para aproximação
            }
            
            const megasRestante = megasTotal - (megasBase * numeros.length);
            
            console.log(`📊 DIVISÃO: Base ${megasBase}MB cada, restante ${megasRestante}MB`);
            
            const resultado = [];
            let megasDistribuidos = 0;
            
            for (let i = 0; i < numeros.length; i++) {
                let megasFinais = megasBase;
                
                // Distribuir restante por prioridade
                if (megasRestante > 0 && i < Math.floor(megasRestante / 10240)) {
                    megasFinais += 10240; // +10GB
                }
                
                // Verificar se este tamanho existe na tabela
                let valorMT = null;
                let megasTexto = '';
                
                for (const [megas, preco] of Object.entries(configGrupo.precos)) {
                    if (parseInt(megas) === megasFinais) {
                        valorMT = preco;
                        megasTexto = `${megasFinais / 1024}GB`;
                        break;
                    }
                }
                
                if (valorMT === null) {
                    console.error(`❌ DIVISÃO: Tamanho ${megasFinais}MB (${megasFinais/1024}GB) não existe na tabela`);
                    return null;
                }
                
                resultado.push({
                    numero: numeros[i],
                    megas: megasFinais,
                    megasTexto: megasTexto,
                    valorMT: valorMT
                });
                
                megasDistribuidos += megasFinais;
            }
            
            // Verificar se todos os megas foram distribuídos
            if (megasDistribuidos !== megasTotal) {
                console.error(`❌ DIVISÃO: Megas distribuídos ${megasDistribuidos} ≠ Total ${megasTotal}`);
                return null;
            }
            
            console.log(`✅ DIVISÃO: Divisão exata calculada com sucesso`);
            return resultado;
            
        } catch (error) {
            console.error(`❌ DIVISÃO: Erro na divisão exata:`, error);
            return null;
        }
    }

    // === TENTATIVA 2: DIVISÃO POR APROXIMAÇÃO ===
    tentarDivisaoPorAproximacao(valorTotal, numeros, configGrupo) {
        try {
            console.log(`🔄 DIVISÃO: Tentando divisão por aproximação - ${valorTotal}MT entre ${numeros.length} números`);
            
            // Obter todos os preços disponíveis ordenados
            const precosOrdenados = Object.entries(configGrupo.precos)
                .map(([megas, preco]) => ({ megas: parseInt(megas), preco: parseInt(preco) }))
                .sort((a, b) => a.preco - b.preco);
            
            console.log(`📋 DIVISÃO: Preços disponíveis:`, precosOrdenados.map(p => `${p.preco}MT(${p.megas/1024}GB)`).join(', '));
            
            // Encontrar combinações que somem exatamente o valor total
            const combinacoes = this.encontrarCombinacoesExatas(valorTotal, numeros.length, precosOrdenados);
            
            if (combinacoes && combinacoes.length > 0) {
                const resultado = [];
                
                for (let i = 0; i < numeros.length && i < combinacoes.length; i++) {
                    const { megas, preco } = combinacoes[i];
                    resultado.push({
                        numero: numeros[i],
                        megas: megas,
                        megasTexto: `${megas / 1024}GB`,
                        valorMT: preco
                    });
                }
                
                console.log(`✅ DIVISÃO: Combinação encontrada por aproximação`);
                return resultado;
            }
            
            console.log(`❌ DIVISÃO: Nenhuma combinação válida encontrada`);
            return null;
            
        } catch (error) {
            console.error(`❌ DIVISÃO: Erro na divisão por aproximação:`, error);
            return null;
        }
    }

    // === ENCONTRAR COMBINAÇÕES EXATAS ===
    encontrarCombinacoesExatas(valorAlvo, quantidadeNumeros, precosDisponiveis) {
        console.log(`🔍 DIVISÃO: Procurando combinações que somem ${valorAlvo}MT para ${quantidadeNumeros} números`);
        
        // Função recursiva para encontrar combinações
        const encontrarCombinacao = (valorRestante, numerosRestantes, combinacaoAtual) => {
            // Caso base: se não há mais números para preencher
            if (numerosRestantes === 0) {
                return valorRestante === 0 ? combinacaoAtual : null;
            }
            
            // Se valor restante é negativo, falhou
            if (valorRestante < 0) {
                return null;
            }
            
            // Tentar cada preço disponível
            for (const preco of precosDisponiveis) {
                if (preco.preco <= valorRestante) {
                    const novaCombinacao = [...combinacaoAtual, preco];
                    const resultado = encontrarCombinacao(
                        valorRestante - preco.preco,
                        numerosRestantes - 1,
                        novaCombinacao
                    );
                    
                    if (resultado) {
                        return resultado;
                    }
                }
            }
            
            return null;
        };
        
        const resultado = encontrarCombinacao(valorAlvo, quantidadeNumeros, []);
        
        if (resultado) {
            console.log(`✅ DIVISÃO: Combinação encontrada:`, resultado.map(p => `${p.preco}MT(${p.megas/1024}GB)`).join(', '));
        } else {
            console.log(`❌ DIVISÃO: Nenhuma combinação exata encontrada`);
        }
        
        return resultado;
    }

    // === ESTRATÉGIA ALTERNATIVA DE CÁLCULO ===
    async tentarEstrategiaAlternativa(valorTotal, numeros, grupoId) {
        try {
            console.log(`🔄 DIVISÃO: Tentando estratégia alternativa para ${valorTotal}MT`);
            
            const configGrupo = this.CONFIGURACAO_GRUPOS[grupoId];
            if (!configGrupo || !configGrupo.precos) {
                return null;
            }
            
            // ESTRATÉGIA 1: Tentar com números diferentes (reduzir 1 número)
            if (numeros.length > 2) {
                console.log(`🔄 DIVISÃO: Tentando com ${numeros.length - 1} números...`);
                const numerosReduzidos = numeros.slice(0, -1);
                const divisaoReduzida = this.calcularDivisaoPorPrioridade(valorTotal, numerosReduzidos, grupoId);
                
                if (divisaoReduzida && divisaoReduzida.length > 0) {
                    console.log(`⚠️ DIVISÃO: Consegui dividir apenas entre ${numerosReduzidos.length} números`);
                    
                    // Adicionar informação sobre número não processado
                    const numeroNaoProcessado = numeros[numeros.length - 1];
                    divisaoReduzida.observacao = `Número ${numeroNaoProcessado} não pôde ser incluído na divisão automática`;
                    
                    return divisaoReduzida;
                }
            }
            
            // ESTRATÉGIA 2: Verificar se é múltiplo de preços menores
            const precosOrdenados = Object.entries(configGrupo.precos)
                .map(([megas, preco]) => ({ megas: parseInt(megas), preco: parseInt(preco) }))
                .sort((a, b) => a.preco - b.preco);
            
            console.log(`🔄 DIVISÃO: Tentando dividir usando menor preço disponível...`);
            const menorPreco = precosOrdenados[0];
            
            if (menorPreco && valorTotal % menorPreco.preco === 0) {
                const quantidadePossivel = Math.floor(valorTotal / menorPreco.preco);
                
                if (quantidadePossivel >= numeros.length) {
                    console.log(`✅ DIVISÃO: Posso dar ${menorPreco.megas/1024}GB para todos`);
                    
                    const resultado = numeros.map(numero => ({
                        numero: numero,
                        megas: menorPreco.megas,
                        megasTexto: `${menorPreco.megas / 1024}GB`,
                        valorMT: menorPreco.preco
                    }));
                    
                    // Calcular sobra
                    const valorUsado = numeros.length * menorPreco.preco;
                    if (valorUsado < valorTotal) {
                        resultado.observacao = `Sobra de ${valorTotal - valorUsado}MT não foi distribuída`;
                    }
                    
                    return resultado;
                }
            }
            
            console.log(`❌ DIVISÃO: Todas as estratégias alternativas falharam`);
            return null;
            
        } catch (error) {
            console.error(`❌ DIVISÃO: Erro na estratégia alternativa:`, error);
            return null;
        }
    }
    
    // === ENVIAR PARA PLANILHA DE PEDIDOS ===
    async enviarParaPlanilhaPedidos(referencia, megas, numero, grupoId) {
        try {
            console.log(`📋 DIVISÃO: Enviando pedido ${referencia}|${megas}|${numero}`);
            
            const timestamp = new Date().toLocaleString('pt-BR');
            const dadosCompletos = `${referencia}|${megas}|${numero}|${timestamp}`;
            
            const dados = {
                grupo_id: grupoId,
                timestamp: timestamp,
                dados: dadosCompletos,
                sender: "WhatsApp-Bot-Divisao",
                message: `Pedido dividido: ${dadosCompletos}`
            };
            
            console.log(`📋 DIVISÃO: URL PEDIDOS: ${this.SCRIPTS_CONFIG.PEDIDOS}`);
            console.log(`📋 DIVISÃO: Dados:`, JSON.stringify(dados));
            
            const response = await axios.post(this.SCRIPTS_CONFIG.PEDIDOS, dados, {
                timeout: 20000, // Aumentado para 20 segundos
                headers: { 'Content-Type': 'application/json' },
                retry: 2 // Tentar novamente se falhar
            });
            
            console.log(`📋 DIVISÃO: Resposta recebida:`, response.data);
            
            if (!response.data || !response.data.success) {
                const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                throw new Error(`Erro ao salvar pedido: ${responseText}`);
            }
            
            console.log(`✅ DIVISÃO: Pedido salvo com sucesso - ${referencia}|${megas}|${numero}`);
            
        } catch (error) {
            console.error(`❌ DIVISÃO: Erro ao enviar pedido:`, error.message);
            
            // Se foi timeout, tentar novamente
            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                console.log(`🔄 DIVISÃO: Tentando reenviar pedido após timeout...`);
                try {
                    const response = await axios.post(this.SCRIPTS_CONFIG.PEDIDOS, dados, {
                        timeout: 30000, // 30 segundos na segunda tentativa
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    console.log(`✅ DIVISÃO: Pedido enviado na segunda tentativa:`, response.data);
                    
                    if (response.data && response.data.success) {
                        console.log(`✅ DIVISÃO: Pedido salvo com sucesso na segunda tentativa - ${referencia}|${megas}|${numero}`);
                        return;
                    }
                } catch (retryError) {
                    console.error(`❌ DIVISÃO: Segunda tentativa também falhou:`, retryError.message);
                }
            }
            
            throw error;
        }
    }
    
    // === ENVIAR PARA PLANILHA DE PAGAMENTOS ===
    async enviarParaPlanilhaPagamentos(referencia, valor, numero, grupoId) {
        try {
            console.log(`💰 DIVISÃO: Enviando pagamento ${referencia}|${valor}|${numero}`);
            
            const timestamp = new Date().toLocaleString('pt-BR');
            const dadosCompletos = `${referencia}|${valor}|${numero}|${timestamp}`;
            
            const dados = {
                grupo_id: grupoId,
                timestamp: timestamp,
                transacao: dadosCompletos,
                sender: "WhatsApp-Bot-Divisao",
                message: `Pagamento dividido: ${dadosCompletos}`
            };
            
            console.log(`💰 DIVISÃO: URL PAGAMENTOS: ${this.SCRIPTS_CONFIG.PAGAMENTOS}`);
            console.log(`💰 DIVISÃO: Dados:`, JSON.stringify(dados));
            
            const response = await axios.post(this.SCRIPTS_CONFIG.PAGAMENTOS, dados, {
                timeout: 20000, // Aumentado para 20 segundos  
                headers: { 'Content-Type': 'application/json' },
                retry: 2 // Tentar novamente se falhar
            });
            
            console.log(`💰 DIVISÃO: Resposta recebida:`, response.data);
            
            // Verificar se foi sucesso - pode ser objeto {success: true} ou string "Sucesso!"
            const isSuccess = (response.data && response.data.success) || 
                             (typeof response.data === 'string' && response.data.includes('Sucesso'));
            
            if (!response.data || !isSuccess) {
                const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
                throw new Error(`Erro ao salvar pagamento: ${responseText}`);
            }
            
            console.log(`✅ DIVISÃO: Pagamento salvo com sucesso - ${referencia}|${valor}|${numero}`);
            
        } catch (error) {
            console.error(`❌ DIVISÃO: Erro ao enviar pagamento:`, error.message);
            
            // Se foi timeout, tentar novamente
            if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
                console.log(`🔄 DIVISÃO: Tentando reenviar pagamento após timeout...`);
                try {
                    const response = await axios.post(this.SCRIPTS_CONFIG.PAGAMENTOS, dados, {
                        timeout: 30000, // 30 segundos na segunda tentativa
                        headers: { 'Content-Type': 'application/json' }
                    });
                    
                    console.log(`✅ DIVISÃO: Pagamento enviado na segunda tentativa:`, response.data);
                    
                    const isSuccess = (response.data && response.data.success) || 
                                     (typeof response.data === 'string' && response.data.includes('Sucesso'));
                    
                    if (isSuccess) {
                        console.log(`✅ DIVISÃO: Pagamento salvo com sucesso na segunda tentativa - ${referencia}|${valor}|${numero}`);
                        return;
                    }
                } catch (retryError) {
                    console.error(`❌ DIVISÃO: Segunda tentativa de pagamento também falhou:`, retryError.message);
                }
            }
            
            throw error;
        }
    }
    
    // === LIMPEZA DE DADOS ANTIGOS ===
    limparComprovantesAntigos() {
        const agora = Date.now();
        const timeout = 30 * 60 * 1000; // 30 minutos
        let removidos = 0;
        
        Object.keys(this.comprovantesMemorizados).forEach(remetente => {
            const comprovativo = this.comprovantesMemorizados[remetente];
            if (agora - comprovativo.timestamp > timeout) {
                delete this.comprovantesMemorizados[remetente];
                removidos++;
            }
        });
        
        if (removidos > 0) {
            console.log(`🗑️ DIVISÃO: ${removidos} comprovativos antigos removidos`);
        }
    }
    
    // === EXTRAIR TEXTO DE IMAGEM COM IA ===
    async extrairTextoDeImagem(message, grupoId) {
        try {
            console.log('📷 DIVISÃO: Iniciando extração de texto da imagem com IA...');
            
            // Verificar se IA está disponível
            if (!this.ia) {
                console.log('❌ DIVISÃO: IA não disponível para processar imagens');
                return null;
            }
            
            // Baixar a mídia
            const media = await message.downloadMedia();
            if (!media) {
                console.log('❌ DIVISÃO: Não foi possível baixar a mídia');
                return null;
            }
            
            console.log(`📷 DIVISÃO: Mídia baixada - Tipo: ${media.mimetype}, Tamanho: ${media.data.length} bytes`);
            
            // Verificar se é imagem
            if (!media.mimetype || !media.mimetype.startsWith('image/')) {
                console.log('❌ DIVISÃO: Arquivo não é uma imagem válida');
                return null;
            }
            
            // Criar configuração de grupo para a IA (usando dados do bot de divisão)
            const configGrupoParaIA = this.CONFIGURACAO_GRUPOS[grupoId] ? {
                tabela: this.gerarTabelaTextoParaIA(grupoId),
                precos: this.CONFIGURACAO_GRUPOS[grupoId].precos  // CORREÇÃO: Adicionar preços diretos
            } : null;
            
            // Usar a IA avançada para extrair comprovativo da imagem
            const resultadoIA = await this.ia.processarImagem(media.data, 'usuario_divisao', Date.now(), configGrupoParaIA, message.body || '');
            
            console.log(`🔍 DIVISÃO: Resultado completo da IA:`, JSON.stringify(resultadoIA, null, 2));
            
            if (resultadoIA && resultadoIA.sucesso) {
                // Se a IA já processou tudo (comprovativo + número único), retornar resultado direto
                if (resultadoIA.dadosCompletos) {
                    console.log(`✅ DIVISÃO: IA processou TUDO: ${resultadoIA.dadosCompletos}`);
                    return { processadoCompleto: true, resultado: resultadoIA };
                }
                
                // Se IA só extraiu comprovativo, simular texto para processamento normal
                if (resultadoIA.referencia && resultadoIA.valor) {
                    console.log(`✅ DIVISÃO: IA extraiu comprovativo: ${resultadoIA.referencia} - ${resultadoIA.valor}MT`);
                    const textoSimulado = `Confirmado ${resultadoIA.referencia} - Transferiste ${resultadoIA.valor}MT`;
                    return textoSimulado;
                }
            }
            
            // CASO ESPECIAL: IA rejeitou múltiplos números, mas nós queremos processá-los!
            if (resultadoIA && !resultadoIA.sucesso && resultadoIA.tipo === 'multiplos_numeros_nao_permitido') {
                console.log('🎯 DIVISÃO: IA detectou múltiplos números - extraindo só comprovativo!');
                console.log(`📱 DIVISÃO: Múltiplos números detectados: ${resultadoIA.numeros.join(', ')}`);
                
                // Extrair apenas o comprovativo usando prompt personalizado para divisão
                const comprovantivoIA = await this.extrairApenasComprovativo(media.data);
                
                if (comprovantivoIA && comprovantivoIA.referencia && comprovantivoIA.valor) {
                    console.log(`✅ DIVISÃO: Comprovativo extraído: ${comprovantivoIA.referencia} - ${comprovantivoIA.valor}MT`);
                    
                    // Simular texto com comprovativo + múltiplos números
                    const textoSimulado = `Confirmado ${comprovantivoIA.referencia} - Transferiste ${comprovantivoIA.valor}MT ${resultadoIA.numeros.join(' ')}`;
                    return textoSimulado;
                }
            }
            
            console.log('❌ DIVISÃO: IA não conseguiu extrair comprovativo da imagem');
            return null;
            
        } catch (error) {
            console.error('❌ DIVISÃO: Erro ao usar IA para extrair texto da imagem:', error);
            return null;
        }
    }

    // === EXTRAIR APENAS COMPROVATIVO (SEM NÚMEROS) ===
    async extrairApenasComprovativo(imagemBase64) {
        if (!this.ia) return null;
        
        try {
            console.log('🔍 DIVISÃO: Extraindo apenas comprovativo da imagem...');
            
            const prompt = `Analise esta imagem de comprovante M-Pesa/E-Mola de Moçambique.

FOQUE APENAS no comprovante - IGNORE todos os números de telefone.

Extraia:
- Referência da transação (ID da transação)
- Valor transferido em MT

⚠️ CRÍTICO: Mantenha maiúsculas e minúsculas EXATAMENTE como aparecem!

Responda APENAS no formato JSON:
{
  "referencia": "CHP2H5LBZAS",
  "valor": "250",
  "encontrado": true,
  "tipo": "mpesa"
}

Se não conseguir extrair:
{"encontrado": false}`;

            const response = await this.ia.openai.chat.completions.create({
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
            
            console.log(`🔍 DIVISÃO: Resposta da IA (só comprovativo): ${response.choices[0].message.content}`);
            
            const resultado = this.ia.extrairJSONMelhorado(response.choices[0].message.content);
            
            if (resultado && resultado.encontrado) {
                return {
                    referencia: resultado.referencia,
                    valor: this.ia.limparValor(resultado.valor)
                };
            }
            
            return null;
            
        } catch (error) {
            console.error('❌ DIVISÃO: Erro ao extrair comprovativo:', error);
            return null;
        }
    }

    // === GERAR TABELA PARA IA ===
    gerarTabelaTextoParaIA(grupoId) {
        const configGrupo = this.CONFIGURACAO_GRUPOS[grupoId];
        if (!configGrupo || !configGrupo.precos) {
            return '';
        }
        
        let tabela = `📋 TABELA ${configGrupo.nome}:\n`;
        
        Object.entries(configGrupo.precos).forEach(([megas, preco]) => {
            const gb = Math.floor(megas / 1024);
            tabela += `${gb}GB➜${preco}MT\n`;
        });
        
        console.log(`📋 DIVISÃO: Tabela gerada para IA: ${tabela}`);
        return tabela;
    }

    // === ADICIONAR NÚMERO DE PAGAMENTO ===
    adicionarNumeroPagamento(grupoId, numero) {
        if (!this.CONFIGURACAO_GRUPOS[grupoId]) {
            console.log(`❌ DIVISÃO: Grupo ${grupoId} não existe`);
            return false;
        }
        
        if (!this.CONFIGURACAO_GRUPOS[grupoId].numerosPagamento) {
            this.CONFIGURACAO_GRUPOS[grupoId].numerosPagamento = [];
        }
        
        const numeroLimpo = this.limparNumero(numero);
        if (!this.CONFIGURACAO_GRUPOS[grupoId].numerosPagamento.includes(numeroLimpo)) {
            this.CONFIGURACAO_GRUPOS[grupoId].numerosPagamento.push(numeroLimpo);
            console.log(`✅ DIVISÃO: Número de pagamento ${numeroLimpo} adicionado ao grupo ${this.CONFIGURACAO_GRUPOS[grupoId].nome}`);
            return true;
        } else {
            console.log(`⚠️ DIVISÃO: Número ${numeroLimpo} já está na lista de pagamentos`);
            return false;
        }
    }

    // === STATUS DO BOT ===
    getStatus() {
        return {
            comprovantesMemorizados: Object.keys(this.comprovantesMemorizados).length,
            processandoDivisoes: this.processandoDivisoes.size,
            gruposConfigurados: Object.keys(this.CONFIGURACAO_GRUPOS).length,
            numerosPagamento: Object.keys(this.CONFIGURACAO_GRUPOS).reduce((acc, grupoId) => {
                const config = this.CONFIGURACAO_GRUPOS[grupoId];
                acc[config.nome] = config.numerosPagamento || [];
                return acc;
            }, {})
        };
    }
}

module.exports = WhatsAppBotDivisao;