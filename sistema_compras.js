const fs = require('fs').promises;
const path = require('path');

class SistemaCompras {
    constructor() {
        console.log('🛒 Inicializando Sistema de Registro de Compras...');
        
        // Arquivos de dados
        this.ARQUIVO_COMPRADORES = path.join(__dirname, 'historico_compradores.json');
        this.ARQUIVO_COMPRAS_PENDENTES = path.join(__dirname, 'compras_pendentes.json');
        this.ARQUIVO_RANKING_DIARIO = path.join(__dirname, 'ranking_diario.json');
        
        // Dados em memória
        this.historicoCompradores = {}; // {numero: {comprasTotal: 0, ultimaCompra: date, megasTotal: 0, grupos: {grupoId: {compras: 0, megas: 0}}}}
        this.comprasPendentes = {}; // {referencia: {numero, megas, timestamp, tentativas, grupoId}}
        this.rankingPorGrupo = {}; // {grupoId: [{numero, megas, compras, posicao}]}
        
        // Carregar dados existentes
        this.carregarDados();
        
        console.log('🛒 Sistema de Compras inicializado!');
    }

    // === CARREGAR DADOS PERSISTIDOS ===
    async carregarDados() {
        try {
            // Carregar histórico de compradores
            try {
                const dadosCompradores = await fs.readFile(this.ARQUIVO_COMPRADORES, 'utf8');
                this.historicoCompradores = JSON.parse(dadosCompradores);
                console.log(`🛒 Histórico carregado: ${Object.keys(this.historicoCompradores).length} compradores`);
            } catch (error) {
                console.log('🛒 Criando novo arquivo de histórico de compradores...');
                this.historicoCompradores = {};
            }

            // Carregar compras pendentes
            try {
                const dadosPendentes = await fs.readFile(this.ARQUIVO_COMPRAS_PENDENTES, 'utf8');
                this.comprasPendentes = JSON.parse(dadosPendentes);
                console.log(`🛒 Compras pendentes: ${Object.keys(this.comprasPendentes).length}`);
            } catch (error) {
                console.log('🛒 Criando novo arquivo de compras pendentes...');
                this.comprasPendentes = {};
            }

            // Limpar compras antigas (mais de 24h)
            await this.limparComprasPendentesAntigas();
            
            // Reset automático removido - agora apenas manual via comando admin

        } catch (error) {
            console.error('❌ COMPRAS: Erro ao carregar dados:', error);
        }
    }

    // === SALVAR DADOS ===
    async salvarDados() {
        try {
            await Promise.all([
                fs.writeFile(this.ARQUIVO_COMPRADORES, JSON.stringify(this.historicoCompradores, null, 2)),
                fs.writeFile(this.ARQUIVO_COMPRAS_PENDENTES, JSON.stringify(this.comprasPendentes, null, 2)),
                fs.writeFile(this.ARQUIVO_RANKING_DIARIO, JSON.stringify(this.rankingDiario, null, 2))
            ]);
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao salvar dados:', error);
        }
    }

    // === REGISTRAR NOVA COMPRA (AGUARDANDO CONFIRMAÇÃO) ===
    async registrarCompraPendente(referencia, numero, megas, remetente = null, grupoId = null) {
        try {
            console.log(`🛒 COMPRAS: Registrando compra pendente - ${referencia} | ${numero} | ${megas}MB | Grupo: ${grupoId}`);
            console.log(`🔍 DEBUG PENDENTE: remetente recebido = "${remetente}"`);
            
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
            console.log(`🔍 COMPRAS: Dados para parabenização - Remetente: ${remetente} | Número: ${numero} | Comprador final: ${numeroComprador}`);
            await this.registrarCompraConfirmada(numeroComprador, megas, referencia);
            
            // Remover das pendentes
            delete this.comprasPendentes[referencia];
            await this.salvarDados();
            
            // Gerar mensagem de parabenização para o REMETENTE (quem comprou)
            const mensagemParabenizacao = await this.gerarMensagemParabenizacao(numeroComprador, megas);
            
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
            const hoje = new Date().toISOString();
            
            // Inicializar cliente se não existe
            if (!this.historicoCompradores[numero]) {
                this.historicoCompradores[numero] = {
                    comprasTotal: 0,
                    megasTotal: 0,
                    ultimaCompra: hoje,
                    primeiraCompra: hoje,
                    grupos: {} // {grupoId: {compras: 0, megas: 0}}
                };
            }
            
            const cliente = this.historicoCompradores[numero];
            
            // Inicializar dados do grupo se não existe
            if (grupoId && !cliente.grupos[grupoId]) {
                cliente.grupos[grupoId] = {
                    compras: 0,
                    megas: 0
                };
            }
            
            // Atualizar contadores gerais
            cliente.comprasTotal++;
            cliente.megasTotal += megas;
            cliente.ultimaCompra = hoje;
            
            // Atualizar contadores por grupo
            if (grupoId) {
                cliente.grupos[grupoId].compras++;
                cliente.grupos[grupoId].megas += megas;
            }
            
            // Atualizar ranking do grupo
            if (grupoId) {
                await this.atualizarRankingGrupo(grupoId);
            }
            
            console.log(`📊 COMPRAS: ${numero} - Total: ${cliente.comprasTotal} compras | ${cliente.megasTotal}MB | Grupo ${grupoId}: ${grupoId ? cliente.grupos[grupoId].compras : 0} compras`);
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao registrar compra confirmada:', error);
        }
    }

    // === GERAR MENSAGEM DE PARABENIZAÇÃO ===
    async gerarMensagemParabenizacao(numero, megas, grupoId = null) {
        try {
            const cliente = this.historicoCompradores[numero];
            if (!cliente) return null;
            
            const posicao = await this.obterPosicaoClienteGrupo(numero, grupoId);
            const lider = await this.obterLiderGrupo(grupoId);
            
            // Converter megas para GB quando necessário
            const megasFormatados = megas >= 1024 ? `${(megas/1024).toFixed(1)} GB` : `${megas} MB`;
            const comprasGrupo = grupoId && cliente.grupos[grupoId] ? cliente.grupos[grupoId].compras : 0;
            const megasGrupo = grupoId && cliente.grupos[grupoId] ? cliente.grupos[grupoId].megas : 0;
            const totalFormatado = megasGrupo >= 1024 ? `${(megasGrupo/1024).toFixed(1)} GB` : `${megasGrupo} MB`;
            
            let mensagem = '';
            
            if (posicao.posicao === 1) {
                // Cliente em 1º lugar - usar placeholder para nome
                mensagem = `🎉 Obrigado, @NOME_PLACEHOLDER! Compra ${comprasGrupo}ª neste grupo! Foram adicionados ${megasFormatados}, totalizando ${totalFormatado} comprados.\n`;
                mensagem += `🏆 Você está em 1º lugar no ranking do grupo! Continue comprando para se manter no topo!`;
            } else {
                // Cliente não está em 1º lugar - usar placeholder para nome
                const liderMegas = lider.megas >= 1024 ? `${(lider.megas/1024).toFixed(1)} GB` : `${lider.megas} MB`;
                
                mensagem = `🎉 Obrigado, @NOME_PLACEHOLDER! Compra ${comprasGrupo}ª neste grupo! Foram adicionados ${megasFormatados}, totalizando ${totalFormatado} comprados.\n`;
                mensagem += `🏅 Você está em ${posicao.posicao}º lugar no ranking do grupo. Continue comprando! O líder já acumulou ${liderMegas}!`;
            }
            
            return {
                mensagem: mensagem,
                contactId: numero + '@c.us'
            };
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao gerar mensagem:', error);
            return {
                mensagem: `🎉 Obrigado, @NOME_PLACEHOLDER! Compra registrada com sucesso!`,
                contactId: numero + '@c.us'
            };
        }
    }

    // === ATUALIZAR RANKING POR GRUPO ===
    async atualizarRankingGrupo(grupoId) {
        try {
            if (!grupoId) return;
            
            // Criar array de ranking ordenado por megas do grupo
            const rankingGrupo = Object.entries(this.historicoCompradores)
                .filter(([numero, dados]) => dados.grupos[grupoId] && dados.grupos[grupoId].megas > 0)
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
            
            console.log(`🏆 RANKING: Grupo ${grupoId} atualizado - ${rankingGrupo.length} participantes`);
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao atualizar ranking do grupo:', error);
        }
    }

    // === OBTER POSIÇÃO DO CLIENTE NO GRUPO ===
    async obterPosicaoClienteGrupo(numero, grupoId) {
        if (!grupoId || !this.rankingPorGrupo[grupoId]) {
            return { posicao: 1, megas: 0 };
        }
        
        const posicao = this.rankingPorGrupo[grupoId].find(item => item.numero === numero);
        return posicao || { posicao: this.rankingPorGrupo[grupoId].length + 1, megas: 0 };
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

    // === RESET MANUAL DO RANKING DIÁRIO ===
    async resetarRankingDiario() {
        try {
            let clientesResetados = 0;
            const dataReset = new Date().toISOString();
            
            // Resetar contadores diários de todos os clientes
            Object.values(this.historicoCompradores).forEach(cliente => {
                if (cliente.comprasHoje > 0 || cliente.megasHoje > 0) {
                    console.log(`🔄 COMPRAS: Resetando ranking para ${cliente.numero} (${cliente.comprasHoje} compras, ${cliente.megasHoje}MB)`);
                    cliente.comprasHoje = 0;
                    cliente.megasHoje = 0;
                    clientesResetados++;
                }
            });
            
            // Limpar ranking diário
            this.rankingDiario = [];
            
            // Salvar dados
            await this.salvarDados();
            
            console.log(`✅ COMPRAS: Ranking resetado! ${clientesResetados} clientes afetados em ${dataReset}`);
            
            return {
                success: true,
                clientesResetados: clientesResetados,
                dataReset: dataReset,
                message: `Ranking diário resetado com sucesso! ${clientesResetados} cliente(s) afetado(s).`
            };
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao resetar ranking diário:', error);
            return {
                success: false,
                error: error.message,
                message: `Erro ao resetar ranking: ${error.message}`
            };
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
                    console.log(`🔄 COMPRAS: Resetando ranking do grupo ${grupoId} para ${numero} (${cliente.grupos[grupoId].compras} compras, ${cliente.grupos[grupoId].megas}MB)`);
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
            
            console.log(`✅ COMPRAS: Ranking do grupo ${grupoId} resetado! ${clientesResetados} clientes afetados em ${dataReset}`);
            
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
}

module.exports = SistemaCompras;