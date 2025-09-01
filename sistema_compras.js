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
        this.historicoCompradores = {}; // {numero: {comprasHoje: 0, totalCompras: 0, ultimaCompra: date, megasHoje: 0, megasTotal: 0}}
        this.comprasPendentes = {}; // {referencia: {numero, megas, timestamp, tentativas}}
        this.rankingDiario = []; // [{numero, megasHoje, comprasHoje, posicao}]
        
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
            
            // Resetar dados diários se necessário
            await this.verificarResetDiario();

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
    async registrarCompraPendente(referencia, numero, megas) {
        try {
            console.log(`🛒 COMPRAS: Registrando compra pendente - ${referencia} | ${numero} | ${megas}MB`);
            
            // Adicionar à lista de pendentes
            this.comprasPendentes[referencia] = {
                numero: numero,
                megas: parseInt(megas),
                timestamp: new Date().toISOString(),
                tentativas: 0
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
            
            // Verificar se existe compra pendente
            if (!this.comprasPendentes[referencia]) {
                console.log(`⚠️ COMPRAS: Confirmação ${referencia} não encontrada nas pendências`);
                return null;
            }
            
            const compraPendente = this.comprasPendentes[referencia];
            const numero = compraPendente.numero;
            const megas = compraPendente.megas;
            
            // Verificar se o número confere (opcional, para segurança)
            if (numeroConfirmado && numeroConfirmado !== numero) {
                console.log(`⚠️ COMPRAS: Número da confirmação (${numeroConfirmado}) não confere com pendência (${numero})`);
            }
            
            // Registrar compra confirmada
            await this.registrarCompraConfirmada(numero, megas, referencia);
            
            // Remover das pendentes
            delete this.comprasPendentes[referencia];
            await this.salvarDados();
            
            // Gerar mensagem de parabenização
            const mensagemParabenizacao = await this.gerarMensagemParabenizacao(numero, megas);
            
            console.log(`✅ COMPRAS: Confirmação processada para ${numero} - ${megas}MB`);
            
            return {
                numero: numero,
                megas: megas,
                referencia: referencia,
                mensagem: mensagemParabenizacao
            };
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao processar confirmação:', error);
            return null;
        }
    }

    // === REGISTRAR COMPRA CONFIRMADA ===
    async registrarCompraConfirmada(numero, megas, referencia) {
        try {
            const hoje = new Date().toDateString();
            
            // Inicializar cliente se não existe
            if (!this.historicoCompradores[numero]) {
                this.historicoCompradores[numero] = {
                    comprasHoje: 0,
                    totalCompras: 0,
                    megasHoje: 0,
                    megasTotal: 0,
                    ultimaCompra: hoje,
                    primeiraCompra: hoje
                };
            }
            
            const cliente = this.historicoCompradores[numero];
            
            // Reset diário se necessário
            if (cliente.ultimaCompra !== hoje) {
                cliente.comprasHoje = 0;
                cliente.megasHoje = 0;
            }
            
            // Atualizar contadores
            cliente.comprasHoje++;
            cliente.totalCompras++;
            cliente.megasHoje += megas;
            cliente.megasTotal += megas;
            cliente.ultimaCompra = hoje;
            
            // Atualizar ranking
            await this.atualizarRanking();
            
            console.log(`📊 COMPRAS: ${numero} - Compra ${cliente.comprasHoje}ª hoje | ${cliente.megasHoje}MB hoje | Total: ${cliente.megasTotal}MB`);
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao registrar compra confirmada:', error);
        }
    }

    // === GERAR MENSAGEM DE PARABENIZAÇÃO ===
    async gerarMensagemParabenizacao(numero, megas) {
        try {
            const cliente = this.historicoCompradores[numero];
            if (!cliente) return null;
            
            const posicao = await this.obterPosicaoCliente(numero);
            const lider = await this.obterLider();
            
            // Converter megas para GB quando necessário
            const megasFormatados = megas >= 1024 ? `${(megas/1024).toFixed(1)} GB` : `${megas} MB`;
            const totalFormatado = cliente.megasHoje >= 1024 ? `${(cliente.megasHoje/1024).toFixed(1)} GB` : `${cliente.megasHoje} MB`;
            
            let mensagem = '';
            
            if (posicao.posicao === 1) {
                // Cliente em 1º lugar
                mensagem = `🎉 Obrigado, @${numero}, Você está fazendo a sua ${cliente.comprasHoje}ª compra do dia! Foram adicionados ${megasFormatados}, totalizando ${totalFormatado} comprados.\n`;
                mensagem += `Você está em 1º lugar no ranking. Continue comprando para se manter no topo e garantir seus bônus de líder! 🏆`;
            } else {
                // Cliente não está em 1º lugar
                const liderMegas = lider.megasHoje >= 1024 ? `${(lider.megasHoje/1024).toFixed(1)} GB` : `${lider.megasHoje} MB`;
                
                mensagem = `🎉 Obrigado, @${numero}, Você está fazendo a sua ${cliente.comprasHoje}ª compra do dia! Foram adicionados ${megasFormatados}, totalizando ${totalFormatado} comprados.\n`;
                mensagem += `Você está em ${posicao.posicao}º lugar no ranking. `;
                
                if (cliente.comprasHoje === 1) {
                    mensagem += `Está quase lá! Continue comprando para alcançar o topo. O líder já acumulou ${liderMegas}! 🏆`;
                } else {
                    mensagem += `Continue comprando para subir e desbloquear bônus especiais. O líder já acumulou ${liderMegas}! 🏆`;
                }
            }
            
            return mensagem;
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao gerar mensagem:', error);
            return `🎉 Obrigado, @${numero}! Compra registrada com sucesso!`;
        }
    }

    // === ATUALIZAR RANKING DIÁRIO ===
    async atualizarRanking() {
        try {
            const hoje = new Date().toDateString();
            
            // Criar array de ranking ordenado por megas do dia
            this.rankingDiario = Object.entries(this.historicoCompradores)
                .filter(([numero, dados]) => dados.ultimaCompra === hoje && dados.megasHoje > 0)
                .map(([numero, dados]) => ({
                    numero: numero,
                    megasHoje: dados.megasHoje,
                    comprasHoje: dados.comprasHoje,
                    megasTotal: dados.megasTotal
                }))
                .sort((a, b) => b.megasHoje - a.megasHoje)
                .map((item, index) => ({
                    ...item,
                    posicao: index + 1
                }));
            
            await this.salvarDados();
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao atualizar ranking:', error);
        }
    }

    // === OBTER POSIÇÃO DO CLIENTE ===
    async obterPosicaoCliente(numero) {
        await this.atualizarRanking();
        const posicao = this.rankingDiario.find(item => item.numero === numero);
        return posicao || { posicao: this.rankingDiario.length + 1, megasHoje: 0 };
    }

    // === OBTER LÍDER DO RANKING ===
    async obterLider() {
        await this.atualizarRanking();
        return this.rankingDiario[0] || { numero: '000000000', megasHoje: 0, comprasHoje: 0 };
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

    // === VERIFICAR RESET DIÁRIO ===
    async verificarResetDiario() {
        try {
            const hoje = new Date().toDateString();
            
            // Resetar contadores diários se necessário
            Object.values(this.historicoCompradores).forEach(cliente => {
                if (cliente.ultimaCompra !== hoje && cliente.comprasHoje > 0) {
                    console.log(`🛒 Resetando contador diário para cliente ${cliente.numero}`);
                    cliente.comprasHoje = 0;
                    cliente.megasHoje = 0;
                }
            });
            
            await this.salvarDados();
            
        } catch (error) {
            console.error('❌ COMPRAS: Erro ao verificar reset diário:', error);
        }
    }

    // === ESTATÍSTICAS ===
    async obterEstatisticas() {
        await this.atualizarRanking();
        
        return {
            totalCompradores: Object.keys(this.historicoCompradores).length,
            compradoresHoje: this.rankingDiario.length,
            comprasPendentes: Object.keys(this.comprasPendentes).length,
            ranking: this.rankingDiario.slice(0, 10), // Top 10
            totalMegasHoje: this.rankingDiario.reduce((sum, item) => sum + item.megasHoje, 0)
        };
    }
}

module.exports = SistemaCompras;