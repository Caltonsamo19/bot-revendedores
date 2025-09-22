const fs = require('fs').promises;
const path = require('path');

// Controle de logs - desativar debug logs
const DEBUG_MODE = process.env.DEBUG_MODE === 'true' || false;
const originalConsoleLog = console.log;
console.log = function(...args) {
    const msg = args.join(' ');
    // Manter apenas logs críticos
    if (msg.includes('❌') || msg.includes('✅') || msg.includes('🚨') ||
        msg.includes('Sistema de Compras inicializado') || msg.includes('Error') ||
        msg.includes('erro') || msg.includes('CRÍTICO') || msg.includes('Backup')) {
        originalConsoleLog(...args);
    } else if (DEBUG_MODE) {
        originalConsoleLog(...args);
    }
};

class SistemaCompras {
    constructor() {
        console.log('🛒 Inicializando Sistema de Registro de Compras...');
        
        // Arquivos de dados
        this.ARQUIVO_COMPRADORES = path.join(__dirname, 'historico_compradores.json');
        this.ARQUIVO_COMPRAS_PENDENTES = path.join(__dirname, 'compras_pendentes.json');
        this.ARQUIVO_RANKING_DIARIO = path.join(__dirname, 'ranking_diario.json');
        this.ARQUIVO_RANKING_SEMANAL = path.join(__dirname, 'ranking_semanal.json');
        this.ARQUIVO_RANKING_DIARIO_MEGAS = path.join(__dirname, 'ranking_diario_megas.json');
        this.ARQUIVO_MENSAGENS_RANKING = path.join(__dirname, 'mensagens_ranking.json');

        // Arquivos de backup
        this.PASTA_BACKUP = path.join(__dirname, 'backup_historico');
        this.ARQUIVO_BACKUP_PRINCIPAL = path.join(this.PASTA_BACKUP, 'historico_compradores_backup.json');
        this.ARQUIVO_BACKUP_ROTATIVO = path.join(this.PASTA_BACKUP, 'historico_compradores_backup_');

        // Garantir que a pasta de backup existe
        this.garantirPastaBackup();
        
        // Dados em memória
        this.historicoCompradores = {}; // {numero: {comprasTotal: 0, ultimaCompra: date, megasTotal: 0, grupos: {grupoId: {compras: 0, megas: 0, comprasDia: 0, megasDia: 0, ultimaCompraDia: date, comprasSemana: 0, megasSemana: 0, ultimaCompraSemana: date}}}}
        this.comprasPendentes = {}; // {referencia: {numero, megas, timestamp, tentativas, grupoId}}
        this.rankingPorGrupo = {}; // {grupoId: [{numero, megas, compras, posicao}]}
        this.rankingSemanalPorGrupo = {}; // {grupoId: [{numero, megasSemana, comprasSemana, posicao}]}
        this.rankingDiarioPorGrupo = {}; // {grupoId: [{numero, megasDia, comprasDia, posicao}]}
        this.mensagensRanking = {}; // {grupoId: {messageId: string, ultimaAtualizacao: date, lideres: {dia: numero, semana: numero, geral: numero}}}

        // Cache inteligente para otimizar salvamentos
        this.cacheDados = {
            lastSave: 0,
            pendingChanges: false,
            saveTimer: null,
            minInterval: 30000 // Mínimo 30 segundos entre salvamentos
        };

        // Cache para rankings (evitar recalcular constantemente)
        this.cacheRankings = {
            lastUpdate: {},
            data: {},
            debounceTimer: null,
            debounceInterval: 5000 // 5 segundos de debounce
        };
        
        // Carregar dados existentes
        this.carregarDados();
        
        console.log('🛒 Sistema de Compras inicializado!');
    }

    // === CARREGAR DADOS PERSISTIDOS ===
    async carregarDados() {
        try {

            // Carregar histórico de compradores com backup automático
            try {
                const dadosCompradores = await fs.readFile(this.ARQUIVO_COMPRADORES, 'utf8');
                const dadosParsados = JSON.parse(dadosCompradores);

                // Validar se os dados carregados são válidos
                if (dadosParsados && typeof dadosParsados === 'object') {
                    this.historicoCompradores = dadosParsados;
                    console.log(`✅ Histórico carregado com sucesso: ${Object.keys(this.historicoCompradores).length} compradores`);

                    // BACKUP AUTOMÁTICO DESATIVADO - apenas carregamento inicial
                    // await this.criarBackupHistorico();
                } else {
                    throw new Error('Dados inválidos no arquivo de histórico');
                }
            } catch (error) {
                console.log(`⚠️ Erro ao carregar histórico: ${error.message}`);

                // Tentar restaurar do backup
                const backupRestaurado = await this.restaurarBackupHistorico();
                if (backupRestaurado) {
                    console.log('✅ Histórico restaurado do backup!');
                } else {
                    console.log('🛒 Criando novo arquivo de histórico de compradores...');
                    this.historicoCompradores = {};
                    await this.salvarDados(); // Salvar arquivo vazio inicial
                }
            }

            // Carregar compras pendentes
            try {
                const dadosPendentes = await fs.readFile(this.ARQUIVO_COMPRAS_PENDENTES, 'utf8');
                this.comprasPendentes = JSON.parse(dadosPendentes);
                console.log(`🛒 Compras pendentes: ${Object.keys(this.comprasPendentes).length}`);
            } catch (error) {
                console.log('🛒 Criando novo arquivo de compras pendentes...');
                this.comprasPendentes = {};
                await this.salvarDados();
            }

            // Carregar ranking semanal
            try {
                const dadosRankingSemanal = await fs.readFile(this.ARQUIVO_RANKING_SEMANAL, 'utf8');
                this.rankingSemanalPorGrupo = JSON.parse(dadosRankingSemanal);
                console.log(`📈 Rankings semanais carregados: ${Object.keys(this.rankingSemanalPorGrupo).length} grupos`);
            } catch (error) {
                console.log('📈 Criando novo arquivo de ranking semanal...');
                this.rankingSemanalPorGrupo = {};
                await this.salvarDados();
            }

            // Carregar ranking diário por megas
            try {
                const dadosRankingDiario = await fs.readFile(this.ARQUIVO_RANKING_DIARIO_MEGAS, 'utf8');
                this.rankingDiarioPorGrupo = JSON.parse(dadosRankingDiario);
                console.log(`📅 Rankings diários carregados: ${Object.keys(this.rankingDiarioPorGrupo).length} grupos`);
            } catch (error) {
                console.log('📅 Criando novo arquivo de ranking diário...');
                this.rankingDiarioPorGrupo = {};
                await this.salvarDados();
            }

            // Carregar mensagens de ranking
            try {
                const dadosMensagensRanking = await fs.readFile(this.ARQUIVO_MENSAGENS_RANKING, 'utf8');
                this.mensagensRanking = JSON.parse(dadosMensagensRanking);
                console.log(`📌 Mensagens de ranking carregadas: ${Object.keys(this.mensagensRanking).length} grupos`);
            } catch (error) {
                console.log('📌 Criando novo arquivo de mensagens de ranking...');
                this.mensagensRanking = {};
                await this.salvarDados();
            }

            // Limpar compras antigas (mais de 24h)
            await this.limparComprasPendentesAntigas();

            // Migrar dados existentes para incluir contadores diários
            await this.migrarDadosExistentes();

            // Verificar se precisa limpar rankings antigos
            await this.verificarLimpezaRankingsAutomatica();

        } catch (error) {
            console.error('❌ COMPRAS: Erro crítico ao carregar dados:', error);
            // Em caso de erro crítico, inicializar com dados vazios mas funcionais
            this.historicoCompradores = {};
            this.comprasPendentes = {};
            await this.salvarDados();
        }
    }

    // === SALVAR DADOS COM CACHE INTELIGENTE ===
    async salvarDados(forceSave = false) {
        const now = Date.now();

        // Marcar que há mudanças pendentes
        this.cacheDados.pendingChanges = true;

        // Se não forçou salvamento e ainda não passou o intervalo mínimo, agendar para depois
        if (!forceSave && (now - this.cacheDados.lastSave) < this.cacheDados.minInterval) {
            if (!this.cacheDados.saveTimer) {
                this.cacheDados.saveTimer = setTimeout(() => {
                    this.cacheDados.saveTimer = null;
                    if (this.cacheDados.pendingChanges) {
                        this.executarSalvamento();
                    }
                }, this.cacheDados.minInterval - (now - this.cacheDados.lastSave));
            }
            return;
        }

        await this.executarSalvamento();
    }

    // === EXECUTAR SALVAMENTO REAL ===
    async executarSalvamento() {
        try {
            // BACKUP AUTOMÁTICO DESATIVADO PARA PERFORMANCE
            // Backup agora será manual ou agendado, não a cada compra
            // if (Object.keys(this.historicoCompradores).length > 0) {
            //     await this.criarBackupHistorico();
            // }

            // Salvar apenas dados essenciais (rankings desativados para performance)
            const operacoesSalvamento = [
                this.salvarArquivoSeguro(this.ARQUIVO_COMPRADORES, this.historicoCompradores),
                this.salvarArquivoSeguro(this.ARQUIVO_COMPRAS_PENDENTES, this.comprasPendentes)
                // RANKINGS DESATIVADOS PARA PERFORMANCE:
                // this.salvarArquivoSeguro(this.ARQUIVO_RANKING_DIARIO, this.rankingPorGrupo),
                // this.salvarArquivoSeguro(this.ARQUIVO_RANKING_SEMANAL, this.rankingSemanalPorGrupo),
                // this.salvarArquivoSeguro(this.ARQUIVO_RANKING_DIARIO_MEGAS, this.rankingDiarioPorGrupo),
                // this.salvarArquivoSeguro(this.ARQUIVO_MENSAGENS_RANKING, this.mensagensRanking)
            ];

            await Promise.all(operacoesSalvamento);

            // Atualizar cache
            this.cacheDados.lastSave = Date.now();
            this.cacheDados.pendingChanges = false;

        } catch (error) {
            console.error('❌ COMPRAS: Erro crítico ao salvar dados:', error);
            // Tentar salvar um por vez em caso de erro
            await this.salvarIndividualmente();
        }
    }

    // === SALVAR ARQUIVO COM VERIFICAÇÃO ===
    async salvarArquivoSeguro(caminho, dados) {
        try {
            const dadosJSON = JSON.stringify(dados, null, 2);

            // Verificar se os dados são válidos antes de salvar
            if (dadosJSON && dadosJSON !== 'null' && dadosJSON !== 'undefined') {
                await fs.writeFile(caminho, dadosJSON);
            } else {
                console.log(`⚠️ Dados inválidos não salvos: ${path.basename(caminho)}`);
            }
        } catch (error) {
            console.error(`❌ Erro ao salvar ${path.basename(caminho)}:`, error.message);
            throw error;
        }
    }

    // === SALVAR INDIVIDUALMENTE EM CASO DE ERRO ===
    async salvarIndividualmente() {
        console.log('🔄 Tentando salvar arquivos individualmente...');

        try {
            await this.salvarArquivoSeguro(this.ARQUIVO_COMPRADORES, this.historicoCompradores);
        } catch (error) {
            console.error('❌ Falha ao salvar histórico de compradores:', error.message);
        }

        try {
            await this.salvarArquivoSeguro(this.ARQUIVO_COMPRAS_PENDENTES, this.comprasPendentes);
        } catch (error) {
            console.error('❌ Falha ao salvar compras pendentes:', error.message);
        }

        try {
            await this.salvarArquivoSeguro(this.ARQUIVO_RANKING_DIARIO, this.rankingPorGrupo);
        } catch (error) {
            console.error('❌ Falha ao salvar ranking diário:', error.message);
        }

        try {
            await this.salvarArquivoSeguro(this.ARQUIVO_RANKING_SEMANAL, this.rankingSemanalPorGrupo);
        } catch (error) {
            console.error('❌ Falha ao salvar ranking semanal:', error.message);
        }

        try {
            await this.salvarArquivoSeguro(this.ARQUIVO_RANKING_DIARIO_MEGAS, this.rankingDiarioPorGrupo);
        } catch (error) {
            console.error('❌ Falha ao salvar ranking diário:', error.message);
        }

        try {
            await this.salvarArquivoSeguro(this.ARQUIVO_MENSAGENS_RANKING, this.mensagensRanking);
        } catch (error) {
            console.error('❌ Falha ao salvar mensagens de ranking:', error.message);
        }
    }

    // === GARANTIR ESTRUTURA DE DADOS DO CLIENTE ===
    garantirEstruturaDados(numero, grupoId) {
        if (!this.historicoCompradores[numero]) {
            this.historicoCompradores[numero] = {
                comprasTotal: 0,
                ultimaCompra: null,
                megasTotal: 0,
                grupos: {}
            };
        }

        if (!this.historicoCompradores[numero].grupos) {
            this.historicoCompradores[numero].grupos = {};
        }

        if (!this.historicoCompradores[numero].grupos[grupoId]) {
            this.historicoCompradores[numero].grupos[grupoId] = {
                compras: 0,
                megas: 0,
                comprasDia: 0,
                megasDia: 0,
                ultimaCompraDia: null,
                comprasSemana: 0,
                megasSemana: 0,
                ultimaCompraSemana: null
            };
        }
    }

    // === REGISTRAR NOVA COMPRA (AGUARDANDO CONFIRMAÇÃO) ===
    async registrarCompraPendente(referencia, numero, megas, remetente = null, grupoId = null) {
        try {
            console.log(`🛒 Registrando compra pendente - ${referencia}`);
            // Debug removido para privacidade
            
            // Adicionar à lista de pendentes
            this.comprasPendentes[referencia] = {
                numero: numero, // Número que vai receber os megas
                megas: parseInt(megas),
                timestamp: new Date().toISOString(),
                tentativas: 0,
                remetente: remetente, // Quem fez a compra (para parabenização)
                grupoId: grupoId // ID do grupo onde foi feita a compra
            };
            
            await this.salvarDados();
            console.log(`⏳ COMPRAS: Aguardando confirmação para ${referencia}`);
            
            return true;
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao registrar compra pendente:', error);
            return false;
        }
    }

    // === PROCESSAR CONFIRMAÇÃO DO BOT SECUNDÁRIO ===
    async processarConfirmacao(referencia, numeroConfirmado) {
        try {
            console.log(`🛒 COMPRAS: Processando confirmação - ${referencia}`);
            console.log(`📋 COMPRAS: Pendências atuais:`, Object.keys(this.comprasPendentes));
            
            // Verificar se existe compra pendente
            if (!this.comprasPendentes[referencia]) {
                console.log(`⚠️ COMPRAS: Confirmação ${referencia} não encontrada nas pendências`);
                console.log(`📋 COMPRAS: Tentando busca case-insensitive...`);
                
                // Tentar busca case-insensitive
                const referenciaEncontrada = Object.keys(this.comprasPendentes).find(
                    ref => ref.toUpperCase() === referencia.toUpperCase()
                );
                
                if (!referenciaEncontrada) {
                    console.log(`❌ COMPRAS: Referência ${referencia} realmente não encontrada`);
                    return null;
                }
                
                console.log(`✅ COMPRAS: Referência encontrada com diferença de case: ${referenciaEncontrada}`);
                referencia = referenciaEncontrada; // Usar a referência correta
            }
            
            const compraPendente = this.comprasPendentes[referencia];
            const numero = compraPendente.numero; // Número que recebe os megas
            const megas = compraPendente.megas;
            const remetente = compraPendente.remetente; // Quem fez a compra
            
            // Verificar se o número confere (opcional, para segurança)
            if (numeroConfirmado && numeroConfirmado !== numero) {
                console.log(`⚠️ COMPRAS: Número da confirmação (${numeroConfirmado}) não confere com pendência (${numero})`);
            }
            
            // Registrar compra confirmada para o REMETENTE (quem comprou)
            const numeroComprador = remetente || numero; // Fallback para compatibilidade
            console.log(`🔍 Processando parabenização`);
            await this.registrarCompraConfirmada(numeroComprador, megas, referencia, compraPendente.grupoId);
            
            // Remover das pendentes
            delete this.comprasPendentes[referencia];
            await this.salvarDados();
            
            // Gerar mensagem de parabenização para o REMETENTE (quem comprou)
            const mensagemParabenizacao = await this.gerarMensagemParabenizacao(numeroComprador, megas, compraPendente.grupoId);
            
            console.log(`✅ COMPRAS: Confirmação processada para ${numero} - ${megas}MB`);
            console.log(`💬 COMPRAS: Mensagem de parabenização:`, mensagemParabenizacao ? 'GERADA' : 'NÃO GERADA');
            
            return {
                numero: numero, // Número que recebeu os megas  
                numeroComprador: numeroComprador, // Número de quem fez a compra (para menção)
                megas: megas,
                referencia: referencia,
                mensagem: mensagemParabenizacao ? mensagemParabenizacao.mensagem : null,
                contactId: mensagemParabenizacao ? mensagemParabenizacao.contactId : null
            };
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao processar confirmação:', error);
            return null;
        }
    }

    // === REGISTRAR COMPRA CONFIRMADA ===
    async registrarCompraConfirmada(numero, megas, referencia, grupoId = null) {
        try {
            const agora = new Date();
            const hoje = agora.toISOString();
            const hojeDia = agora.toDateString(); // Para comparar apenas o dia

            // Garantir estrutura de dados completa
            this.garantirEstruturaDados(numero, grupoId);

            // Inicializar datas se primeira compra
            if (!this.historicoCompradores[numero].primeiraCompra) {
                this.historicoCompradores[numero].primeiraCompra = hoje;
            }

            const cliente = this.historicoCompradores[numero];

            // Atualizar contadores gerais
            cliente.comprasTotal++;
            cliente.megasTotal += megas;
            cliente.ultimaCompra = hoje;

            // Atualizar contadores por grupo
            if (grupoId) {
                const grupoData = cliente.grupos[grupoId];

                // Verificar se é uma nova compra do dia
                const ultimaCompraDia = grupoData.ultimaCompraDia ? new Date(grupoData.ultimaCompraDia).toDateString() : null;

                if (ultimaCompraDia !== hojeDia) {
                    // Nova compra do dia - resetar contadores diários
                    console.log(`🆕 Primeira compra do dia para ${numero} no grupo ${grupoId}`);
                    grupoData.comprasDia = 1;
                    grupoData.megasDia = megas;
                } else {
                    // Compra adicional do mesmo dia
                    grupoData.comprasDia++;
                    grupoData.megasDia += megas;
                    console.log(`🔄 Compra adicional (${grupoData.comprasDia}ª do dia) para ${numero} no grupo ${grupoId}`);
                }

                // Verificar se é uma nova compra da semana
                const ultimaCompraSemana = grupoData.ultimaCompraSemana ? new Date(grupoData.ultimaCompraSemana) : null;
                const inicioSemanaAtual = this.obterInicioSemana(agora);
                const inicioSemanaUltima = ultimaCompraSemana ? this.obterInicioSemana(ultimaCompraSemana) : null;

                if (!inicioSemanaUltima || inicioSemanaAtual.getTime() !== inicioSemanaUltima.getTime()) {
                    // Nova semana - resetar contador semanal
                    console.log(`📅 Nova semana detectada para ${numero} no grupo ${grupoId}`);
                    grupoData.comprasSemana = 1;
                    grupoData.megasSemana = megas;
                } else {
                    // Compra adicional da mesma semana
                    grupoData.comprasSemana++;
                    grupoData.megasSemana += megas;
                    console.log(`📈 Compra semanal (${grupoData.comprasSemana}ª da semana) para ${numero} no grupo ${grupoId}`);
                }

                // Atualizar contadores totais do grupo
                grupoData.compras++;
                grupoData.megas += megas;
                grupoData.ultimaCompraDia = hoje;
                grupoData.ultimaCompraSemana = hoje;
            }
            
            // SISTEMA DE RANKINGS DESATIVADO PARA PERFORMANCE
            // Rankings consomem muito CPU/memória - desativado temporariamente
            // if (grupoId) {
            //     this.atualizarRankingsComDebounce(grupoId);
            // }

            // SALVAMENTO AUTOMÁTICO APÓS CADA COMPRA CONFIRMADA
            await this.salvarDados();

            // VERIFICAR SE HOUVE MUDANÇA DE LÍDERES PARA ATUALIZAR MENSAGEM DE RANKING
            if (grupoId) {
                try {
                    const verificacao = await this.verificarMudancaLideres(grupoId);
                    if (verificacao.houveMudanca) {
                        console.log(`🏆 Mudança de líder detectada no grupo ${grupoId}:`, verificacao.mudancas);
                        // A mensagem será atualizada pelo bot principal usando as funções de ranking
                        // Atualizar apenas os dados internos sem enviar mensagem aqui
                        await this.atualizarMensagemRanking(grupoId);
                    }
                } catch (error) {
                    console.log('⚠️ Erro ao verificar mudança de líderes:', error.message);
                }
            }

            console.log(`📊 Cliente atualizado - ${cliente.comprasTotal} compras | ${cliente.megasTotal}MB`);

        } catch (error) {
            console.error('❌ COMPRAS: Erro ao registrar compra confirmada:', error);
        }
    }

    // === GERAR MENSAGEM DE PARABENIZAÇÃO ===
    async gerarMensagemParabenizacao(numero, megas, grupoId = null) {
        try {
            const cliente = this.historicoCompradores[numero];
            if (!cliente) return null;

            // Obter posições em todos os rankings
            console.log(`🔍 DEBUG: Obtendo posições para ${numero} no grupo ${grupoId}`);
            const posicaoGeral = await this.obterPosicaoClienteGrupo(numero, grupoId);
            console.log(`📊 DEBUG: Posição geral - ${posicaoGeral.posicao}º lugar (${posicaoGeral.megas}MB)`);

            const posicaoSemanal = await this.obterPosicaoClienteSemana(numero, grupoId);
            console.log(`📊 DEBUG: Posição semanal - ${posicaoSemanal.posicao}º lugar (${posicaoSemanal.megasSemana}MB)`);

            const posicaoDiaria = await this.obterPosicaoClienteDia(numero, grupoId);
            console.log(`📊 DEBUG: Posição diária - ${posicaoDiaria.posicao}º lugar (${posicaoDiaria.megasDia}MB)`);

            // Converter megas para GB quando necessário
            const megasFormatados = megas >= 1024 ? `${(megas/1024).toFixed(1)} GB` : `${megas} MB`;

            // Dados do cliente no grupo
            const comprasDoDia = grupoId && cliente.grupos[grupoId] ? cliente.grupos[grupoId].comprasDia : 1;
            const megasGrupo = grupoId && cliente.grupos[grupoId] ? cliente.grupos[grupoId].megas : 0;
            const totalFormatado = megasGrupo >= 1024 ? `${(megasGrupo/1024).toFixed(1)} GB` : `${megasGrupo} MB`;

            // Formatar valores dos rankings
            const megasDiaFormatados = posicaoDiaria.megasDia >= 1024 ?
                `${(posicaoDiaria.megasDia/1024).toFixed(1)} GB` : `${posicaoDiaria.megasDia} MB`;

            const megasSemanaFormatados = posicaoSemanal.megasSemana >= 1024 ?
                `${(posicaoSemanal.megasSemana/1024).toFixed(1)} GB` : `${posicaoSemanal.megasSemana} MB`;

            const megasGeralFormatados = posicaoGeral.megas >= 1024 ?
                `${(posicaoGeral.megas/1024).toFixed(1)} GB` : `${posicaoGeral.megas} MB`;

            console.log(`📊 DEBUG Rankings: ${numero} - Dia: ${posicaoDiaria.posicao}º, Semana: ${posicaoSemanal.posicao}º, Geral: ${posicaoGeral.posicao}º`);

            // Linha de agradecimento
            let mensagem = '';
            if (comprasDoDia === 1) {
                mensagem = `🎉 Obrigado, @NOME_PLACEHOLDER, Você está fazendo a sua 1ª compra do dia! Foram adicionados ${megasFormatados}, totalizando ${totalFormatado} comprados.\n\n`;
            } else {
                mensagem = `🎉 Obrigado, @NOME_PLACEHOLDER, Você está fazendo a sua ${comprasDoDia}ª compra do dia! Foram adicionados ${megasFormatados}, totalizando ${totalFormatado} comprados.\n\n`;
            }

            // Rankings das três categorias
            mensagem += `📊 Suas posições nos rankings:\n`;
            mensagem += `🏅 Hoje: ${posicaoDiaria.posicao}º lugar (${megasDiaFormatados})\n`;
            mensagem += `📅 Semana: ${posicaoSemanal.posicao}º lugar (${megasSemanaFormatados})\n`;
            mensagem += `🏆 Geral: ${posicaoGeral.posicao}º lugar (${megasGeralFormatados})\n\n`;

            // Mensagem motivacional baseada na melhor posição
            const melhorPosicao = Math.min(posicaoDiaria.posicao, posicaoSemanal.posicao, posicaoGeral.posicao);

            if (melhorPosicao === 1) {
                mensagem += `Continue comprando para manter sua liderança e garantir seus bônus especiais! 💪`;
            } else if (melhorPosicao <= 3) {
                mensagem += `Continue comprando para subir nos rankings e desbloquear bônus especiais! 💪`;
            } else {
                mensagem += `Continue comprando para subir nos rankings e desbloquear bônus especiais! 💪`;
            }

            return {
                mensagem: mensagem,
                contactId: numero + '@c.us'
            };

        } catch (error) {
            console.error('❌ COMPRAS: Erro ao gerar mensagem:', error);
            return {
                mensagem: `🎉 Obrigado, @NOME_PLACEHOLDER, sua compra foi registrada com sucesso!`,
                contactId: numero + '@c.us'
            };
        }
    }

    // === ATUALIZAR RANKINGS COM DEBOUNCE (OTIMIZADO) ===
    atualizarRankingsComDebounce(grupoId) {
        // Cancelar timer anterior se existir
        if (this.cacheRankings.debounceTimer) {
            clearTimeout(this.cacheRankings.debounceTimer);
        }

        // Marcar grupo para atualização
        if (!this.cacheRankings.pendingUpdates) {
            this.cacheRankings.pendingUpdates = new Set();
        }
        this.cacheRankings.pendingUpdates.add(grupoId);

        // Agendar atualização
        this.cacheRankings.debounceTimer = setTimeout(async () => {
            const gruposParaAtualizar = [...this.cacheRankings.pendingUpdates];
            this.cacheRankings.pendingUpdates.clear();

            // Atualizar todos os grupos pendentes
            for (const grupo of gruposParaAtualizar) {
                try {
                    await this.atualizarRankingGrupo(grupo);
                    await this.atualizarRankingSemanalGrupo(grupo);
                    await this.atualizarRankingDiarioGrupo(grupo);
                } catch (error) {
                    console.error(`❌ Erro ao atualizar rankings do grupo ${grupo}:`, error.message);
                }
            }
        }, this.cacheRankings.debounceInterval);
    }

    // === ATUALIZAR RANKING POR GRUPO === (DESATIVADO)
    async atualizarRankingGrupo(grupoId) {
        // SISTEMA DE RANKINGS DESATIVADO PARA PERFORMANCE
        return;
        try {
            if (!grupoId) return;
            
            // Criar array de ranking ordenado por megas do grupo
            const rankingGrupo = Object.entries(this.historicoCompradores)
                .filter(([numero, dados]) => dados.grupos && dados.grupos[grupoId] && dados.grupos[grupoId].megas > 0)
                .map(([numero, dados]) => ({
                    numero: numero,
                    megas: dados.grupos[grupoId].megas,
                    compras: dados.grupos[grupoId].compras,
                    megasTotal: dados.megasTotal
                }))
                .sort((a, b) => b.megas - a.megas)
                .map((item, index) => ({
                    ...item,
                    posicao: index + 1
                }));
            
            // Salvar ranking do grupo
            if (!this.rankingPorGrupo[grupoId]) {
                this.rankingPorGrupo[grupoId] = [];
            }
            this.rankingPorGrupo[grupoId] = rankingGrupo;
            
            await this.salvarDados();
            
            console.log(`🏆 Ranking atualizado - ${rankingGrupo.length} participantes`);
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao atualizar ranking do grupo:', error);
        }
    }

    // === OBTER POSIÇÃO DO CLIENTE NO GRUPO ===
    async obterPosicaoClienteGrupo(numero, grupoId) {
        console.log(`🔍 DEBUG GERAL: Buscando ${numero} no grupo ${grupoId}`);
        if (!grupoId || !this.rankingPorGrupo[grupoId]) {
            console.log(`❌ DEBUG GERAL: Grupo ${grupoId} não encontrado ou vazio`);
            return { posicao: 1, megas: 0 };
        }

        console.log(`📊 DEBUG GERAL: Ranking tem ${this.rankingPorGrupo[grupoId].length} participantes`);
        const posicao = this.rankingPorGrupo[grupoId].find(item => item.numero === numero);
        const resultado = posicao || { posicao: this.rankingPorGrupo[grupoId].length + 1, megas: 0 };
        console.log(`📊 DEBUG GERAL: Resultado - ${resultado.posicao}º lugar (${resultado.megas}MB)`);
        return resultado;
    }

    // === OBTER LÍDER DO GRUPO ===
    async obterLiderGrupo(grupoId) {
        if (!grupoId || !this.rankingPorGrupo[grupoId] || this.rankingPorGrupo[grupoId].length === 0) {
            return { numero: '000000000', megas: 0, compras: 0 };
        }
        
        return this.rankingPorGrupo[grupoId][0];
    }

    // === LIMPAR COMPRAS PENDENTES ANTIGAS ===
    async limparComprasPendentesAntigas() {
        try {
            const agora = new Date();
            const limite = 24 * 60 * 60 * 1000; // 24 horas em ms
            
            const referenciasAntigas = Object.keys(this.comprasPendentes).filter(ref => {
                const timestamp = new Date(this.comprasPendentes[ref].timestamp);
                return (agora - timestamp) > limite;
            });
            
            referenciasAntigas.forEach(ref => {
                console.log(`🛒 Removendo compra pendente antiga: ${ref}`);
                delete this.comprasPendentes[ref];
            });
            
            if (referenciasAntigas.length > 0) {
                await this.salvarDados();
            }
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao limpar pendentes antigas:', error);
        }
    }


    // === ESTATÍSTICAS POR GRUPO ===
    async obterEstatisticasGrupo(grupoId) {
        if (!grupoId || !this.rankingPorGrupo[grupoId]) {
            return {
                totalCompradores: 0,
                compradoresAtivos: 0,
                comprasPendentes: 0,
                ranking: [],
                totalMegas: 0
            };
        }
        
        const rankingGrupo = this.rankingPorGrupo[grupoId];
        const comprasPendentesGrupo = Object.values(this.comprasPendentes).filter(p => p.grupoId === grupoId).length;
        
        return {
            totalCompradores: Object.values(this.historicoCompradores).filter(c => c.grupos[grupoId]).length,
            compradoresAtivos: rankingGrupo.length,
            comprasPendentes: comprasPendentesGrupo,
            ranking: rankingGrupo.slice(0, 10), // Top 10
            totalMegas: rankingGrupo.reduce((sum, item) => sum + item.megas, 0)
        };
    }

    // === COMANDOS ADMINISTRATIVOS ===
    async obterRankingCompletoGrupo(grupoId) {
        if (!grupoId || !this.rankingPorGrupo[grupoId]) {
            return [];
        }
        
        // Retornar todos os compradores ordenados por megas do grupo
        return this.rankingPorGrupo[grupoId].map(item => ({
            numero: item.numero,
            posicao: item.posicao,
            megas: item.megas,
            compras: item.compras,
            megasTotal: item.megasTotal
        }));
    }

    // === RESET MANUAL DO RANKING POR GRUPO ===
    async resetarRankingGrupo(grupoId) {
        try {
            let clientesResetados = 0;
            const dataReset = new Date().toISOString();
            
            if (!grupoId) {
                throw new Error('ID do grupo é obrigatório');
            }
            
            // Resetar contadores do grupo específico
            Object.entries(this.historicoCompradores).forEach(([numero, cliente]) => {
                if (cliente.grupos[grupoId] && (cliente.grupos[grupoId].compras > 0 || cliente.grupos[grupoId].megas > 0)) {
                    console.log(`🔄 Resetando cliente - ${cliente.grupos[grupoId].compras} compras`);
                    cliente.grupos[grupoId].compras = 0;
                    cliente.grupos[grupoId].megas = 0;
                    clientesResetados++;
                }
            });
            
            // Limpar ranking do grupo
            if (this.rankingPorGrupo[grupoId]) {
                this.rankingPorGrupo[grupoId] = [];
            }
            
            // Salvar dados
            await this.salvarDados();
            
            console.log(`✅ Ranking resetado - ${clientesResetados} clientes afetados`);
            
            return {
                success: true,
                clientesResetados: clientesResetados,
                dataReset: dataReset,
                grupoId: grupoId,
                message: `Ranking do grupo resetado com sucesso! ${clientesResetados} clientes afetados.`
            };
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao resetar ranking do grupo:', error);
            return {
                success: false,
                error: error.message,
                message: `Erro ao resetar ranking do grupo: ${error.message}`
            };
        }
    }

    async obterInativos() {
        const agora = new Date();
        const limite = 10 * 24 * 60 * 60 * 1000; // 10 dias em ms
        const hoje = agora.toDateString();
        
        const inativos = [];
        
        for (const [numero, dados] of Object.entries(this.historicoCompradores)) {
            if (dados.totalCompras > 0) {
                const ultimaCompra = new Date(dados.ultimaCompra);
                const tempoSemComprar = agora - ultimaCompra;
                
                if (tempoSemComprar > limite) {
                    const diasSemComprar = Math.floor(tempoSemComprar / (24 * 60 * 60 * 1000));
                    inativos.push({
                        numero: numero,
                        ultimaCompra: dados.ultimaCompra,
                        diasSemComprar: diasSemComprar,
                        totalCompras: dados.totalCompras,
                        megasTotal: dados.megasTotal
                    });
                }
            }
        }
        
        // Ordenar por dias sem comprar (mais dias primeiro)
        return inativos.sort((a, b) => b.diasSemComprar - a.diasSemComprar);
    }

    async obterSemCompra() {
        // Para identificar quem nunca comprou, precisamos comparar com uma lista de contatos
        // Por enquanto, vamos retornar apenas estatísticas dos registrados que têm 0 compras
        const semCompra = [];
        
        for (const [numero, dados] of Object.entries(this.historicoCompradores)) {
            if (dados.totalCompras === 0) {
                semCompra.push({
                    numero: numero,
                    primeiraCompra: dados.primeiraCompra,
                    totalCompras: dados.totalCompras,
                    megasTotal: dados.megasTotal
                });
            }
        }

        return semCompra;
    }

    // === FUNÇÕES AUXILIARES PARA SEMANAS ===

    // === OBTER INÍCIO DA SEMANA (SEGUNDA-FEIRA) ===
    obterInicioSemana(data) {
        const inicio = new Date(data);
        const diaSemana = inicio.getDay(); // 0 = domingo, 1 = segunda, etc.
        const diasParaSegunda = diaSemana === 0 ? -6 : 1 - diaSemana; // Ajustar para segunda-feira

        inicio.setDate(inicio.getDate() + diasParaSegunda);
        inicio.setHours(0, 0, 0, 0);

        return inicio;
    }

    // === OBTER NÚMERO DA SEMANA DO ANO ===
    obterNumeroSemana(data) {
        const inicioAno = new Date(data.getFullYear(), 0, 1);
        const diferenca = data - inicioAno;
        const diasDecorridos = Math.floor(diferenca / (24 * 60 * 60 * 1000));
        return Math.ceil((diasDecorridos + inicioAno.getDay() + 1) / 7);
    }

    // === ATUALIZAR RANKING SEMANAL POR GRUPO === (DESATIVADO)
    async atualizarRankingSemanalGrupo(grupoId) {
        // SISTEMA DE RANKINGS DESATIVADO PARA PERFORMANCE
        return;
        try {
            if (!grupoId) return;

            // Criar array de ranking semanal ordenado por megas da semana
            const rankingSemanal = Object.entries(this.historicoCompradores)
                .filter(([numero, dados]) =>
                    dados.grupos &&
                    dados.grupos[grupoId] &&
                    dados.grupos[grupoId].megasSemana > 0
                )
                .map(([numero, dados]) => ({
                    numero: numero,
                    megasSemana: dados.grupos[grupoId].megasSemana,
                    comprasSemana: dados.grupos[grupoId].comprasSemana,
                    megasTotal: dados.megasTotal,
                    comprasTotal: dados.grupos[grupoId].compras
                }))
                .sort((a, b) => b.megasSemana - a.megasSemana)
                .map((item, index) => ({
                    ...item,
                    posicao: index + 1
                }));

            // Salvar ranking semanal do grupo
            if (!this.rankingSemanalPorGrupo[grupoId]) {
                this.rankingSemanalPorGrupo[grupoId] = [];
            }
            this.rankingSemanalPorGrupo[grupoId] = rankingSemanal;

            await this.salvarDados();

            console.log(`🏆📅 Ranking semanal atualizado - ${rankingSemanal.length} participantes`);

        } catch (error) {
            console.error('❌ COMPRAS: Erro ao atualizar ranking semanal do grupo:', error);
        }
    }

    // === OBTER MELHOR COMPRADOR DA SEMANA ===
    async obterMelhorCompradorSemana(grupoId) {
        if (!grupoId || !this.rankingSemanalPorGrupo[grupoId] || this.rankingSemanalPorGrupo[grupoId].length === 0) {
            return null;
        }

        return this.rankingSemanalPorGrupo[grupoId][0]; // Primeiro colocado
    }

    // === OBTER TOP 5 COMPRADORES DA SEMANA ===
    async obterTop5CompradoresTodaSemana(grupoId) {
        if (!grupoId || !this.rankingSemanalPorGrupo[grupoId]) {
            return [];
        }

        return this.rankingSemanalPorGrupo[grupoId].slice(0, 5);
    }

    // === OBTER POSIÇÃO SEMANAL DO CLIENTE ===
    async obterPosicaoClienteSemana(numero, grupoId) {
        if (!grupoId || !this.rankingSemanalPorGrupo[grupoId]) {
            return { posicao: 1, megasSemana: 0, comprasSemana: 0 };
        }

        const posicao = this.rankingSemanalPorGrupo[grupoId].find(item => item.numero === numero);
        const resultado = posicao || {
            posicao: this.rankingSemanalPorGrupo[grupoId].length + 1,
            megasSemana: 0,
            comprasSemana: 0
        };
        return resultado;
    }

    // === ESTATÍSTICAS SEMANAIS POR GRUPO ===
    async obterEstatisticasSemanaisGrupo(grupoId) {
        if (!grupoId || !this.rankingSemanalPorGrupo[grupoId]) {
            return {
                melhorComprador: null,
                totalCompradores: 0,
                totalMegasSemana: 0,
                totalComprasSemana: 0,
                top5: []
            };
        }

        const rankingSemanal = this.rankingSemanalPorGrupo[grupoId];
        const melhorComprador = rankingSemanal.length > 0 ? rankingSemanal[0] : null;

        return {
            melhorComprador: melhorComprador,
            totalCompradores: rankingSemanal.length,
            totalMegasSemana: rankingSemanal.reduce((sum, item) => sum + item.megasSemana, 0),
            totalComprasSemana: rankingSemanal.reduce((sum, item) => sum + item.comprasSemana, 0),
            top5: rankingSemanal.slice(0, 5),
            semanaAtual: this.obterNumeroSemana(new Date())
        };
    }

    // === RESET RANKING SEMANAL (MANUAL) ===
    async resetarRankingSemanalGrupo(grupoId) {
        try {
            let clientesResetados = 0;
            const dataReset = new Date().toISOString();

            if (!grupoId) {
                throw new Error('ID do grupo é obrigatório');
            }

            // Resetar contadores semanais do grupo específico
            Object.entries(this.historicoCompradores).forEach(([numero, cliente]) => {
                if (cliente.grupos[grupoId] &&
                    (cliente.grupos[grupoId].comprasSemana > 0 || cliente.grupos[grupoId].megasSemana > 0)) {

                    console.log(`🔄 Resetando dados semanais - ${cliente.grupos[grupoId].comprasSemana} compras da semana`);
                    cliente.grupos[grupoId].comprasSemana = 0;
                    cliente.grupos[grupoId].megasSemana = 0;
                    cliente.grupos[grupoId].ultimaCompraSemana = null;
                    clientesResetados++;
                }
            });

            // Limpar ranking semanal do grupo
            if (this.rankingSemanalPorGrupo[grupoId]) {
                this.rankingSemanalPorGrupo[grupoId] = [];
            }

            // Salvar dados
            await this.salvarDados();

            console.log(`✅ Ranking semanal resetado - ${clientesResetados} clientes afetados`);

            return {
                success: true,
                clientesResetados: clientesResetados,
                dataReset: dataReset,
                grupoId: grupoId,
                message: `Ranking semanal do grupo resetado com sucesso! ${clientesResetados} clientes afetados.`
            };

        } catch (error) {
            console.error('❌ COMPRAS: Erro ao resetar ranking semanal do grupo:', error);
            return {
                success: false,
                error: error.message,
                message: `Erro ao resetar ranking semanal do grupo: ${error.message}`
            };
        }
    }

    // === SISTEMA DE RANKING DIÁRIO ===

    // === ATUALIZAR RANKING DIÁRIO POR GRUPO === (DESATIVADO)
    async atualizarRankingDiarioGrupo(grupoId) {
        // SISTEMA DE RANKINGS DESATIVADO PARA PERFORMANCE
        return;
        try {
            if (!grupoId) return;

            // Criar array de ranking diário ordenado por megas do dia
            const rankingDiario = Object.entries(this.historicoCompradores)
                .filter(([numero, dados]) =>
                    dados.grupos &&
                    dados.grupos[grupoId] &&
                    dados.grupos[grupoId].megasDia > 0
                )
                .map(([numero, dados]) => ({
                    numero: numero,
                    megasDia: dados.grupos[grupoId].megasDia,
                    comprasDia: dados.grupos[grupoId].comprasDia,
                    megasTotal: dados.megasTotal,
                    comprasTotal: dados.grupos[grupoId].compras
                }))
                .sort((a, b) => b.megasDia - a.megasDia)
                .map((item, index) => ({
                    ...item,
                    posicao: index + 1
                }));

            // Salvar ranking diário do grupo
            if (!this.rankingDiarioPorGrupo[grupoId]) {
                this.rankingDiarioPorGrupo[grupoId] = [];
            }
            this.rankingDiarioPorGrupo[grupoId] = rankingDiario;

            await this.salvarDados();

            console.log(`🏆📅 Ranking diário atualizado - ${rankingDiario.length} participantes`);

        } catch (error) {
            console.error('❌ COMPRAS: Erro ao atualizar ranking diário do grupo:', error);
        }
    }

    // === OBTER MELHOR COMPRADOR DO DIA ===
    async obterMelhorCompradorDia(grupoId) {
        if (!grupoId || !this.rankingDiarioPorGrupo[grupoId] || this.rankingDiarioPorGrupo[grupoId].length === 0) {
            return null;
        }

        return this.rankingDiarioPorGrupo[grupoId][0]; // Primeiro colocado
    }

    // === OBTER TOP 5 COMPRADORES DO DIA ===
    async obterTop5CompradoresDia(grupoId) {
        if (!grupoId || !this.rankingDiarioPorGrupo[grupoId]) {
            return [];
        }

        return this.rankingDiarioPorGrupo[grupoId].slice(0, 5);
    }

    // === OBTER POSIÇÃO DIÁRIA DO CLIENTE ===
    async obterPosicaoClienteDia(numero, grupoId) {
        console.log(`🔍 DEBUG DIÁRIO: Buscando ${numero} no grupo ${grupoId}`);
        if (!grupoId || !this.rankingDiarioPorGrupo[grupoId]) {
            console.log(`❌ DEBUG DIÁRIO: Grupo ${grupoId} não encontrado ou vazio`);
            return { posicao: 1, megasDia: 0, comprasDia: 0 };
        }

        console.log(`📊 DEBUG DIÁRIO: Ranking tem ${this.rankingDiarioPorGrupo[grupoId].length} participantes`);
        const posicao = this.rankingDiarioPorGrupo[grupoId].find(item => item.numero === numero);
        const resultado = posicao || {
            posicao: this.rankingDiarioPorGrupo[grupoId].length + 1,
            megasDia: 0,
            comprasDia: 0
        };
        console.log(`📊 DEBUG DIÁRIO: Resultado - ${resultado.posicao}º lugar (${resultado.megasDia}MB)`);
        return resultado;
    }

    // === ESTATÍSTICAS DIÁRIAS POR GRUPO ===
    async obterEstatisticasDiariasGrupo(grupoId) {
        if (!grupoId || !this.rankingDiarioPorGrupo[grupoId]) {
            return {
                melhorComprador: null,
                totalCompradores: 0,
                totalMegasDia: 0,
                totalComprasDia: 0,
                top5: [],
                dataAtual: new Date().toDateString()
            };
        }

        const rankingDiario = this.rankingDiarioPorGrupo[grupoId];
        const melhorComprador = rankingDiario.length > 0 ? rankingDiario[0] : null;

        return {
            melhorComprador: melhorComprador,
            totalCompradores: rankingDiario.length,
            totalMegasDia: rankingDiario.reduce((sum, item) => sum + item.megasDia, 0),
            totalComprasDia: rankingDiario.reduce((sum, item) => sum + item.comprasDia, 0),
            top5: rankingDiario.slice(0, 5),
            dataAtual: new Date().toDateString()
        };
    }

    // === RESET RANKING DIÁRIO (MANUAL) ===
    async resetarRankingDiarioGrupo(grupoId) {
        try {
            let clientesResetados = 0;
            const dataReset = new Date().toISOString();

            if (!grupoId) {
                throw new Error('ID do grupo é obrigatório');
            }

            // Resetar contadores diários do grupo específico
            Object.entries(this.historicoCompradores).forEach(([numero, cliente]) => {
                if (cliente.grupos[grupoId] &&
                    (cliente.grupos[grupoId].comprasDia > 0 || cliente.grupos[grupoId].megasDia > 0)) {

                    console.log(`🔄 Resetando dados diários - ${cliente.grupos[grupoId].comprasDia} compras do dia`);
                    cliente.grupos[grupoId].comprasDia = 0;
                    cliente.grupos[grupoId].megasDia = 0;
                    cliente.grupos[grupoId].ultimaCompraDia = null;
                    clientesResetados++;
                }
            });

            // Limpar ranking diário do grupo
            if (this.rankingDiarioPorGrupo[grupoId]) {
                this.rankingDiarioPorGrupo[grupoId] = [];
            }

            // Salvar dados
            await this.salvarDados();

            console.log(`✅ Ranking diário resetado - ${clientesResetados} clientes afetados`);

            return {
                success: true,
                clientesResetados: clientesResetados,
                dataReset: dataReset,
                grupoId: grupoId,
                message: `Ranking diário do grupo resetado com sucesso! ${clientesResetados} clientes afetados.`
            };

        } catch (error) {
            console.error('❌ COMPRAS: Erro ao resetar ranking diário do grupo:', error);
            return {
                success: false,
                error: error.message,
                message: `Erro ao resetar ranking diário do grupo: ${error.message}`
            };
        }
    }

    // === MIGRAÇÃO DE DADOS EXISTENTES ===
    async migrarDadosExistentes() {
        try {
            let migracaoFeita = false;

            console.log('🔄 Verificando necessidade de migração de dados...');

            Object.entries(this.historicoCompradores).forEach(([numero, cliente]) => {
                if (cliente.grupos) {
                    Object.entries(cliente.grupos).forEach(([grupoId, dadosGrupo]) => {
                        // Verificar se os novos campos existem
                        let precisaMigracao = false;

                        if (dadosGrupo.comprasDia === undefined || dadosGrupo.ultimaCompraDia === undefined) {
                            dadosGrupo.comprasDia = 0;
                            dadosGrupo.ultimaCompraDia = null;
                            precisaMigracao = true;
                        }

                        // Adicionar campos semanais se não existirem
                        if (dadosGrupo.comprasSemana === undefined || dadosGrupo.megasSemana === undefined || dadosGrupo.ultimaCompraSemana === undefined) {
                            dadosGrupo.comprasSemana = 0;
                            dadosGrupo.megasSemana = 0;
                            dadosGrupo.ultimaCompraSemana = null;
                            precisaMigracao = true;
                        }

                        // Adicionar campo megasDia se não existir
                        if (dadosGrupo.megasDia === undefined) {
                            dadosGrupo.megasDia = 0;
                            precisaMigracao = true;
                        }

                        if (precisaMigracao) {
                            console.log(`🔧 Migrando dados para ${numero} no grupo ${grupoId}`);
                            migracaoFeita = true;
                        }
                    });
                }
            });

            if (migracaoFeita) {
                console.log('✅ Migração de dados concluída, salvando...');
                await this.salvarDados();
            } else {
                console.log('ℹ️ Nenhuma migração necessária');
            }

        } catch (error) {
            console.error('❌ Erro na migração de dados:', error.message);
        }
    }

    // === SISTEMA DE BACKUP ROBUSTO ===

    // === GARANTIR QUE PASTA DE BACKUP EXISTE ===
    async garantirPastaBackup() {
        try {
            await fs.mkdir(this.PASTA_BACKUP, { recursive: true });
        } catch (error) {
            // Pasta já existe ou erro criando
            console.log('📁 Pasta de backup verificada');
        }
    }

    // === CRIAR BACKUP DO HISTÓRICO === (DESATIVADO)
    async criarBackupHistorico() {
        // FUNÇÃO DE BACKUP DESATIVADA PARA PERFORMANCE
        // Só será executada manualmente via forcarBackup()
        return;

        try {
            if (Object.keys(this.historicoCompradores).length === 0) {
                return; // Não criar backup de dados vazios
            }

            await this.garantirPastaBackup();

            const agora = new Date();
            const timestamp = agora.toISOString().replace(/[:.]/g, '-');
            const dadosBackup = {
                timestamp: agora.toISOString(),
                versao: '1.0',
                totalCompradores: Object.keys(this.historicoCompradores).length,
                dados: this.historicoCompradores
            };

            // Backup principal (sempre sobrescreve)
            await fs.writeFile(this.ARQUIVO_BACKUP_PRINCIPAL, JSON.stringify(dadosBackup, null, 2));

            // Backup rotativo (manter últimos 7 dias)
            const arquivoRotativo = `${this.ARQUIVO_BACKUP_ROTATIVO}${timestamp}.json`;
            await fs.writeFile(arquivoRotativo, JSON.stringify(dadosBackup, null, 2));

            // Limpar backups antigos (mais de 7 dias)
            await this.limparBackupsAntigos();

            console.log(`💾 Backup criado: ${Object.keys(this.historicoCompradores).length} compradores`);

        } catch (error) {
            console.error('❌ Erro ao criar backup:', error.message);
        }
    }

    // === RESTAURAR BACKUP ===
    async restaurarBackupHistorico() {
        try {
            console.log('🔄 Tentando restaurar backup...');

            // Tentar restaurar backup principal primeiro
            try {
                const dadosBackup = await fs.readFile(this.ARQUIVO_BACKUP_PRINCIPAL, 'utf8');
                const backup = JSON.parse(dadosBackup);

                if (backup.dados && typeof backup.dados === 'object') {
                    this.historicoCompradores = backup.dados;
                    console.log(`✅ Backup principal restaurado: ${Object.keys(this.historicoCompradores).length} compradores`);
                    await this.salvarDados(); // Salvar dados restaurados
                    return true;
                }
            } catch (error) {
                console.log('⚠️ Backup principal não disponível, tentando backups rotativos...');
            }

            // Tentar restaurar do backup rotativo mais recente
            try {
                const arquivos = await fs.readdir(this.PASTA_BACKUP);
                const backupsRotativos = arquivos
                    .filter(arquivo => arquivo.startsWith('historico_compradores_backup_') && arquivo.endsWith('.json'))
                    .sort()
                    .reverse(); // Mais recente primeiro

                for (const arquivo of backupsRotativos) {
                    try {
                        const caminhoBackup = path.join(this.PASTA_BACKUP, arquivo);
                        const dadosBackup = await fs.readFile(caminhoBackup, 'utf8');
                        const backup = JSON.parse(dadosBackup);

                        if (backup.dados && typeof backup.dados === 'object') {
                            this.historicoCompradores = backup.dados;
                            console.log(`✅ Backup rotativo restaurado (${arquivo}): ${Object.keys(this.historicoCompradores).length} compradores`);
                            await this.salvarDados(); // Salvar dados restaurados
                            return true;
                        }
                    } catch (error) {
                        console.log(`⚠️ Backup ${arquivo} corrompido, tentando próximo...`);
                        continue;
                    }
                }
            } catch (error) {
                console.log('⚠️ Erro ao acessar backups rotativos:', error.message);
            }

            console.log('❌ Nenhum backup válido encontrado');
            return false;

        } catch (error) {
            console.error('❌ Erro ao restaurar backup:', error.message);
            return false;
        }
    }

    // === LIMPAR BACKUPS ANTIGOS ===
    async limparBackupsAntigos() {
        try {
            const arquivos = await fs.readdir(this.PASTA_BACKUP);
            const agora = new Date();
            const limiteDias = 7 * 24 * 60 * 60 * 1000; // 7 dias

            const backupsRotativos = arquivos.filter(arquivo =>
                arquivo.startsWith('historico_compradores_backup_') && arquivo.endsWith('.json')
            );

            for (const arquivo of backupsRotativos) {
                try {
                    const caminhoArquivo = path.join(this.PASTA_BACKUP, arquivo);
                    const stats = await fs.stat(caminhoArquivo);
                    const idadeArquivo = agora - stats.mtime;

                    if (idadeArquivo > limiteDias) {
                        await fs.unlink(caminhoArquivo);
                        console.log(`🗑️ Backup antigo removido: ${arquivo}`);
                    }
                } catch (error) {
                    console.log(`⚠️ Erro ao processar backup ${arquivo}:`, error.message);
                }
            }

        } catch (error) {
            console.log('⚠️ Erro ao limpar backups antigos:', error.message);
        }
    }

    // === EXECUTAR BACKUP REAL (APENAS MANUAL) ===
    async executarBackupReal() {
        if (Object.keys(this.historicoCompradores).length === 0) {
            return; // Não criar backup de dados vazios
        }

        await this.garantirPastaBackup();

        const agora = new Date();
        const timestamp = agora.toISOString().replace(/[:.]/g, '-').slice(0, -5);
        const nomeArquivo = `historico_compradores_${timestamp}.json`;
        const caminhoCompleto = path.join(this.PASTA_BACKUP, nomeArquivo);

        // Salvar backup
        await fs.writeFile(caminhoCompleto, JSON.stringify(this.historicoCompradores, null, 2));

        const totalCompradores = Object.keys(this.historicoCompradores).length;
        console.log(`💾 Backup manual criado: ${totalCompradores} compradores`);

        // Limpar backups antigos (manter apenas 5)
        await this.limparBackupsAntigos();
    }

    // === FORÇAR BACKUP MANUAL (PARA COMANDOS ADMIN) ===
    async forcarBackup() {
        try {
            // Executar backup real (pulando a função desativada)
            await this.executarBackupReal();
            const totalCompradores = Object.keys(this.historicoCompradores).length;
            return {
                success: true,
                message: `Backup manual criado com sucesso! ${totalCompradores} compradores salvos.`,
                totalCompradores: totalCompradores,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                success: false,
                message: `Erro ao criar backup: ${error.message}`,
                error: error.message
            };
        }
    }

    // === STATUS DO SISTEMA DE BACKUP ===
    async obterStatusBackup() {
        try {
            await this.garantirPastaBackup();
            const arquivos = await fs.readdir(this.PASTA_BACKUP);

            const backups = arquivos.filter(arquivo =>
                arquivo.startsWith('historico_compradores_backup') && arquivo.endsWith('.json')
            );

            let ultimoBackup = null;
            if (backups.length > 0) {
                const backupPrincipal = backups.find(arquivo => arquivo === 'historico_compradores_backup.json');
                if (backupPrincipal) {
                    const stats = await fs.stat(path.join(this.PASTA_BACKUP, backupPrincipal));
                    ultimoBackup = stats.mtime;
                }
            }

            return {
                totalBackups: backups.length,
                ultimoBackup: ultimoBackup,
                pastBackup: this.PASTA_BACKUP,
                totalCompradores: Object.keys(this.historicoCompradores).length
            };

        } catch (error) {
            return {
                erro: error.message,
                totalCompradores: Object.keys(this.historicoCompradores).length
            };
        }
    }

    // === SISTEMA DE MENSAGEM DE RANKING FIXADA ===

    // Gerar mensagem de ranking com líderes atuais
    async gerarMensagemRanking(grupoId) {
        try {
            const melhorDia = await this.obterMelhorCompradorDia(grupoId);
            const melhorSemana = await this.obterMelhorCompradorSemana(grupoId);
            const melhorGeral = await this.obterLiderGrupo(grupoId);

            let mensagem = '🏆 *RANKING DE LÍDERES* 🏆\n\n';

            // Líder do Dia
            mensagem += '🌟 *COMPRADOR DO DIA*\n';
            if (melhorDia && melhorDia.megasDia > 0) {
                const numero = melhorDia.numero.replace('@c.us', '');
                mensagem += `👑 ${numero}\n`;
                mensagem += `📊 ${melhorDia.megasDia} MB hoje\n`;
                mensagem += `🛒 ${melhorDia.comprasDia} compras\n\n`;
            } else {
                mensagem += '❌ Nenhuma compra hoje\n\n';
            }

            // Líder da Semana
            mensagem += '⭐ *COMPRADOR DA SEMANA*\n';
            if (melhorSemana && melhorSemana.megasSemana > 0) {
                const numero = melhorSemana.numero.replace('@c.us', '');
                mensagem += `👑 ${numero}\n`;
                mensagem += `📊 ${melhorSemana.megasSemana} MB esta semana\n`;
                mensagem += `🛒 ${melhorSemana.comprasSemana} compras\n\n`;
            } else {
                mensagem += '❌ Nenhuma compra esta semana\n\n';
            }

            // Líder Geral
            mensagem += '💎 *COMPRADOR DE SEMPRE*\n';
            if (melhorGeral && melhorGeral.megasTotal > 0) {
                const numero = melhorGeral.numero.replace('@c.us', '');
                mensagem += `👑 ${numero}\n`;
                mensagem += `📊 ${melhorGeral.megasTotal} MB total\n`;
                mensagem += `🛒 ${melhorGeral.comprasTotal} compras\n\n`;
            } else {
                mensagem += '❌ Nenhuma compra registrada\n\n';
            }

            mensagem += '⏰ Atualizado em: ' + new Date().toLocaleString('pt-BR');
            mensagem += '\n\n_Use /ranking para forçar atualização_';

            return mensagem;

        } catch (error) {
            console.log('❌ Erro ao gerar mensagem de ranking:', error);
            return '❌ Erro ao gerar ranking. Tente novamente.';
        }
    }

    // Verificar se houve mudança de líderes
    async verificarMudancaLideres(grupoId) {
        try {
            const melhorDia = await this.obterMelhorCompradorDia(grupoId);
            const melhorSemana = await this.obterMelhorCompradorSemana(grupoId);
            const melhorGeral = await this.obterLiderGrupo(grupoId);

            const lideresAtuais = {
                dia: melhorDia?.numero || null,
                semana: melhorSemana?.numero || null,
                geral: melhorGeral?.numero || null
            };

            // Verificar se temos dados anteriores para este grupo
            if (!this.mensagensRanking[grupoId]) {
                this.mensagensRanking[grupoId] = {
                    messageId: null,
                    ultimaAtualizacao: null,
                    lideres: { dia: null, semana: null, geral: null }
                };
            }

            const lideresAnteriores = this.mensagensRanking[grupoId].lideres;

            // Verificar se houve mudança
            const mudancaDia = lideresAtuais.dia !== lideresAnteriores.dia;
            const mudancaSemana = lideresAtuais.semana !== lideresAnteriores.semana;
            const mudancaGeral = lideresAtuais.geral !== lideresAnteriores.geral;

            const houveMudanca = mudancaDia || mudancaSemana || mudancaGeral;

            return {
                houveMudanca,
                mudancas: {
                    dia: mudancaDia,
                    semana: mudancaSemana,
                    geral: mudancaGeral
                },
                lideresAtuais,
                lideresAnteriores
            };

        } catch (error) {
            console.log('❌ Erro ao verificar mudança de líderes:', error);
            return { houveMudanca: false, mudancas: {}, lideresAtuais: {}, lideresAnteriores: {} };
        }
    }

    // Atualizar dados da mensagem de ranking após edição
    async atualizarMensagemRanking(grupoId, messageId = null) {
        try {
            const verificacao = await this.verificarMudancaLideres(grupoId);

            // Atualizar dados em memória
            this.mensagensRanking[grupoId] = {
                messageId: messageId || this.mensagensRanking[grupoId]?.messageId || null,
                ultimaAtualizacao: new Date().toISOString(),
                lideres: verificacao.lideresAtuais
            };

            // Salvar alterações
            await this.salvarIndividualmente();

            return {
                success: true,
                messageId: this.mensagensRanking[grupoId].messageId,
                houveMudanca: verificacao.houveMudanca,
                mudancas: verificacao.mudancas
            };

        } catch (error) {
            console.log('❌ Erro ao atualizar mensagem de ranking:', error);
            return { success: false, error: error.message };
        }
    }

    // Obter informações da mensagem de ranking de um grupo
    obterInfoMensagemRanking(grupoId) {
        return this.mensagensRanking[grupoId] || {
            messageId: null,
            ultimaAtualizacao: null,
            lideres: { dia: null, semana: null, geral: null }
        };
    }

    // Forçar atualização da mensagem de ranking (comando manual)
    async forcarAtualizacaoRanking(grupoId) {
        try {
            const mensagem = await this.gerarMensagemRanking(grupoId);
            const resultado = await this.atualizarMensagemRanking(grupoId);

            return {
                success: true,
                mensagem,
                messageId: resultado.messageId,
                timestamp: new Date().toISOString()
            };

        } catch (error) {
            console.log('❌ Erro ao forçar atualização de ranking:', error);
            return {
                success: false,
                error: error.message,
                mensagem: '❌ Erro ao atualizar ranking. Tente novamente.'
            };
        }
    }

    // Verificar se precisa criar ou atualizar mensagem de ranking (para o bot principal)
    async verificarNecessidadeAtualizacaoRanking(grupoId) {
        try {
            const info = this.obterInfoMensagemRanking(grupoId);
            const verificacao = await this.verificarMudancaLideres(grupoId);

            return {
                precisaAtualizar: verificacao.houveMudanca,
                precisaCriar: !info.messageId,
                mensagem: await this.gerarMensagemRanking(grupoId),
                mudancas: verificacao.mudancas,
                lideresAtuais: verificacao.lideresAtuais,
                messageIdAtual: info.messageId,
                ultimaAtualizacao: info.ultimaAtualizacao
            };

        } catch (error) {
            console.log('❌ Erro ao verificar necessidade de atualização:', error);
            return {
                precisaAtualizar: false,
                precisaCriar: false,
                mensagem: '❌ Erro ao gerar ranking',
                error: error.message
            };
        }
    }

    // Salvar messageId após criação/edição da mensagem pelo bot
    async salvarMessageIdRanking(grupoId, messageId) {
        try {
            await this.atualizarMensagemRanking(grupoId, messageId);
            console.log(`💾 Message ID salvo para grupo ${grupoId}: ${messageId}`);
            return { success: true, messageId };

        } catch (error) {
            console.log('❌ Erro ao salvar message ID:', error);
            return { success: false, error: error.message };
        }
    }

    // === LIMPEZA AUTOMÁTICA DE RANKINGS ANTIGOS ===
    async verificarLimpezaRankingsAutomatica() {
        try {
            console.log('🔄 Verificando necessidade de limpeza automática de rankings...');

            const agora = new Date();
            const hojeDia = agora.toDateString();
            const inicioSemanaAtual = this.obterInicioSemana(agora);

            // Limpar rankings diários antigos
            await this.limparRankingsDiariosAntigos(hojeDia);

            // Limpar rankings semanais antigos
            await this.limparRankingsSemanaisAntigos(inicioSemanaAtual);

            console.log('✅ Verificação de limpeza de rankings concluída');

        } catch (error) {
            console.error('❌ Erro na limpeza automática de rankings:', error);
        }
    }

    // === LIMPAR RANKINGS DIÁRIOS ANTIGOS ===
    async limparRankingsDiariosAntigos(hojeDia) {
        try {
            let rankingsLimpos = 0;

            for (const [grupoId, ranking] of Object.entries(this.rankingDiarioPorGrupo)) {
                // Verificar se algum participante do ranking tem dados de um dia diferente
                const rankingAtualizado = ranking.filter(participante => {
                    const cliente = this.historicoCompradores[participante.numero];
                    if (!cliente || !cliente.grupos[grupoId]) return false;

                    const ultimaCompraDia = cliente.grupos[grupoId].ultimaCompraDia;
                    if (!ultimaCompraDia) return false;

                    const diaUltimaCompra = new Date(ultimaCompraDia).toDateString();
                    return diaUltimaCompra === hojeDia && cliente.grupos[grupoId].megasDia > 0;
                });

                if (rankingAtualizado.length !== ranking.length) {
                    console.log(`🗑️ Limpando ranking diário do grupo ${grupoId}: ${ranking.length} → ${rankingAtualizado.length}`);

                    // Recalcular posições
                    this.rankingDiarioPorGrupo[grupoId] = rankingAtualizado
                        .sort((a, b) => b.megasDia - a.megasDia)
                        .map((item, index) => ({
                            ...item,
                            posicao: index + 1
                        }));

                    rankingsLimpos++;
                }
            }

            if (rankingsLimpos > 0) {
                console.log(`🧹 ${rankingsLimpos} rankings diários foram limpos`);
                await this.salvarDados();
            }

        } catch (error) {
            console.error('❌ Erro ao limpar rankings diários:', error);
        }
    }

    // === LIMPAR RANKINGS SEMANAIS ANTIGOS ===
    async limparRankingsSemanaisAntigos(inicioSemanaAtual) {
        try {
            let rankingsLimpos = 0;

            for (const [grupoId, ranking] of Object.entries(this.rankingSemanalPorGrupo)) {
                // Verificar se algum participante do ranking tem dados de uma semana diferente
                const rankingAtualizado = ranking.filter(participante => {
                    const cliente = this.historicoCompradores[participante.numero];
                    if (!cliente || !cliente.grupos[grupoId]) return false;

                    const ultimaCompraSemana = cliente.grupos[grupoId].ultimaCompraSemana;
                    if (!ultimaCompraSemana) return false;

                    const inicioSemanaUltima = this.obterInicioSemana(new Date(ultimaCompraSemana));
                    return inicioSemanaUltima.getTime() === inicioSemanaAtual.getTime() && cliente.grupos[grupoId].megasSemana > 0;
                });

                if (rankingAtualizado.length !== ranking.length) {
                    console.log(`🗑️ Limpando ranking semanal do grupo ${grupoId}: ${ranking.length} → ${rankingAtualizado.length}`);

                    // Recalcular posições
                    this.rankingSemanalPorGrupo[grupoId] = rankingAtualizado
                        .sort((a, b) => b.megasSemana - a.megasSemana)
                        .map((item, index) => ({
                            ...item,
                            posicao: index + 1
                        }));

                    rankingsLimpos++;
                }
            }

            if (rankingsLimpos > 0) {
                console.log(`🧹 ${rankingsLimpos} rankings semanais foram limpos`);
                await this.salvarDados();
            }

        } catch (error) {
            console.error('❌ Erro ao limpar rankings semanais:', error);
        }
    }
}

module.exports = SistemaCompras;