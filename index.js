require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs').promises;
const axios = require('axios'); // npm install axios

// === IMPORTAR A IA ===
const WhatsAppAI = require('./whatsapp_ai');

// === IMPORTAR SISTEMA DE PACOTES ===
const SistemaPacotes = require('./sistema_pacotes');

// === IMPORTAR SISTEMA DE COMPRAS ===
const SistemaCompras = require('./sistema_compras');

// === CONFIGURAÇÃO GOOGLE SHEETS - BOT RETALHO (SCRIPT PRÓPRIO) ===
const GOOGLE_SHEETS_CONFIG = {
    scriptUrl: process.env.GOOGLE_SHEETS_SCRIPT_URL_RETALHO || 'https://script.google.com/macros/s/AKfycbyMilUC5bYKGXV95LR4MmyaRHzMf6WCmXeuztpN0tDpQ9_2qkgCxMipSVqYK_Q6twZG/exec',
    planilhaUrl: 'https://docs.google.com/spreadsheets/d/1vIv1Y0Hiu6NHEG37ubbFoa_vfbEe6sAb9I4JH-P38BQ/edit',
    planilhaId: '1vIv1Y0Hiu6NHEG37ubbFoa_vfbEe6sAb9I4JH-P38BQ',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 2000
};

// === CONFIGURAÇÃO DE PAGAMENTOS (MESMA PLANILHA DO BOT ATACADO) ===
const PAGAMENTOS_CONFIG = {
    scriptUrl: 'https://script.google.com/macros/s/AKfycbzzifHGu1JXc2etzG3vqK5Jd3ihtULKezUTQQIDJNsr6tXx3CmVmKkOlsld0x1Feo0H/exec',
    timeout: 30000
};

console.log(`📊 Google Sheets configurado`);

// Função helper para reply com fallback
async function safeReply(message, client, texto) {
    try {
        await message.reply(texto);
    } catch (error) {
        console.log('⚠️ Erro no reply, usando sendMessage como fallback:', error.message);
        try {
            await client.sendMessage(message.from, texto);
        } catch (fallbackError) {
            console.error('❌ Erro também no sendMessage fallback:', fallbackError.message);
            throw fallbackError;
        }
    }
}

// Criar instância do cliente
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot_retalho_modificado" // Diferente do bot atacado
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--disable-extensions',
            '--no-default-browser-check',
            '--disable-default-apps',
            '--disable-translate',
            '--disable-sync'
        ],
        executablePath: undefined, // Use default Chrome
        timeout: 0, // Remove timeout
        ignoreDefaultArgs: ['--disable-extensions']
    }
});

// === INICIALIZAR A IA ===
require('dotenv').config();
const ia = new WhatsAppAI(process.env.OPENAI_API_KEY);

// === SISTEMA DE PACOTES (será inicializado após WhatsApp conectar) ===
let sistemaPacotes = null;
let sistemaCompras = null;

// Configuração para encaminhamento
const ENCAMINHAMENTO_CONFIG = {
    grupoOrigem: '120363152151047451@g.us', // Phull Megas
    numeroDestino: '258861645968@c.us',
    intervaloSegundos: 2
};

// Fila de mensagens para encaminhar
let filaMensagens = [];
let processandoFila = false;

// === VARIÁVEIS PARA DADOS ===
let dadosParaTasker = [];

// === SISTEMA DE REFERÊNCIAS E BÔNUS ===
let codigosReferencia = {}; // codigo -> dados do dono
let referenciasClientes = {}; // cliente -> dados da referencia
let bonusSaldos = {}; // cliente -> saldo e historico
let pedidosSaque = {}; // referencia -> dados do pedido
let membrosEntrada = {}; // {grupoId: {memberId: dataEntrada}}

// Arquivos de persistência
const ARQUIVO_REFERENCIAS = './dados_referencias.json';
const ARQUIVO_BONUS = './dados_bonus.json';
const ARQUIVO_CODIGOS = './dados_codigos.json';
const ARQUIVO_SAQUES = './dados_saques.json';
const ARQUIVO_MEMBROS = './dados_membros_entrada.json';

// === FUNÇÕES DO SISTEMA DE REFERÊNCIA ===

// Cache para controlar boas-vindas (evitar spam)
let cacheBoasVindas = {}; // {grupoId_participantId: timestamp}
let ultimosParticipantes = {}; // {grupoId: [participantIds]} - cache dos participantes

// Sistema automático de detecção de novos membros
async function iniciarMonitoramentoMembros() {
    console.log('🕵️ Iniciando monitoramento automático de novos membros...');
    
    // Executar a cada 30 segundos
    setInterval(async () => {
        try {
            await verificarNovosMembros();
        } catch (error) {
            console.error('❌ Erro no monitoramento de membros:', error);
        }
    }, 30000); // 30 segundos
    
    // Primeira execução após 10 segundos (para dar tempo do bot conectar)
    setTimeout(async () => {
        await verificarNovosMembros();
    }, 10000);
}

// Verificar novos membros em todos os grupos monitorados
async function verificarNovosMembros() {
    for (const grupoId of Object.keys(CONFIGURACAO_GRUPOS)) {
        try {
            await detectarNovosMembrosGrupo(grupoId);
        } catch (error) {
            // Silencioso para não poluir logs
        }
    }
}

// Detectar novos membros em um grupo específico
async function detectarNovosMembrosGrupo(grupoId) {
    try {
        const chat = await client.getChatById(grupoId);
        const participants = await chat.participants;
        const participantIds = participants.map(p => p.id._serialized);
        
        // Se é a primeira vez que verificamos este grupo
        if (!ultimosParticipantes[grupoId]) {
            ultimosParticipantes[grupoId] = participantIds;
            return;
        }
        
        // Encontrar novos participantes
        const novosParticipantes = participantIds.filter(id => 
            !ultimosParticipantes[grupoId].includes(id)
        );
        
        // Processar novos membros
        for (const participantId of novosParticipantes) {
            await processarNovoMembro(grupoId, participantId);
        }
        
        // Atualizar cache
        ultimosParticipantes[grupoId] = participantIds;
        
    } catch (error) {
        // Silencioso - grupo pode não existir ou bot não ter acesso
    }
}

// Processar novo membro detectado
async function processarNovoMembro(grupoId, participantId) {
    try {
        const configGrupo = getConfiguracaoGrupo(grupoId);
        if (!configGrupo) return;
        
        const cacheKey = `${grupoId}_${participantId}`;
        const agora = Date.now();
        
        // Verificar se já enviamos boas-vindas recentemente (últimas 24h)
        if (cacheBoasVindas[cacheKey] && (agora - cacheBoasVindas[cacheKey]) < (24 * 60 * 60 * 1000)) {
            return;
        }
        
        console.log(`👋 Novo membro detectado`);
        
        // Registrar entrada do membro
        await registrarEntradaMembro(grupoId, participantId);
        
        // Marcar como processado
        cacheBoasVindas[cacheKey] = agora;
        
        // Enviar boas-vindas com delay aleatório
        setTimeout(async () => {
            try {
                await enviarBoasVindas(grupoId, participantId);
                console.log(`✅ Boas-vindas enviadas`);
            } catch (error) {
                console.error(`❌ Erro ao enviar boas-vindas para ${participantId}:`, error.message);
            }
        }, 3000 + (Math.random() * 5000)); // 3-8 segundos
        
    } catch (error) {
        console.error('❌ Erro ao processar novo membro:', error);
    }
}

// Detectar novo membro pela primeira mensagem (backup)
async function detectarNovoMembro(grupoId, participantId, configGrupo) {
    // Esta função agora é só um backup caso o monitoramento automático falhe
    return;
}

// Registrar entrada de novo membro
async function registrarEntradaMembro(grupoId, participantId) {
    try {
        if (!membrosEntrada[grupoId]) {
            membrosEntrada[grupoId] = {};
        }
        
        membrosEntrada[grupoId][participantId] = new Date().toISOString();
        await salvarDadosMembros();
        
        console.log(`📝 Entrada registrada`);
    } catch (error) {
        console.error('❌ Erro ao registrar entrada de membro:', error);
    }
}

// Salvar dados de membros
async function salvarDadosMembros() {
    try {
        await fs.writeFile(ARQUIVO_MEMBROS, JSON.stringify(membrosEntrada));
    } catch (error) {
        console.error('❌ Erro ao salvar dados de membros:', error);
    }
}

// Enviar mensagem de boas-vindas para novos membros
async function enviarBoasVindas(grupoId, participantId) {
    try {
        console.log(`👋 Enviando boas-vindas`);
        
        // Registrar entrada do membro
        await registrarEntradaMembro(grupoId, participantId);
        
        // Obter informações do participante
        const contact = await client.getContactById(participantId);
        const nomeUsuario = contact.name || contact.pushname || participantId.replace('@c.us', '');
        
        // Obter configuração do grupo
        const configGrupo = getConfiguracaoGrupo(grupoId);
        if (!configGrupo) {
            console.log(`⚠️ Grupo não configurado`);
            return false;
        }
        
        // Usar mensagem personalizada do grupo ou padrão
        let mensagemBoasVindas = configGrupo.boasVindas || `🎉 *BOAS-VINDAS AO GRUPO!*

👋 Olá @NOME, seja bem-vindo!

🤖 *SISTEMA DE VENDAS 100% AUTOMÁTICO!*
📱 1. Envie comprovante de pagamento aqui
⚡ 2. Nosso sistema processa automaticamente
📊 3. Participe do ranking diário de compradores

💰 *COMANDOS ÚTEIS:*
• *tabela* - Ver preços de pacotes
• *pagamento* - Ver formas de pagamento
• *.ranking* - Ver ranking do grupo
• *.meucodigo* - Gerar código de referência

🎁 *SISTEMA DE REFERÊNCIAS:*
Você tem código de referência de alguém?
Use: *.convite CÓDIGO* para ativar!

✨ *IMPORTANTE:* Códigos de referência só funcionam para membros que entraram nos últimos 5 dias!

🚀 Vamos começar? Qualquer dúvida, pergunte no grupo!`;
        
        // Substituir placeholder @NOME pelo nome real
        mensagemBoasVindas = mensagemBoasVindas.replace('@NOME', `@${participantId.replace('@c.us', '')}`);
        
        // Enviar mensagem com menção
        await client.sendMessage(grupoId, mensagemBoasVindas, {
            mentions: [participantId]
        });
        
        console.log(`✅ Boas-vindas enviadas`);
        return true;
        
    } catch (error) {
        console.error(`❌ Erro ao enviar boas-vindas para ${participantId}:`, error);
        return false;
    }
}

// Verificar se usuário é elegível para usar código (últimos 5 dias)
function isElegivelParaCodigo(participantId, grupoId) {
    try {
        if (!membrosEntrada[grupoId] || !membrosEntrada[grupoId][participantId]) {
            console.log(`⚠️ Membro sem registro de entrada`);
            return false; // Se não tem registro, não é elegível
        }
        
        const dataEntrada = new Date(membrosEntrada[grupoId][participantId]);
        const agora = new Date();
        const limite5Dias = 5 * 24 * 60 * 60 * 1000; // 5 dias em ms
        
        const tempoNoGrupo = agora - dataEntrada;
        const elegivelTempo = tempoNoGrupo <= limite5Dias;
        
        console.log(`🔍 Verificando elegibilidade - ${Math.floor(tempoNoGrupo / (24 * 60 * 60 * 1000))} dias no grupo`);
        
        return elegivelTempo;
    } catch (error) {
        console.error('❌ Erro ao verificar elegibilidade:', error);
        return false;
    }
}

// Carregar dados persistentes
async function carregarDadosReferencia() {
    try {
        // Carregar códigos
        try {
            const dados = await fs.readFile(ARQUIVO_CODIGOS, 'utf8');
            codigosReferencia = JSON.parse(dados);
            console.log(`📋 ${Object.keys(codigosReferencia).length} códigos de referência carregados`);
        } catch (e) {
            codigosReferencia = {};
        }

        // Carregar referências  
        try {
            const dados = await fs.readFile(ARQUIVO_REFERENCIAS, 'utf8');
            referenciasClientes = JSON.parse(dados);
            console.log(`👥 ${Object.keys(referenciasClientes).length} referências de clientes carregadas`);
        } catch (e) {
            referenciasClientes = {};
        }

        // Carregar bônus
        try {
            const dados = await fs.readFile(ARQUIVO_BONUS, 'utf8');
            bonusSaldos = JSON.parse(dados);
            console.log(`💰 ${Object.keys(bonusSaldos).length} saldos de bônus carregados`);
        } catch (e) {
            bonusSaldos = {};
        }

        // Carregar saques
        try {
            const dados = await fs.readFile(ARQUIVO_SAQUES, 'utf8');
            pedidosSaque = JSON.parse(dados);
            console.log(`🏦 ${Object.keys(pedidosSaque).length} pedidos de saque carregados`);
        } catch (e) {
            pedidosSaque = {};
        }

        // Carregar dados de entrada de membros
        try {
            const dados = await fs.readFile(ARQUIVO_MEMBROS, 'utf8');
            membrosEntrada = JSON.parse(dados);
            console.log(`👥 ${Object.keys(membrosEntrada).length} grupos com dados de entrada carregados`);
        } catch (e) {
            membrosEntrada = {};
        }

    } catch (error) {
        console.error('❌ Erro ao carregar dados de referência:', error);
    }
}

// Salvar dados persistentes
// === SISTEMA DE SALVAMENTO OTIMIZADO ===
let salvamentoPendente = false;

async function salvarDadosReferencia() {
    // Evitar salvamentos simultâneos
    if (salvamentoPendente) return;
    salvamentoPendente = true;

    try {
        // Usar Promise.allSettled para não falhar se um arquivo der erro
        const resultados = await Promise.allSettled([
            fs.writeFile(ARQUIVO_CODIGOS, JSON.stringify(codigosReferencia)),
            fs.writeFile(ARQUIVO_REFERENCIAS, JSON.stringify(referenciasClientes)),
            fs.writeFile(ARQUIVO_BONUS, JSON.stringify(bonusSaldos)),
            fs.writeFile(ARQUIVO_SAQUES, JSON.stringify(pedidosSaque))
        ]);

        // Log apenas se houve falhas
        const falhas = resultados.filter(r => r.status === 'rejected');
        if (falhas.length > 0) {
            console.error('❌ Algumas escritas falharam:', falhas.length);
        }
    } catch (error) {
        console.error('❌ Erro ao salvar dados de referência:', error);
    } finally {
        salvamentoPendente = false;
    }
}

// === SALVAMENTO COM DEBOUNCE (OTIMIZAÇÃO) ===
let timeoutSalvamento = null;

function agendarSalvamento() {
    // Cancelar salvamento anterior se houver
    if (timeoutSalvamento) {
        clearTimeout(timeoutSalvamento);
    }

    // Agendar novo salvamento em 2 segundos
    timeoutSalvamento = setTimeout(async () => {
        agendarSalvamento();
        timeoutSalvamento = null;
    }, 2000);
}

// Gerar código único
function gerarCodigoReferencia(remetente) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let codigo;
    do {
        codigo = '';
        for (let i = 0; i < 6; i++) {
            codigo += chars.charAt(Math.floor(Math.random() * chars.length));
        }
    } while (codigosReferencia[codigo]);
    
    return codigo;
}

// Processar bônus de compra
async function processarBonusCompra(remetenteCompra, valorCompra) {
    console.log(`🎁 Verificando bônus para compra`);
    
    // Verificar se cliente tem referência
    const referencia = referenciasClientes[remetenteCompra];
    if (!referencia) {
        console.log(`   ❌ Cliente não tem referência registrada`);
        return false;
    }

    // Verificar se ainda pode ganhar bônus (máximo 5 compras)
    if (referencia.comprasRealizadas >= 5) {
        console.log(`   ⚠️ Cliente já fez 5 compras, sem mais bônus`);
        return false;
    }

    // Atualizar contador de compras
    referencia.comprasRealizadas++;
    
    // Creditar bônus ao convidador
    const convidador = referencia.convidadoPor;
    if (!bonusSaldos[convidador]) {
        bonusSaldos[convidador] = {
            saldo: 0,
            detalhesReferencias: {},
            historicoSaques: [],
            totalReferencias: 0
        };
    }

    // Adicionar 200MB ao saldo
    const bonusAtual = 200;
    bonusSaldos[convidador].saldo += bonusAtual;
    
    // Atualizar detalhes da referência
    if (!bonusSaldos[convidador].detalhesReferencias[remetenteCompra]) {
        bonusSaldos[convidador].detalhesReferencias[remetenteCompra] = {
            compras: 0,
            bonusGanho: 0,
            codigo: referencia.codigo,
            ativo: true
        };
    }
    
    bonusSaldos[convidador].detalhesReferencias[remetenteCompra].compras = referencia.comprasRealizadas;
    bonusSaldos[convidador].detalhesReferencias[remetenteCompra].bonusGanho += bonusAtual;
    
    // Enviar notificação de bônus por referência
    try {
        const nomeComprador = message.from.includes('@g.us') ? await obterNomeContato(remetenteCompra) : 'Cliente';
        const novoSaldo = bonusSaldos[convidador].saldo;
        const novoSaldoFormatado = novoSaldo >= 1024 ? `${(novoSaldo/1024).toFixed(2)}GB` : `${novoSaldo}MB`;
        
        await client.sendMessage(message.from, 
            `🎉 *BÔNUS CREDITADO!*\n\n` +
            `💎 @${convidador.replace('@c.us', '')}, recebeste *${bonusAtual}MB* de bônus!\n\n` +
            `👤 *Comprador:* @${remetenteCompra.replace('@c.us', '')}\n` +
            `🛒 *Compra:* ${referencia.comprasRealizadas}ª de 5\n` +
            `💰 *Novo saldo:* ${novoSaldoFormatado}\n\n` +
            `${novoSaldo >= 1024 ? '🚀 *Já podes sacar!* Use: *.sacar*' : '⏳ *Continua a convidar amigos!*'}`, {
            mentions: [convidador, remetenteCompra]
        });
    } catch (error) {
        console.error('❌ Erro ao enviar notificação de bônus:', error);
    }

    // Salvar dados
    agendarSalvamento();
    
    console.log(`   ✅ Bônus creditado: ${bonusAtual}MB (${referencia.comprasRealizadas}/5)`);
    
    return {
        convidador: convidador,
        bonusGanho: bonusAtual,
        compraAtual: referencia.comprasRealizadas,
        totalCompras: 5,
        novoSaldo: bonusSaldos[convidador].saldo
    };
}

// === FUNÇÃO PARA NORMALIZAR VALORES ===
function normalizarValor(valor) {
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'string') {
        const valorLimpo = valor.replace(/[^\d]/g, '');
        return parseInt(valorLimpo) || 0;
    }
    return 0;
}

// === FUNÇÃO PARA CALCULAR VALOR DO PEDIDO ===
function calcularValorPedido(megas, precosGrupo) {
    const megasNum = parseInt(megas) || 0;
    if (precosGrupo && precosGrupo[megasNum]) {
        return precosGrupo[megasNum];
    }
    // Fallback: calcular valor baseado em preço por MB (assumindo ~12.5MT/GB)
    const valorPorMB = 12.5 / 1024; // ~0.012MT por MB
    return Math.round(megasNum * valorPorMB);
}

// === FUNÇÃO PARA VERIFICAR PAGAMENTO ===
async function verificarPagamentoIndividual(referencia, valorEsperado) {
    try {
        const valorNormalizado = normalizarValor(valorEsperado);

        console.log(`🔍 REVENDEDORES: Verificando pagamento ${referencia} - ${valorNormalizado}MT (original: ${valorEsperado})`);

        const response = await axios.post(PAGAMENTOS_CONFIG.scriptUrl, {
            action: "buscar_por_referencia",
            referencia: referencia,
            valor: valorNormalizado
        }, {
            timeout: PAGAMENTOS_CONFIG.timeout,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.data && response.data.encontrado) {
            console.log(`✅ REVENDEDORES: Pagamento encontrado!`);
            return true;
        }

        console.log(`❌ REVENDEDORES: Pagamento não encontrado`);
        return false;

    } catch (error) {
        console.error(`❌ REVENDEDORES: Erro ao verificar pagamento:`, error.message);
        return false;
    }
}

// Base de dados de compradores
let historicoCompradores = {};
const ARQUIVO_HISTORICO = 'historico_compradores.json';

// Cache de administradores dos grupos
let adminCache = {};

// Cache para evitar logs repetidos de grupos
let gruposLogados = new Set();

// === COMANDOS CUSTOMIZADOS ===
let comandosCustomizados = {};
const ARQUIVO_COMANDOS = 'comandos_customizados.json';

// Configuração de administradores GLOBAIS
const ADMINISTRADORES_GLOBAIS = [
    '258874100607@c.us',
    '258871112049@c.us',
    '258845356399@c.us', 
    '258840326152@c.us', 
    '258852118624@c.us',
    '23450974470333@lid'   // ID interno do WhatsApp para 852118624
    // Removido temporariamente para testar verificação de grupo: '245075749638206@lid'
];

// Mapeamento de IDs internos (@lid) para números reais (@c.us)
const MAPEAMENTO_IDS = {
    '23450974470333@lid': '258852118624@c.us',  // Seu ID
    '245075749638206@lid': null  // Será identificado automaticamente
};

// === CONFIGURAÇÃO DE MODERAÇÃO ===
const MODERACAO_CONFIG = {
    ativado: {
        '258820749141-1441573529@g.us': true,
        '120363152151047451@g.us': true,
        '258840161370-1471468657@g.us': true
    },
    detectarLinks: true,
    apagarMensagem: true,
    removerUsuario: true,
    excecoes: [
        '258861645968@c.us',
        '258871112049@c.us', 
        '258852118624@c.us'
    ]
};

// Configuração para cada grupo
const CONFIGURACAO_GRUPOS = {
    '258820749141-1441573529@g.us': {
        nome: 'Data Store - Vodacom',
        boasVindas: `🎉 *BOAS-VINDAS AO GRUPO!*

👋 Olá @NOME, seja bem-vindo!

🤖 *SISTEMA DE VENDAS 100% AUTOMÁTICO!*
📱 1. Envie comprovante de pagamento aqui
⚡ 2. Nosso sistema processa automaticamente
📊 3. Participe do ranking diário de compradores

💰 *COMANDOS ÚTEIS:*
• *tabela* - Ver preços de pacotes
• *pagamento* - Ver formas de pagamento
• *.ranking* - Ver ranking do grupo
• *.meucodigo* - Gerar código de referência

🎁 *SISTEMA DE REFERÊNCIAS:*
Você tem código de referência de alguém?
Use: *.convite CÓDIGO* para ativar!

✨ *IMPORTANTE:* Códigos de referência só funcionam para membros que entraram nos últimos 5 dias!

🚀 Vamos começar? Qualquer dúvida, pergunte no grupo!`,
        tabela: `SUPER PROMOÇÃO  DE 🛜ⓂEGAS✅ VODACOM A MELHOR PREÇO DO MERCADO - 04-05/09/2025

📆 PACOTES DIÁRIOS
900MB 💎 15MT 💵💽
1100MB 💎 17MT 💵💽
1200MB 💎 20MT 💵💽
2200MB 💎 34MT 💵💽
3300MB 💎 51MT 💵💽
4400MB 💎 68MT 💵💽
5500MB 💎 85MT 💵💽
10240MB 💎 170MT 💵💽 ➕ Bónus 1GB na próxima compra 🎁
20480MB 💎 340MT 💵💽 ➕ Bónus 2GB na próxima compra 🎁

📅 PACOTES SEMANAIS

3072 + 700MB 💎 105MT 💵💽
5120 + 700MB 💎 155MT 💵💽
10240 + 700MB 💎 210MT 💵💽
15360 + 700MB 💎 290MT 💵💽
20480 + 700MB 💎 360MT 💵💽

📅 PACOTES MENSAIS

12.8GB 💎 270MT 💵💽
22.8GB 💎 435MT 💵💽
32.8GB 💎 605MT 💵💽
52.8GB 💎 945MT 💵💽
102.8GB 💎 1605MT 💵💽


PACOTES DIAMANTE MENSAIS
Chamadas + SMS ilimitadas + 12GB 💎 460MT 💵
Chamadas + SMS ilimitadas + 24GB 💎 820MT 💵
Chamadas + SMS ilimitadas + 50GB 💎 1550MT 💵
Chamadas + SMS ilimitadas + 100GB 💎 2250MT 💵

⚠ NB: Válido apenas para Vodacom
`,

        pagamento: `FORMAS DE PAGAMENTO ATUALIZADAS
 
1- M-PESA 
NÚMERO: 848715208
NOME:  NATACHA ALICE

NÚMERO: 871112049
NOME: NATACHA ALICE`
    },

    '120363402160265624@g.us': {
        nome: 'Treinamento IA',
        tabela: `PROMOÇÃO DE 🛜ⓂEGAS✅ VODACOM A MELHOR PREÇO DO MERCADO 
📆 PACOTES DIÁRIOS 


512MB 💎 10MT 💵💽
850MB 💎 15MT 💵💽
1024MB 💎 17MT 💵💽
1200MB 💎 20MT 💵💽
2048MB 💎 34MT 💵💽
3072MB 💎 51MT 💵💽
4096MB 💎 68MT 💵💽
5120MB 💎 85MT 💵💽
10240MB 💎 170MT 💵💽
20480MB 💎 340MT 💵💽 

📅 PACOTES SEMANAIS
3072 + 700MB 💎 105MT 💵💽
5120 + 700MB 💎 155MT 💵💽
10240 + 700MB 💎 300MT 💵💽
15360 + 700MB 💎 455MT 💵💽
20480 + 700MB 💎 600MT 💵💽

📅 PACOTES MENSAIS
⚠ Para ativar estes pacotes, o Txuna Crédito não pode estar ativo
12.8GB 💎 255MT 💵💽
22.8GB 💎 435MT 💵💽
32.8GB 💎 605MT 💵💽
52.8GB 💎 945MT 💵💽
102.8GB 💎 1605MT 💵💽

PACOTES DIAMANTE MENSAIS
Chamadas + SMS ilimitadas + 12GB 💎 460MT 💵
Chamadas + SMS ilimitadas + 24GB 💎 820MT 💵
Chamadas + SMS ilimitadas + 50GB 💎 1550MT 💵
Chamadas + SMS ilimitadas + 100GB 💎 2250MT 💵
⚠ NB: Válido apenas para Vodacom


🚀 Oferecemos sempre o melhor!*

`,

        pagamento: `🅼🅴🅶🅰🆂 🅿🆁🅾🅼🅾    💳 🛒⛔ FORMAS DE PAGAMENTO:⛔🛒💳


      ● E-MOLA: 868019487🛒
      ● M-PESA: 851841990🛒

NOME:   Alice Armando Nhaquila📝

!¡ 📂⛔🛒 ENVIE O SEU COMPROVATIVO NO GRUPO,  JUNTAMENTE COM O NÚMERO QUE VAI RECEBER OS MB✅⛔🛒
`
    },

    '258840161370-1471468657@g.us': {
        nome: 'Venda Automática 24/7',
        tabela: `TABELA ATUALIZADA
10/10/2026 - 07:30:48 

___________________________

 PACOTE DIÁRIO BÁSICO( 24H⏱) 
1024MB    - 17,00 MT
1200MB    - 20,00 MT
2048MB   - 34,00 MT
2200MB    - 40,00 MT
3096MB    - 51,00 MT
4096MB    - 68,00 MT
5120MB     - 85,00 MT
6144MB    - 102,00 MT
7168MB    - 119,00 MT
8192MB    - 136,00 MT
9144MB    - 153,00 MT
10240MB  - 170,00 MT

 PACOTE DIÁRIO PREMIUM ( 3 DIAS 🗓) 
Megabyte Renováveis!
2000MB  - 44,00 MT
3000MB  - 66,00 MT
4000MB  - 88,00 MT
5000MB - 109,00 MT
6000MB  - 133,00 MT

PACOTE SEMANAL BÁSICO (5 Dias🗓)
Megabyte Renováveis!
1700MB - 45,00MT
2900MB - 80,00MT
3400MB - 110,00MT
5500MB - 150,00MT
7800MB - 200,00MT
11400MB - 300,00MT 

 PACOTE SEMANAL PREMIUM ( 15 DIAS 🗓 ) 
Megabyte Renováveis!
5000MB - 149,00 MT
8000MB - 201,00 MT
10000MB - 231,00 MT
20000MB - 352,00 MT

PACOTE MENSAL PREMIUM (30 dias🗓)
Megabyte Renováveis!
3198MB   - 104,00MT
5298MB   - 184,00MT
8398MB   - 229,00MT
10498MB   - 254,00MT
12598MB   - 294,00MT
15698MB   - 349,00MT
18798MB   - 414,00MT
20898MB   - 468,00MT
25998MB   - 529,00MT

PACOTE MENSAL EXCLUSIVO (30 dias🗓)
Não pode ter xtuna crédito
32.8GB   - 649,00MT
51.2GB   - 1049,00MT
60.2GB   - 124900MT
80.2GB   - 1449,00MT
100.2GB   - 1700,00MT

🔴🔴 VODACOM
➖Chamadas +SMS ILIMITADAS ➖p/todas as redes +GB➖

➖ SEMANAL (7dias)➖
280mt = Ilimitado+ 7.5GB

Mensal(30dias):
450MT - Ilimitado + 11.5GB.
500MT - Ilimitado + 14.5GB.
700MT - Ilimitado + 26.5GB.
1000MT - Ilimitado + 37.5GB.
1500MT - Ilimitado + 53.5GB
2150MT - Ilimitado + 102.5GB

PARA OS PACOTES MENSAIS, NÃO PODE TER TXUNA CRÉDITO.

🟠🟠 MOVITEL
➖Chamadas +SMS ILIMITADAS ➖p/todas as redes +GB➖

➖ SEMANAL (7dias)➖
280mt = Ilimitado+ 7.1GB

🟠➖ MENSAL (30dias)➖ p./tds redes
450mt = Ilimitado+ 9GB
950mt = Ilimitado+ 23GB
1450mt = Ilimitado+ 38GB
1700mt = Ilimitado+ 46GB
1900mt = Ilimitado+ 53GB
2400mt = ilimitado+ 68GB

Importante 🚨: Envie o valor que consta na tabela!
`,

        pagamento: `╭━━━┛ 💸  ＦＯＲＭＡＳ ＤＥ ＰＡＧＡＭＥＮＴＯ: 
┃
┃ 🪙 E-Mola: (Glória) 👩‍💻
┃     860186270  
┃
┃ 🪙 M-Pesa:  (Leonor)👨‍💻
┃     857451196  
┃
┃
┃ ⚠ IMPORTANTE:  
┃     ▪ Envie o comprovativo em forma de mensagem e o número para receber rápido!
┃
┃┃
╰⚠ NB: Válido apenas para Vodacom━━━━━━  
       🚀 O futuro é agora. Vamos?`
    },
    '120363228868368923@g.us': {
    nome: 'VENDA DE MEGAS',
    tabela: `𝗧𝗮𝗯𝗲𝗹𝗮 𝗮𝗰𝘁𝘂𝗮𝗹𝗶𝘇𝗮do 𝗱𝗲 𝘃𝗼𝗱𝗮𝗰𝗼𝗺


𝗗𝗶𝗮𝗿𝗶𝗼
✅PODE TER TXUNA CRÉDITO


𝟭024M𝗕__𝟭𝟴 𝗠𝗧
𝟮048M𝗕__𝟯6𝗠𝗧
𝟯072MB ___ 𝟱4𝗠𝗧
𝟰096MB__𝟳0𝗠𝗧
𝟱120M𝗕 ___ 𝟵𝟬𝗠𝗧
𝟭0240MB___𝟭8𝟬𝗠𝗧

𝗦𝗲𝗺𝗮𝗻𝗮𝗹
❎ NÃO PODE TER TXUNA CRÉDITO

𝟰5𝗠𝗧__𝟭𝟳41M𝗕
80𝗠𝗧__𝟮𝟵70M𝗕
90𝗠𝗧__𝟯𝟰82M𝗕
𝟭40𝗠𝗧___𝟱325M𝗕
𝟭80𝗠𝗧___𝟳270M𝗕

𝐌𝐞𝐧𝐬𝐚𝐥
❎ NÃO PODE TER TXUNA CRÉDITO

𝟲057M𝗕__𝟮𝟬𝟬𝗠𝗧
𝟴057MB__𝟮𝟯𝟬𝗠𝗧
𝟭𝟬057MB___𝟮6𝟬𝗠𝗧
𝟮𝟬057M𝗕___𝟰𝟱𝟬𝗠𝗧

𝗗𝗶𝗮𝗺𝗮𝗻𝘁𝗲 𝗱𝗲 𝗩𝗼𝗱𝗮𝗰𝗼𝗺
❎ NÃO PODE TER TXUNA CRÉDITO

𝗠𝗲𝗻𝘀𝗮𝗹 (𝟯𝟬𝗗𝗶𝗮𝘀)
⿡𝟰50𝗠𝘁 =𝗖𝗵𝗮𝗺𝗮𝗱𝗮𝘀 𝗶𝗹𝗶𝗺𝗶𝘁𝗮𝗱𝗮𝘀 +𝟭𝟭𝗚𝗕+𝗦𝗠𝗦
⿢𝟱50 =𝗖𝗵𝗮𝗺𝗮𝗱𝗮𝘀 𝗶𝗹𝗶𝗺𝗶𝘁𝗮𝗱𝗮𝘀 +𝟭𝟱𝗚𝗕+𝗦𝗠𝗦
⿣𝟳50=𝗖𝗵𝗮𝗺𝗮𝗱𝗮𝘀 𝗶𝗹𝗶𝗺𝗶𝘁𝗮𝗱𝗮𝘀 +𝟮𝟱𝗚𝗕+𝗦𝗠𝗦
⿤𝟭050=𝗖𝗵𝗮𝗺𝗮𝗱𝗮𝘀 𝗶𝗹𝗶𝗺𝗶𝘁𝗮𝗱𝗮𝘀 +𝟰𝟮𝗚𝗕+𝗦𝗠𝗦

`,
    pagamento: `💳 FORMAS/ PAGAMENTOS :⤵
- 📲 𝗘-𝗠𝗢𝗟𝗔: 868440408:
- *JOSE TOMAS*
- 📲 𝗠-𝗣𝗘𝗦𝗔 850189315:
- *JOSE TOMÁS*

📩 Envie o seu comprovantivo no grupo, juntamente com o número que vai receber os dados.`
},'120363022366545020@g.us': {
        nome: 'Megas VIP',
        boasVindas: `🎉 *BOAS-VINDAS AO MEGAS VIP!*

👋 Olá @NOME, seja bem-vindo ao melhor grupo de internet!

🤖 *SISTEMA 100% AUTOMÁTICO - SEM DEMORAS!*
⚡ Envie seu comprovante e receba instantaneamente
🏆 Sistema mais rápido de Moçambique
📊 Ranking diário com prêmios especiais

💰 *COMANDOS:*
• *tabela* - Ver preços VIP
• *pagamento* - Formas de pagamento
• *.ranking* - Ver seu ranking

🎁 *BÔNUS DE REFERÊNCIA:*
Indique amigos e ganhe MB extras!
Use: *.meucodigo* para seu código

🚀 *VANTAGENS EXCLUSIVAS:*
✅ Processamento em tempo real
✅ Suporte 24/7
✅ Preços especiais
✅ Sem taxas escondidas

Bem-vindo à família VIP! 🔥`,
        tabela: `🚨📢MEGABYTES DA VODACOM📢🚨

📦PACOTE DIÁRIO📦

🛜512MB = 10MT
🛜1024MB = 18MT
🛜2048MB = 36MT
🛜3072MB = 54MT
🛜4096MB = 72MT
🛜5120MB = 90MT
🛜6144MB = 108MB
🛜7168MB = 126MB
🛜8192MB = 144MB
🛜9216MB = 162MB
🛜10240MB = 180MT
🛜20480MB = 360MT

PACOTE SEMANAL🛒📦
⚠ Vai receber 100MB por dia durante 6 dias, totalizando +0.6GB. ⚠

🛜2.0GB = 65MT
🛜3.0GB = 85MT
🛜5.0GB = 130MT
🛜7.0GB = 175MT 
🛜10.0GB = 265MT
🛜14.0GB = 362MT

📦PACOTE MENSAL📦
⚠Não deve ter txuna crédito⚠

📊2.8GB = 95MT
📊3.8GB = 125MT
📊4.8GB = 145MT
📊5.8GB = 165MT
📊6.8GB = 195MT
📊7.8GB = 215MT
📊10.8GB = 285MT
📊12.8GB = 345MT
📊20.8GB = 565MT


FORMA DE PAGAMENTO:
💳💸
M-Pesa: 853529033 📱
- Ercílio Uanela 
e-Mola: 865627840 📱
- Alexandre Uanela 

Adquira já os teus megas com segurança, confiança e rapidez!🚨🔥
`,

        pagamento: `FORMAS DE PAGAMENTO💰💶

📌 M-PESA: 853529033 
   Nome: Ercílio Uanela 

📌 E-MOLA: 865627840 
    Nome: Alexandre Uanela  

📮 _Apos a transferência do valor envie o comprovativo da transação ou a chave da mensagem 📸📂

🚀 O futuro é agora! Vamos? 🔥🛒
`
    },
    '120363152151047451@g.us': {
        nome: 'MEGA PROMO VODACOM',
        tabela: `🔥 MEGA PROMO VODACOM
━━━━━━━━━━━━━━━

PACOTES DIÁRIOS 24h
1050MB = 18MT
1200MB = 20MT
2400MB = 40MT
3600MB = 60MT
10240MB = 180MT

━━━━━━━━━━━━━━

PLANO SEMANAL (7 DIAS)
3GB = 97MT
5GB = 147MT
7GB = 196MT
10GB = 296MT

━━━━━━━━━━━━━━

PACOTES MENSAIS
5GB = 150MT
10GB = 280MT
20GB = 480MT

━━━━━━━━━━━━━━

ILIMITADO 30 DIAS
✅ 11GB + Chamadas & SMS ilimitados – 450MT
✅ 15GB + Chamadas & SMS ilimitados – 550MT
✅ 20GB + Chamadas & SMS ilimitados – 650MT
✅ 25GB + Chamadas & SMS ilimitados – 750MT
✅ 50GB + Chamadas & SMS ilimitados – 1250MT

━━━━━━━━━━━━━━

⚠ NB: Para activar o pacote semanal e mensal não pode ter nenhum crédito
`,
        pagamento: `🅼🅴🅶🅰🆂 🅿🆁🅾🅼🅾    💳 🛒⛔ FORMAS DE PAGAMENTO:⛔🛒💳


      ● E-MOLA: 868019487🛒
      ● M-PESA: 851841990🛒

NOME:   Alice Armando Nhaquila📝

!¡ 📂⛔🛒 ENVIE O SEU COMPROVATIVO NO GRUPO,  JUNTAMENTE COM O NÚMERO QUE VAI RECEBER OS MB✅⛔🛒`
    }
};

// === FUNÇÃO GOOGLE SHEETS ===

// Função para retry automático
async function tentarComRetry(funcao, maxTentativas = 3, delay = 2000) {
    for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
        try {
            return await funcao();
        } catch (error) {
            console.log(`⚠️ Tentativa ${tentativa}/${maxTentativas} falhou: ${error.message}`);
            
            if (tentativa === maxTentativas) {
                throw error; // Última tentativa, propagar erro
            }
            
            // Aguardar antes da próxima tentativa
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
async function enviarParaGoogleSheets(referencia, valor, numero, grupoId, grupoNome, autorMensagem) {
    // Formato igual ao Bot Atacado: transacao já concatenada
    const transacaoFormatada = `${referencia}|${valor}|${numero}`;
    
    const dados = {
        transacao: transacaoFormatada,  // Formato concatenado igual ao Bot Atacado
        grupo_id: grupoId,
        sender: 'WhatsApp-Bot',  // Identificar origem
        message: `Dados enviados pelo Bot: ${transacaoFormatada}`,
        timestamp: new Date().toISOString()
    };
    
    try {
        console.log(`📊 Enviando para Google Sheets: ${referencia}`);
        console.log(`🔍 Dados enviados:`, JSON.stringify(dados, null, 2));
        console.log(`🔗 URL destino:`, GOOGLE_SHEETS_CONFIG.scriptUrl);
        
       const response = await axios.post(GOOGLE_SHEETS_CONFIG.scriptUrl, dados, {
    timeout: GOOGLE_SHEETS_CONFIG.timeout,
    headers: {
        'Content-Type': 'application/json',
        'X-Bot-Source': 'WhatsApp-Bot'
    },
    // Configuração de retry
    validateStatus: function (status) {
        return status < 500; // Resolve apenas se status < 500
    }
});
        
        // Google Apps Script agora retorna JSON
        const responseData = response.data;
        console.log(`📥 Resposta Google Sheets:`, JSON.stringify(responseData, null, 2));

        // Verificar se é uma resposta JSON válida
        if (typeof responseData === 'object') {
            if (responseData.success) {
                console.log(`✅ Google Sheets: Dados enviados!`);
                return { sucesso: true, referencia: responseData.referencia, duplicado: false };
            } else if (responseData.duplicado) {
                console.log(`⚠️ Google Sheets: Pedido duplicado detectado - ${responseData.referencia} (Status: ${responseData.status_existente})`);
                return {
                    sucesso: false,
                    duplicado: true,
                    referencia: responseData.referencia,
                    status_existente: responseData.status_existente,
                    message: responseData.message
                };
            } else {
                throw new Error(responseData.message || 'Erro desconhecido');
            }
        } else {
            // Fallback para compatibilidade com resposta em texto
            const responseText = String(responseData);
            if (responseText.includes('Sucesso!')) {
                console.log(`✅ Google Sheets: Dados enviados!`);
                return { sucesso: true, row: 'N/A', duplicado: false };
            } else if (responseText.includes('Erro:')) {
                throw new Error(responseText);
            } else {
                throw new Error(`Resposta inesperada: ${responseText}`);
            }
        }
        
    } catch (error) {
        console.error(`❌ Erro Google Sheets [${grupoNome}]: ${error.message}`);
        return { sucesso: false, erro: error.message };
    }
}

// === FUNÇÃO PRINCIPAL PARA TASKER ===
async function enviarParaTasker(referencia, valor, numero, grupoId, autorMensagem) {
    const grupoNome = getConfiguracaoGrupo(grupoId)?.nome || 'Desconhecido';
    const timestamp = new Date().toLocaleString('pt-BR');
    const linhaCompleta = `${referencia}|${valor}|${numero}`;
    
    console.log(`📊 ENVIANDO PARA GOOGLE SHEETS [${grupoNome}]: ${linhaCompleta}`);
    
    // Armazenar localmente (backup)
    dadosParaTasker.push({
        dados: linhaCompleta,
        grupo_id: grupoId,
        grupo: grupoNome,
        autor: autorMensagem,
        timestamp: timestamp,
        enviado: false,
        metodo: 'pendente'
    });
    
    // === TENTAR GOOGLE SHEETS PRIMEIRO ===
    const resultado = await enviarParaGoogleSheets(referencia, valor, numero, grupoId, grupoNome, autorMensagem);
    
    if (resultado.sucesso) {
        // Marcar como enviado
        dadosParaTasker[dadosParaTasker.length - 1].enviado = true;
        dadosParaTasker[dadosParaTasker.length - 1].metodo = 'google_sheets';
        dadosParaTasker[dadosParaTasker.length - 1].row = resultado.row;
        console.log(`✅ [${grupoNome}] Enviado para Google Sheets! Row: ${resultado.row}`);

        // === REGISTRAR COMPRA PENDENTE NO SISTEMA DE COMPRAS ===
        if (sistemaCompras) {
            // Extrair apenas o número do autorMensagem (remover @c.us se houver)
            const numeroRemetente = autorMensagem.replace('@c.us', '');
            console.log(`🔍 DEBUG COMPRA: autorMensagem="${autorMensagem}" | numeroRemetente="${numeroRemetente}" | numero="${numero}"`);
            await sistemaCompras.registrarCompraPendente(referencia, numero, valor, numeroRemetente, grupoId);
        }
    } else if (resultado.duplicado) {
        // Remover da lista local já que é duplicado
        dadosParaTasker.pop();
        console.log(`🛑 [${grupoNome}] Pedido duplicado detectado: ${referencia}`);

        // Retornar informações do duplicado para o bot processar
        return {
            duplicado: true,
            referencia: resultado.referencia,
            status_existente: resultado.status_existente,
            message: resultado.message
        };
    } else {
        // Fallback para WhatsApp se Google Sheets falhar
        console.log(`🔄 [${grupoNome}] Google Sheets falhou, usando WhatsApp backup...`);
        enviarViaWhatsAppTasker(linhaCompleta, grupoNome, autorMensagem);
        dadosParaTasker[dadosParaTasker.length - 1].metodo = 'whatsapp_backup';
    }
    
    // === BACKUP REMOVIDO - OTIMIZAÇÃO ===
    // Não salva mais arquivos .txt desnecessários
    
    // Manter apenas últimos 100 registros
    if (dadosParaTasker.length > 100) {
        dadosParaTasker = dadosParaTasker.slice(-100);
    }
    
    return linhaCompleta;
}

function enviarViaWhatsAppTasker(linhaCompleta, grupoNome, autorMensagem) {
    const item = {
        conteudo: linhaCompleta, // Apenas: referencia|valor|numero
        autor: autorMensagem,
        grupo: grupoNome,
        timestamp: Date.now(),
        id: Date.now() + Math.random(),
        tipo: 'tasker_data_backup'
    };

    filaMensagens.push(item);
    console.log(`📱 WhatsApp Backup → Tasker: ${linhaCompleta}`);

    if (!processandoFila) {
        processarFila();
    }
}

// === FUNÇÃO REMOVIDA PARA OTIMIZAÇÃO ===
// Não salva mais arquivos .txt desnecessários
// async function salvarArquivoTasker() - REMOVIDA

function obterDadosTasker() {
    return dadosParaTasker;
}

function obterDadosTaskerHoje() {
    const hoje = new Date().toDateString();
    return dadosParaTasker.filter(item => {
        const dataItem = new Date(item.timestamp).toDateString();
        return dataItem === hoje;
    });
}

// === FUNÇÕES PARA TASKER - SISTEMA DE PACOTES ===
function obterDadosPacotesTasker() {
    if (!sistemaPacotes) return [];
    
    const clientes = Object.values(sistemaPacotes.clientesAtivos);
    return clientes.map(cliente => ({
        numero: cliente.numero,
        referenciaOriginal: cliente.referenciaOriginal,
        tipoPacote: cliente.tipoPacote,
        diasRestantes: cliente.diasRestantes,
        proximaRenovacao: cliente.proximaRenovacao,
        status: cliente.status,
        grupoId: cliente.grupoId
    }));
}

function obterRenovacoesPendentesTasker() {
    if (!sistemaPacotes) return [];
    
    const agora = new Date();
    const proximas6h = new Date(agora.getTime() + (6 * 60 * 60 * 1000));
    
    const clientes = Object.values(sistemaPacotes.clientesAtivos);
    return clientes.filter(cliente => {
        const proximaRenovacao = new Date(cliente.proximaRenovacao);
        return proximaRenovacao <= proximas6h && cliente.diasRestantes > 0;
    }).map(cliente => ({
        numero: cliente.numero,
        referenciaOriginal: cliente.referenciaOriginal,
        tipoPacote: cliente.tipoPacote,
        proximaRenovacao: cliente.proximaRenovacao,
        diasRestantes: cliente.diasRestantes
    }));
}

// === COMANDOS CUSTOMIZADOS - FUNÇÕES ===

async function carregarComandosCustomizados() {
    try {
        const data = await fs.readFile(ARQUIVO_COMANDOS, 'utf8');
        comandosCustomizados = JSON.parse(data);
        console.log(`📝 Comandos customizados carregados: ${Object.keys(comandosCustomizados).length} grupos`);
    } catch (error) {
        comandosCustomizados = {};
        console.log('📝 Arquivo de comandos não existe, criando estrutura vazia');
    }
}

async function salvarComandosCustomizados() {
    try {
        await fs.writeFile(ARQUIVO_COMANDOS, JSON.stringify(comandosCustomizados));
        console.log('✅ Comandos customizados salvos');
    } catch (error) {
        console.error('❌ Erro ao salvar comandos:', error);
    }
}

function parsearComandoCustomizado(texto) {
    // Regex para capturar: .addcomando Nome_do_comando(resposta)
    const regex = /^\.addcomando\s+(\w+)\s*\((.+)\)$/s;
    const match = texto.match(regex);
    
    if (match) {
        return {
            nome: match[1].toLowerCase(),
            resposta: match[2].trim()
        };
    }
    return null;
}

async function adicionarComandoCustomizado(chatId, nomeComando, resposta, autorId) {
    if (!comandosCustomizados[chatId]) {
        comandosCustomizados[chatId] = {};
    }
    
    comandosCustomizados[chatId][nomeComando] = {
        resposta: resposta,
        criadoPor: autorId,
        criadoEm: new Date().toISOString()
    };
    
    await salvarComandosCustomizados();
    console.log(`✅ Comando '${nomeComando}' adicionado ao grupo ${chatId}`);
}

async function removerComandoCustomizado(chatId, nomeComando) {
    if (comandosCustomizados[chatId] && comandosCustomizados[chatId][nomeComando]) {
        delete comandosCustomizados[chatId][nomeComando];
        
        // Se não há mais comandos no grupo, remove a entrada do grupo
        if (Object.keys(comandosCustomizados[chatId]).length === 0) {
            delete comandosCustomizados[chatId];
        }
        
        await salvarComandosCustomizados();
        console.log(`🗑️ Comando '${nomeComando}' removido do grupo ${chatId}`);
        return true;
    }
    return false;
}

function executarComandoCustomizado(chatId, comando) {
    if (comandosCustomizados[chatId] && comandosCustomizados[chatId][comando]) {
        return comandosCustomizados[chatId][comando].resposta;
    }
    return null;
}

// === FUNÇÕES AUXILIARES ===

function detectarPerguntaPorNumero(mensagem) {
    const texto = mensagem.toLowerCase();
    
    const padroes = [
        /qual\s+(é\s+)?(o\s+)?número/i,
        /número\s+(de\s+)?(contato|suporte|atendimento)/i,
        /como\s+(falar|contactar|entrar em contacto)/i,
        /preciso\s+(de\s+)?(ajuda|suporte|número)/i,
        /onde\s+(posso\s+)?falar/i,
        /tem\s+(número|contacto|suporte)/i,
        /quero\s+falar\s+com/i,
        /atendimento/i,
        /suporte/i,
        /admin/i,
        /administrador/i,
        /responsável/i,
        /quem\s+(é\s+)?responsável/i,
        /como\s+contactar/i,
        /número\s+do\s+admin/i
    ];
    
    return padroes.some(padrao => padrao.test(texto));
}

function isAdministrador(numero) {
    return ADMINISTRADORES_GLOBAIS.includes(numero);
}

function isGrupoMonitorado(chatId) {
    return CONFIGURACAO_GRUPOS.hasOwnProperty(chatId);
}

function getConfiguracaoGrupo(chatId) {
    return CONFIGURACAO_GRUPOS[chatId] || null;
}

// Função para resolver ID interno (@lid) para número real (@c.us)
function resolverIdReal(participantId, adminsEncontrados) {
    // Se já é @c.us, retorna como está
    if (participantId.endsWith('@c.us')) {
        return participantId;
    }
    
    // Se tem mapeamento conhecido, usa ele
    if (MAPEAMENTO_IDS[participantId]) {
        return MAPEAMENTO_IDS[participantId];
    }
    
    // Se é @lid, tenta encontrar correspondência nos admins
    if (participantId.endsWith('@lid')) {
        // Para agora, retorna o próprio ID para permitir comparação direta
        return participantId;
    }
    
    return participantId;
}

async function isAdminGrupo(chatId, participantId) {
    try {
        console.log(`🔍 Verificando admin: chatId=${chatId}, participantId=${participantId}`);
        
        if (adminCache[chatId] && adminCache[chatId].timestamp > Date.now() - 300000) {
            const { admins, mapeamentoLidToCus } = adminCache[chatId];
            console.log(`📋 Usando cache...`);
            
            // Usar mapeamento para verificar se é admin
            const isAdmin = verificarAdminComMapeamento(participantId, admins, mapeamentoLidToCus);
            console.log(`✅ Cache - ${participantId} é admin? ${isAdmin}`);
            return isAdmin;
        }

        console.log(`🔄 Cache expirado/inexistente, buscando admins do grupo...`);
        const chat = await client.getChatById(chatId);
        const participants = await chat.participants;
        const admins = participants.filter(p => p.isAdmin || p.isSuperAdmin);
        
        console.log(`👥 Participantes do grupo: ${participants.length}`);
        // console.log(`👑 Admins (@c.us): ${admins.map(a => a.id._serialized).join(', ')}`);
        
        const participantesLid = participants.filter(p => p.id._serialized.endsWith('@lid'));
        const participantesCus = participants.filter(p => p.id._serialized.endsWith('@c.us'));
        
        console.log(`🔍 Participantes @lid: ${participantesLid.map(p => p.id._serialized).join(', ')}`);
        console.log(`🔍 Participantes @c.us: ${participantesCus.map(p => p.id._serialized).join(', ')}`);
        // console.log(`🎯 Procurando por: ${participantId}`);
        
        // ESTRATÉGIA ADICIONAL: Verificar se o participantId específico tem flag de admin
        let adminDireto = false;
        const participanteEspecifico = participants.find(p => p.id._serialized === participantId);
        if (participanteEspecifico) {
            adminDireto = participanteEspecifico.isAdmin || participanteEspecifico.isSuperAdmin;
            // console.log(`🎯 Participante ${participantId} encontrado! isAdmin: ${participanteEspecifico.isAdmin}, isSuperAdmin: ${participanteEspecifico.isSuperAdmin}`);
        } else {
            console.log(`⚠️ Participante ${participantId} NÃO encontrado na lista de participantes!`);
        }
        
        // CRIAR MAPEAMENTO AUTOMÁTICO
        const mapeamentoLidToCus = criarMapeamentoAutomatico(participants, admins);
        
        // Adicionar detecção direta se encontrada
        if (adminDireto) {
            mapeamentoLidToCus[participantId] = 'ADMIN_DIRETO';
            console.log(`✅ Adicionado ${participantId} como ADMIN_DIRETO no mapeamento!`);
        }
        
        // MAPEAMENTO DIRETO POR NÚMERO: Se o participantId for @lid e houver admin @c.us com mesmo número
        if (participantId.endsWith('@lid')) {
            const numeroBase = participantId.split('@')[0];
            const adminPorNumero = admins.find(admin => {
                return admin.id._serialized.split('@')[0] === numeroBase;
            });
            
            if (adminPorNumero && !mapeamentoLidToCus[participantId]) {
                mapeamentoLidToCus[participantId] = adminPorNumero.id._serialized;
                // console.log(`🎯 MAPEAMENTO DIRETO: ${participantId} -> ${adminPorNumero.id._serialized}`);
            }
        }
        
        console.log(`🗺️ Mapeamento criado:`, mapeamentoLidToCus);
        
        // Salvar cache com mapeamento
        adminCache[chatId] = {
            admins: admins,
            mapeamentoLidToCus: mapeamentoLidToCus,
            timestamp: Date.now()
        };

        // ESTRATÉGIA FINAL: Se não encontrou o participante na lista, tentar abordagem alternativa
        if (!participanteEspecifico && participantId.endsWith('@lid')) {
            console.log(`🔄 Tentativa alternativa: Buscando informações sobre ${participantId}...`);
            try {
                // Tentar obter informações do contato diretamente
                const contact = await client.getContactById(participantId);
                console.log(`📞 Info do contato:`, {
                    id: contact.id._serialized,
                    number: contact.number,
                    pushname: contact.pushname,
                    name: contact.name,
                    isUser: contact.isUser
                });
                
                // ESTRATÉGIA 1: Comparar por número real do contato
                if (contact.number) {
                    console.log(`🔍 Procurando admin com número real: ${contact.number}`);
                    
                    const adminPorNumeroReal = admins.find(admin => {
                        const numeroAdmin = admin.id._serialized.split('@')[0];
                        // Remover código de país e comparar
                        const numeroLimpoAdmin = numeroAdmin.replace(/^258/, '');
                        const numeroLimpoContato = contact.number.replace(/^258/, '').replace(/^/, '');
                        
                        console.log(`   🔍 Comparando "${numeroLimpoContato}" com admin "${numeroLimpoAdmin}"`);
                        return numeroLimpoAdmin === numeroLimpoContato || 
                               numeroAdmin === contact.number ||
                               numeroAdmin.endsWith(contact.number) ||
                               contact.number.endsWith(numeroLimpoAdmin);
                    });
                    
                    if (adminPorNumeroReal) {
                        mapeamentoLidToCus[participantId] = adminPorNumeroReal.id._serialized;
                        console.log(`✅ SUCESSO! Mapeado por número real: ${participantId} -> ${adminPorNumeroReal.id._serialized}`);
                    } else {
                        console.log(`❌ Nenhum admin encontrado com número real ${contact.number}`);
                    }
                }
                
                // ESTRATÉGIA 2: Comparar com admins por número base do ID (fallback)
                if (!mapeamentoLidToCus[participantId]) {
                    const numeroBase = participantId.split('@')[0];
                    console.log(`🔍 Fallback - Procurando admin com número base: ${numeroBase}`);
                    
                    const adminEncontrado = admins.find(admin => {
                        const numeroAdmin = admin.id._serialized.split('@')[0];
                        console.log(`   🔍 Comparando ${numeroBase} com admin ${numeroAdmin}`);
                        return numeroAdmin === numeroBase;
                    });
                    
                    if (adminEncontrado) {
                        mapeamentoLidToCus[participantId] = adminEncontrado.id._serialized;
                        console.log(`✅ SUCESSO! Mapeado por número base: ${participantId} -> ${adminEncontrado.id._serialized}`);
                    } else {
                        console.log(`❌ Nenhum admin encontrado com número ${numeroBase}`);
                        console.log(`📋 Admins disponíveis: ${admins.map(a => a.id._serialized.split('@')[0]).join(', ')}`);
                    }
                }
                
            } catch (err) {
                console.log(`⚠️ Erro ao buscar contato: ${err.message}`);
            }
        }
        
        // Verificar se é admin usando mapeamento
        const isAdmin = verificarAdminComMapeamento(participantId, admins, mapeamentoLidToCus);
        console.log(`✅ Resultado: ${participantId} é admin? ${isAdmin}`);
        return isAdmin;
    } catch (error) {
        console.error('❌ Erro ao verificar admin do grupo:', error);
        return false;
    }
}

// Criar mapeamento automático entre IDs @lid e @c.us
function criarMapeamentoAutomatico(participants, admins) {
    const mapeamento = {};
    
    // Para cada participante @lid, tentar encontrar correspondência com admin @c.us
    const participantesLid = participants.filter(p => p.id._serialized.endsWith('@lid'));
    const adminsIds = admins.map(a => a.id._serialized);
    
    console.log(`🔍 Tentando mapear ${participantesLid.length} IDs @lid para ${adminsIds.length} admins @c.us...`);
    
    // Debug detalhado dos participantes
    if (participantesLid.length === 0) {
        console.log(`⚠️ ATENÇÃO: Nenhum participante @lid encontrado!`);
        console.log(`📋 Todos participantes:`, participants.map(p => ({
            id: p.id._serialized,
            isAdmin: p.isAdmin,
            isSuperAdmin: p.isSuperAdmin,
            pushname: p.pushname
        })));
    }
    
    participantesLid.forEach(participante => {
        const lidId = participante.id._serialized;
        console.log(`🔍 Analisando ${lidId}: isAdmin=${participante.isAdmin}, isSuperAdmin=${participante.isSuperAdmin}, nome=${participante.pushname}`);
        
        // Estratégia 1: Verificar se o próprio participante @lid tem flag de admin
        if (participante.isAdmin || participante.isSuperAdmin) {
            console.log(`✅ ${lidId} tem flag de admin direto!`);
            mapeamento[lidId] = 'ADMIN_DIRETO'; // Marcador especial
            return;
        }
        
        // Estratégia 2: Matching por nome (se disponível)
        if (participante.pushname) {
            const adminCorrespondente = admins.find(admin => 
                admin.pushname && admin.pushname === participante.pushname
            );
            if (adminCorrespondente) {
                mapeamento[lidId] = adminCorrespondente.id._serialized;
                // console.log(`🎯 Mapeado por nome: ${lidId} -> ${adminCorrespondente.id._serialized}`);
                return;
            } else {
                console.log(`❌ Nenhum admin encontrado com nome "${participante.pushname}"`);
            }
        } else {
            console.log(`⚠️ ${lidId} não tem nome disponível para matching`);
        }
    });
    
    return mapeamento;
}

// Verificar se é admin usando o mapeamento
function verificarAdminComMapeamento(participantId, admins, mapeamento) {
    const adminsIds = admins.map(a => a.id._serialized);
    
    // 1. Verificação direta (caso seja @c.us)
    if (adminsIds.includes(participantId)) {
        console.log(`✅ ${participantId} é admin direto (@c.us)`);
        return true;
    }
    
    // 2. Verificação via mapeamento (caso seja @lid)
    if (mapeamento[participantId]) {
        if (mapeamento[participantId] === 'ADMIN_DIRETO') {
            console.log(`✅ ${participantId} é admin direto (@lid com flag)`);
            return true;
        } else if (adminsIds.includes(mapeamento[participantId])) {
            console.log(`✅ ${participantId} mapeado para admin ${mapeamento[participantId]}`);
            return true;
        }
    }
    
    console.log(`❌ ${participantId} não é admin`);
    return false;
}

// Função para verificar se um ID corresponde a um admin
function verificarSeEhAdmin(participantId, admins, todosParticipantes) {
    console.log(`🔍 Procurando ${participantId} entre ${admins.length} admins...`);
    
    // 1. Verificação direta por ID
    const adminDireto = admins.find(admin => admin.id._serialized === participantId);
    if (adminDireto) {
        console.log(`✅ Encontrado por ID direto: ${adminDireto.id._serialized}`);
        return true;
    }
    
    // 2. Para IDs @lid, tentar encontrar correspondência por pushname ou outras características
    if (participantId.endsWith('@lid')) {
        console.log(`🔍 ${participantId} é ID @lid, procurando correspondência...`);
        
        // Buscar o participante pelo ID @lid
        const participante = todosParticipantes.find(p => p.id._serialized === participantId);
        if (participante) {
            console.log(`📱 Participante @lid encontrado:`, {
                id: participante.id._serialized,
                pushname: participante.pushname || 'N/A',
                isAdmin: participante.isAdmin || false,
                isSuperAdmin: participante.isSuperAdmin || false
            });
            
            // VERIFICAÇÃO DIRETA: Se o próprio participante @lid tem flag de admin
            if (participante.isAdmin || participante.isSuperAdmin) {
                console.log(`✅ O próprio participante @lid TEM flag de admin!`);
                return true;
            }
            
            // Verificar se existe admin com mesmo pushname ou número base
            const adminCorrespondente = admins.find(admin => {
                // Tentar matching por pushname se disponível
                if (participante.pushname && admin.pushname && 
                    participante.pushname === admin.pushname) {
                    return true;
                }
                return false;
            });
            
            if (adminCorrespondente) {
                console.log(`✅ Encontrado admin correspondente por pushname: ${adminCorrespondente.id._serialized}`);
                return true;
            }
        } else {
            console.log(`❌ Participante @lid ${participantId} não encontrado na lista de participantes`);
        }
    }
    
    console.log(`❌ ${participantId} não é admin do grupo`);
    return false;
}

function contemConteudoSuspeito(mensagem) {
    const texto = mensagem.toLowerCase();
    const temLink = /(?:https?:\/\/|www\.|\.com|\.net|\.org|\.br|\.mz|bit\.ly|tinyurl|t\.me|wa\.me|whatsapp\.com|telegram\.me|link|url)/i.test(texto);
    
    return {
        temLink: MODERACAO_CONFIG.detectarLinks && temLink,
        suspeito: MODERACAO_CONFIG.detectarLinks && temLink
    };
}

async function deletarMensagem(message) {
    try {
        await message.delete(true);
        console.log(`🗑️ Mensagem deletada`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao deletar mensagem:', error);
        return false;
    }
}

async function removerParticipante(chatId, participantId, motivo) {
    try {
        const chat = await client.getChatById(chatId);
        await chat.removeParticipants([participantId]);
        console.log(`🚫 Participante removido: ${participantId} - ${motivo}`);
        return true;
    } catch (error) {
        console.error('❌ Erro ao remover participante:', error);
        return false;
    }
}

async function aplicarModeracao(message, motivoDeteccao) {
    const chatId = message.from;
    const authorId = message.author || message.from;
    
    try {
        if (!MODERACAO_CONFIG.ativado[chatId]) {
            return;
        }

        if (MODERACAO_CONFIG.excecoes.includes(authorId) || isAdministrador(authorId)) {
            return;
        }

        const isAdmin = await isAdminGrupo(chatId, authorId);
        if (isAdmin) {
            return;
        }

        console.log(`🚨 MODERAÇÃO: ${motivoDeteccao}`);

        if (MODERACAO_CONFIG.apagarMensagem) {
            await deletarMensagem(message);
        }

        if (MODERACAO_CONFIG.removerUsuario) {
            await removerParticipante(chatId, authorId, motivoDeteccao);
        }

    } catch (error) {
        console.error('❌ Erro durante moderação:', error);
    }
}

// === DETECÇÃO DE GRUPOS ===
async function logGrupoInfo(chatId, evento = 'detectado') {
    try {
        const chat = await client.getChatById(chatId);
        const isGrupoMonitorado = CONFIGURACAO_GRUPOS.hasOwnProperty(chatId);
        
        console.log(`\n🔍 ═══════════════════════════════════════`);
        console.log(`📋 GRUPO ${evento.toUpperCase()}`);
        console.log(`🔍 ═══════════════════════════════════════`);
        console.log(`📛 Nome: ${chat.name}`);
        console.log(`🆔 ID: ${chatId}`);
        console.log(`👥 Participantes: ${chat.participants ? chat.participants.length : 'N/A'}`);
        console.log(`📊 Monitorado: ${isGrupoMonitorado ? '✅ SIM' : '❌ NÃO'}`);
        console.log(`⏰ Data: ${new Date().toLocaleString('pt-BR')}`);
        
        if (!isGrupoMonitorado) {
            console.log(`\n🔧 PARA ADICIONAR ESTE GRUPO:`);
            console.log(`📝 Copie este código para CONFIGURACAO_GRUPOS:`);
            console.log(`\n'${chatId}': {`);
            console.log(`    nome: '${chat.name}',`);
            console.log(`    tabela: \`SUA_TABELA_AQUI\`,`);
            console.log(`    pagamento: \`SUAS_FORMAS_DE_PAGAMENTO_AQUI\``);
            console.log(`},\n`);
        }
        
        console.log(`🔍 ═══════════════════════════════════════\n`);
        
        return {
            id: chatId,
            nome: chat.name,
            participantes: chat.participants ? chat.participants.length : 0,
            monitorado: isGrupoMonitorado
        };
        
    } catch (error) {
        console.error(`❌ Erro ao obter informações do grupo ${chatId}:`, error);
        return null;
    }
}

// === HISTÓRICO DE COMPRADORES ===

async function carregarHistorico() {
    try {
        const data = await fs.readFile(ARQUIVO_HISTORICO, 'utf8');
        historicoCompradores = JSON.parse(data);
        console.log('📊 Histórico carregado!');
    } catch (error) {
        console.log('📊 Criando novo histórico...');
        historicoCompradores = {};
    }
}

// === SALVAMENTO DE HISTÓRICO OTIMIZADO ===
let salvamentoHistoricoPendente = false;
let timeoutHistorico = null;

async function salvarHistorico() {
    if (salvamentoHistoricoPendente) return;
    salvamentoHistoricoPendente = true;

    try {
        await fs.writeFile(ARQUIVO_HISTORICO, JSON.stringify(historicoCompradores));
    } catch (error) {
        console.error('❌ Erro ao salvar histórico:', error);
    } finally {
        salvamentoHistoricoPendente = false;
    }
}

function agendarSalvamentoHistorico() {
    if (timeoutHistorico) {
        clearTimeout(timeoutHistorico);
    }

    timeoutHistorico = setTimeout(async () => {
        agendarSalvamentoHistorico();
        timeoutHistorico = null;
    }, 3000); // 3 segundos para histórico
}

async function registrarComprador(grupoId, numeroComprador, nomeContato, valorTransferencia) {
    const agora = new Date();
    const timestamp = agora.toISOString();

    if (!historicoCompradores[grupoId]) {
        historicoCompradores[grupoId] = {
            nomeGrupo: getConfiguracaoGrupo(grupoId)?.nome || 'Grupo Desconhecido',
            compradores: {}
        };
    }

    if (!historicoCompradores[grupoId].compradores[numeroComprador]) {
        historicoCompradores[grupoId].compradores[numeroComprador] = {
            primeiraCompra: timestamp,
            ultimaCompra: timestamp,
            totalCompras: 1,
            nomeContato: nomeContato,
            historico: []
        };
    } else {
        historicoCompradores[grupoId].compradores[numeroComprador].ultimaCompra = timestamp;
        historicoCompradores[grupoId].compradores[numeroComprador].totalCompras++;
        historicoCompradores[grupoId].compradores[numeroComprador].nomeContato = nomeContato;
    }

    historicoCompradores[grupoId].compradores[numeroComprador].historico.push({
        data: timestamp,
        valor: valorTransferencia
    });

    if (historicoCompradores[grupoId].compradores[numeroComprador].historico.length > 10) {
        historicoCompradores[grupoId].compradores[numeroComprador].historico =
            historicoCompradores[grupoId].compradores[numeroComprador].historico.slice(-10);
    }

    agendarSalvamentoHistorico();
    console.log(`💰 Comprador registrado: ${nomeContato} (${numeroComprador}) - ${valorTransferencia}MT`);
}

// === FILA DE MENSAGENS ===

function adicionarNaFila(mensagem, autor, nomeGrupo, timestamp) {
    const item = {
        conteudo: mensagem,
        autor: autor,
        grupo: nomeGrupo,
        timestamp: timestamp,
        id: Date.now() + Math.random()
    };

    filaMensagens.push(item);
    console.log(`📥 Adicionado à fila: ${filaMensagens.length} mensagens`);

    if (!processandoFila) {
        processarFila();
    }
}

async function processarFila() {
    if (processandoFila || filaMensagens.length === 0) {
        return;
    }

    processandoFila = true;
    console.log(`🚀 Processando ${filaMensagens.length} mensagens...`);

    while (filaMensagens.length > 0) {
        const item = filaMensagens.shift();

        try {
            await client.sendMessage(ENCAMINHAMENTO_CONFIG.numeroDestino, item.conteudo);
            console.log(`✅ Encaminhado: ${item.conteudo.substring(0, 50)}...`);

            if (filaMensagens.length > 0) {
                await new Promise(resolve => setTimeout(resolve, ENCAMINHAMENTO_CONFIG.intervaloSegundos * 1000));
            }

        } catch (error) {
            console.error(`❌ Erro ao encaminhar:`, error);
            filaMensagens.unshift(item);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    processandoFila = false;
    console.log(`🎉 Fila processada!`);
}

// === EVENTOS DO BOT ===

client.on('qr', (qr) => {
    console.log('📱 QR Code gerado - Escaneie o QR Code:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('🔐 Cliente autenticado com sucesso!');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Falha na autenticação:', msg);
});

client.on('loading_screen', (percent, message) => {
    console.log('⏳ Carregando WhatsApp...', percent + '%', message);
});

client.on('ready', async () => {
    console.log('✅ Bot conectado e pronto!');
    console.log('🧠 IA WhatsApp ativa!');
    console.log('📊 Google Sheets configurado!');
    console.log(`🔗 URL: ${GOOGLE_SHEETS_CONFIG.scriptUrl}`);
    console.log('🤖 Bot Retalho - Lógica simples igual ao Bot Atacado!');
    
    // === INICIALIZAR SISTEMA DE PACOTES APÓS WhatsApp CONECTAR ===
    if (process.env.SISTEMA_PACOTES_ENABLED === 'true') {
        sistemaPacotes = new SistemaPacotes();
        console.log('📦 Sistema de Pacotes Automáticos ATIVADO');
    } else {
        console.log('📦 Sistema de Pacotes Automáticos DESABILITADO (.env)');
    }
    
    // === INICIALIZAR SISTEMA DE COMPRAS ===
    sistemaCompras = new SistemaCompras();
    console.log('🛒 Sistema de Registro de Compras ATIVADO');
    
    // Carregar dados de referência
    await carregarDadosReferencia();
    
    await carregarHistorico();
    
    console.log('\n🤖 Monitorando grupos:');
    Object.keys(CONFIGURACAO_GRUPOS).forEach(grupoId => {
        const config = CONFIGURACAO_GRUPOS[grupoId];
        console.log(`   📋 ${config.nome} (${grupoId})`);
    });
    
    console.log('\n🔧 Comandos admin: .ia .stats .sheets .test_sheets .test_grupo .grupos_status .grupos .grupo_atual .addcomando .comandos .delcomando .test_vision .ranking .inativos .semcompra .resetranking .bonus .setboasvindas .getboasvindas .testboasvindas');
    
    // Iniciar monitoramento automático de novos membros
    await iniciarMonitoramentoMembros();
});

client.on('group-join', async (notification) => {
    try {
        const chatId = notification.chatId;
        const addedParticipants = notification.recipientIds || [];
        const botInfo = client.info;
        
        if (botInfo && addedParticipants.includes(botInfo.wid._serialized)) {
            console.log(`\n🤖 BOT ADICIONADO A UM NOVO GRUPO!`);
            await logGrupoInfo(chatId, 'BOT ADICIONADO');
            
            setTimeout(async () => {
                try {
                    const isMonitorado = CONFIGURACAO_GRUPOS.hasOwnProperty(chatId);
                    const mensagem = isMonitorado ? 
                        `🤖 *BOT ATIVO E CONFIGURADO!*\n\nEste grupo está monitorado e o sistema automático já está funcionando.\n\n📋 Digite: *tabela* (ver preços)\n💳 Digite: *pagamento* (ver formas)` :
                        `🤖 *BOT CONECTADO!*\n\n⚙️ Este grupo ainda não está configurado.\n🔧 Contacte o administrador para ativação.\n\n📝 ID do grupo copiado no console do servidor.`;
                    
                    await client.sendMessage(chatId, mensagem);
                    console.log(`✅ Mensagem de status enviada`);
                } catch (error) {
                    console.error('❌ Erro ao enviar mensagem de status:', error);
                }
            }, 3000);
        } else {
            // NOVOS MEMBROS (NÃO-BOT) ENTRARAM NO GRUPO
            const configGrupo = getConfiguracaoGrupo(chatId);
            
            if (configGrupo) {
                // Processar cada novo membro
                for (const participantId of addedParticipants) {
                    try {
                        console.log(`👋 Novo membro: ${participantId} em ${configGrupo.nome}`);
                        
                        // Aguardar um pouco para evitar spam
                        setTimeout(async () => {
                            try {
                                await enviarBoasVindas(chatId, participantId);
                            } catch (error) {
                                console.error(`❌ Erro ao enviar boas-vindas para ${participantId}:`, error);
                            }
                        }, 2000 + (Math.random() * 3000));
                        
                    } catch (error) {
                        console.error(`❌ Erro ao processar novo membro ${participantId}:`, error);
                    }
                }
            }
        }
    } catch (error) {
        console.error('❌ Erro no evento group-join:', error);
    }
});

client.on('message', async (message) => {
    try {
        const isPrivado = !message.from.endsWith('@g.us');
        const autorMensagem = message.author || message.from;
        const isAdmin = isAdministrador(autorMensagem);
        
        // DEBUG DETALHADO DA MENSAGEM
        if (message.body.startsWith('.addcomando') || message.body.startsWith('.comandos') || message.body.startsWith('.delcomando')) {
            console.log(`🔍 DEBUG MENSAGEM ADMIN:`);
            console.log(`   📱 message.from: ${message.from}`);
            console.log(`   👤 message.author: ${message.author}`);
            console.log(`   🆔 autorMensagem: ${autorMensagem}`);
            
            try {
                const contact = await message.getContact();
                console.log(`   📞 Contact info:`, {
                    id: contact.id._serialized,
                    number: contact.number,
                    pushname: contact.pushname,
                    name: contact.name,
                    isMyContact: contact.isMyContact
                });
            } catch (err) {
                console.log(`   ⚠️ Erro ao obter contato: ${err.message}`);
            }
        }
        
        console.log(`🔍 Debug: Verificando admin para ${autorMensagem}, resultado: ${isAdmin}`);

        // === COMANDOS ADMINISTRATIVOS ===
        // Verificar se é admin global OU admin do grupo
        let isAdminDoGrupo = false;
        
        // Só verificar admin do grupo se for mensagem de grupo
        if (message.from.endsWith('@g.us')) {
            isAdminDoGrupo = await isAdminGrupo(message.from, autorMensagem);
            console.log(`🔍 Debug admin grupo: ${autorMensagem} é admin do grupo? ${isAdminDoGrupo}`);
        }
        
        const isAdminQualquer = isAdmin || isAdminDoGrupo;
        console.log(`🔍 Debug final: isAdminQualquer = ${isAdminQualquer} (global: ${isAdmin}, grupo: ${isAdminDoGrupo})`);
        
        if (isAdminQualquer) {
            const comando = message.body.toLowerCase().trim();

            if (comando === '.ia') {
                const statusIA = ia.getStatusDetalhado();
                await message.reply(statusIA);
                console.log(`🧠 Comando .ia executado`);
                return;
            }

            if (comando === '.stats') {
                let stats = `📊 *ESTATÍSTICAS*\n⚠ NB: Válido apenas para Vodacom━━━━━━━━\n\n`;
                
                Object.keys(CONFIGURACAO_GRUPOS).forEach(grupoId => {
                    const config = CONFIGURACAO_GRUPOS[grupoId];
                    const dados = historicoCompradores[grupoId];
                    const totalCompradores = dados ? Object.keys(dados.compradores || {}).length : 0;
                    
                    if (totalCompradores > 0) {
                        stats += `🏢 *${config.nome}*\n`;
                        stats += `👥 ${totalCompradores} compradores\n\n`;
                    }
                });
                
                await message.reply(stats);
                return;
            }

            if (comando === '.bonus_stats') {
                let stats = `🎁 *ESTATÍSTICAS DO SISTEMA DE REFERÊNCIAS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                // Estatísticas gerais
                const totalCodigos = Object.keys(codigosReferencia).length;
                const totalReferencias = Object.keys(referenciasClientes).length;
                const totalUsuariosComBonus = Object.keys(bonusSaldos).length;
                const totalSaques = Object.keys(pedidosSaque).length;
                
                stats += `📊 **RESUMO GERAL:**\n`;
                stats += `   • Códigos gerados: ${totalCodigos}\n`;
                stats += `   • Referências ativas: ${totalReferencias}\n`;
                stats += `   • Usuários com bônus: ${totalUsuariosComBonus}\n`;
                stats += `   • Saques solicitados: ${totalSaques}\n\n`;
                
                // Top convidadores
                const topConvidadores = Object.values(bonusSaldos)
                    .map(dados => ({
                        saldo: dados.saldo,
                        referencias: Object.keys(dados.detalhesReferencias || {}).length,
                        dados: dados
                    }))
                    .sort((a, b) => b.saldo - a.saldo)
                    .slice(0, 5);
                
                if (topConvidadores.length > 0) {
                    stats += `🏆 **TOP 5 CONVIDADORES:**\n`;
                    topConvidadores.forEach((item, index) => {
                        const saldoGB = (item.saldo / 1024).toFixed(2);
                        stats += `   ${index + 1}. ${item.saldo}MB (${saldoGB}GB) - ${item.referencias} referências\n`;
                    });
                    stats += `\n`;
                }
                
                // Estatísticas de compras
                let totalComprasBonus = 0;
                let totalBonusDistribuido = 0;
                
                Object.values(bonusSaldos).forEach(saldo => {
                    if (saldo.detalhesReferencias) {
                        Object.values(saldo.detalhesReferencias).forEach(ref => {
                            totalComprasBonus += ref.compras || 0;
                            totalBonusDistribuido += ref.bonusGanho || 0;
                        });
                    }
                });
                
                stats += `💰 **BÔNUS DISTRIBUÍDOS:**\n`;
                stats += `   • Total de compras que geraram bônus: ${totalComprasBonus}\n`;
                stats += `   • Total de MB distribuídos: ${totalBonusDistribuido}MB\n`;
                stats += `   • Equivalente em GB: ${(totalBonusDistribuido / 1024).toFixed(2)}GB\n\n`;
                
                // Saques pendentes
                const saquesPendentes = Object.values(pedidosSaque).filter(p => p.status === 'pendente');
                if (saquesPendentes.length > 0) {
                    stats += `⏳ **SAQUES PENDENTES:** ${saquesPendentes.length}\n`;
                    const totalPendente = saquesPendentes.reduce((sum, p) => sum + p.quantidade, 0);
                    stats += `   • Valor total: ${totalPendente}MB (${(totalPendente/1024).toFixed(2)}GB)\n\n`;
                }
                
                stats += `📈 **SISTEMA DE REFERÊNCIAS ATIVO E FUNCIONANDO!**`;
                
                await message.reply(stats);
                return;
            }

            // === COMANDOS DO SISTEMA DE PACOTES ===
            if (sistemaPacotes) {
                
                // .pacote DIAS REF NUMERO - Criar pacote
                if (comando.startsWith('.pacote ')) {
                    console.log(`🔧 DEBUG: Comando .pacote detectado!`);
                    console.log(`🔧 DEBUG: sistemaPacotes = ${sistemaPacotes ? 'INICIALIZADO' : 'NULL'}`);
                    console.log(`🔧 DEBUG: SISTEMA_PACOTES_ENABLED = ${process.env.SISTEMA_PACOTES_ENABLED}`);
                    
                    if (!sistemaPacotes) {
                        await message.reply(`❌ *SISTEMA DE PACOTES DESABILITADO*\n\nO sistema de pacotes automáticos não está ativo neste servidor.\n\nVerifique as configurações de ambiente.`);
                        return;
                    }
                    const partes = message.body.trim().split(' ');
                    
                    if (partes.length < 4) {
                        await message.reply(`❌ *USO INCORRETO*\n\n✅ **Formato correto:**\n*.pacote DIAS REF NUMERO*\n\n📝 **Exemplos:**\n• *.pacote 3 ABC123 845123456*\n• *.pacote 30 XYZ789 847654321*\n\n📦 **Tipos disponíveis:**\n• 3 - Pacote de 3 dias (300MB)\n• 5 - Pacote de 5 dias (500MB)\n• 15 - Pacote de 15 dias (1.5GB)\n• 30 - Pacote de 30 dias (3GB)`);
                        return;
                    }
                    
                    const [, diasPacote, referencia, numero] = partes;
                    const grupoId = message.from;
                    
                    console.log(`📦 COMANDO PACOTE: Dias=${diasPacote}, Ref=${referencia}, Numero=${numero}`);
                    
                    const resultado = await sistemaPacotes.processarComprovante(referencia, numero, grupoId, diasPacote);
                    
                    if (resultado.sucesso) {
                        await message.reply(resultado.mensagem);
                    } else {
                        await message.reply(`❌ **ERRO AO CRIAR PACOTE**\n\n⚠️ ${resultado.erro}\n\n💡 **Verificar:**\n• Dias válidos (3, 5, 15, 30)\n• Referência não está duplicada`);
                    }
                    return;
                }
                
                // .pacotes_ativos - Listar clientes com pacotes ativos (do grupo atual)
                if (comando === '.pacotes_ativos') {
                    const lista = sistemaPacotes.listarClientesAtivos(message.from);
                    await message.reply(lista);
                    return;
                }
                
                // .pacotes_stats - Estatísticas do sistema de pacotes
                if (comando === '.pacotes_stats') {
                    const stats = sistemaPacotes.obterEstatisticas();
                    await message.reply(stats);
                    return;
                }

                // .pacotes_todos - Listar pacotes de TODOS os grupos (apenas admins globais)
                if (comando === '.pacotes_todos') {
                    if (!isAdministrador(autorMensagem)) {
                        await message.reply('❌ *Acesso negado!* Apenas administradores globais podem ver pacotes de todos os grupos.');
                        return;
                    }
                    const lista = sistemaPacotes.listarClientesAtivos(null); // null = todos os grupos
                    await message.reply(lista);
                    return;
                }
                
                // .cancelar_pacote NUMERO REF - Cancelar pacote
                if (comando.startsWith('.cancelar_pacote ')) {
                    const partes = message.body.trim().split(' ');
                    
                    if (partes.length < 3) {
                        await message.reply(`❌ *USO INCORRETO*\n\n✅ **Formato correto:**\n*.cancelar_pacote NUMERO REFERENCIA*\n\n📝 **Exemplo:**\n• *.cancelar_pacote 845123456 ABC123*`);
                        return;
                    }
                    
                    const [, numero, referencia] = partes;
                    const resultado = sistemaPacotes.cancelarPacote(numero, referencia);
                    await message.reply(resultado);
                    return;
                }

                // .validade NUMERO - Verificar validade do pacote (comando para CLIENTES)
                if (comando.startsWith('.validade ')) {
                    const partes = message.body.trim().split(' ');
                    
                    if (partes.length < 2) {
                        await message.reply(`❌ *USO INCORRETO*\n\n✅ **Formato correto:**\n*.validade NUMERO*\n\n📝 **Exemplo:**\n• *.validade 845123456*\n\n💡 Digite seu número para verificar a validade do seu pacote de 100MB diários.`);
                        return;
                    }
                    
                    const numero = partes[1];
                    const resultado = sistemaPacotes.verificarValidadePacote(numero);
                    
                    await message.reply(resultado);
                    return;
                }
                
                // .sistema_pacotes - Status do sistema
                if (comando === '.sistema_pacotes') {
                    const status = sistemaPacotes.getStatus();
                    let resposta = `📦 *STATUS DO SISTEMA DE PACOTES*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    resposta += `🟢 **Status:** ${status.ativo ? 'ATIVO' : 'INATIVO'}\n`;
                    resposta += `👥 **Clientes ativos:** ${status.clientesAtivos}\n`;
                    resposta += `⏱️ **Verificação:** ${status.intervalVerificacao/60000} min\n`;
                    resposta += `📦 **Tipos disponíveis:** ${status.tiposPacotes.join(', ')}\n`;
                    resposta += `📊 **Histórico:** ${status.historicoSize} registros\n\n`;
                    resposta += `🔧 **Comandos Administrativos:**\n`;
                    resposta += `• *.pacote DIAS REF NUMERO* - Criar pacote\n`;
                    resposta += `• *.pacotes_ativos* - Listar ativos\n`;
                    resposta += `• *.pacotes_stats* - Estatísticas\n`;
                    resposta += `• *.cancelar_pacote NUMERO REF* - Cancelar\n\n`;
                    resposta += `👤 **Comando para Clientes:**\n`;
                    resposta += `• *.validade NUMERO* - Verificar validade do pacote\n\n`;
                    resposta += `⚡ *Sistema funcionando automaticamente!*`;
                    
                    await message.reply(resposta);
                    return;
                }
            }

            // === COMANDOS DO SISTEMA DE COMPRAS ===
            if (sistemaCompras) {
                // .ranking - Mostrar ranking completo de compradores
                if (comando === '.ranking') {
                    try {
                        const ranking = await sistemaCompras.obterRankingCompletoGrupo(message.from);
                        
                        if (ranking.length === 0) {
                            await message.reply(`📊 *RANKING DE COMPRADORES*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🚫 Nenhum comprador registrado hoje.`);
                            return;
                        }
                        
                        let mensagem = `📊 *RANKING DE COMPRADORES*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                        let mentions = [];
                        
                        for (let i = 0; i < ranking.length; i++) {
                            const item = ranking[i];
                            const contactId = item.numero + '@c.us';
                            
                            // Obter informações do contato
                            try {
                                const contact = await client.getContactById(contactId);
                                
                                // Prioridade: nome salvo > nome do perfil > número
                                const nomeExibicao = contact.name || contact.pushname || item.numero;
                                const numeroLimpo = contact.id.user; // Número sem @ e sem +
                                
                                const posicaoEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${item.posicao}º`;
                                const megasFormatados = item.megas >= 1024 ? 
                                    `${(item.megas/1024).toFixed(1)}GB` : `${item.megas}MB`;
                                
                                mensagem += `${posicaoEmoji} @${numeroLimpo}\n`;
                                mensagem += `   💾 ${megasFormatados} no grupo (${item.compras}x)\n`;
                                mensagem += `   📊 Total: ${item.megasTotal >= 1024 ? (item.megasTotal/1024).toFixed(1)+'GB' : item.megasTotal+'MB'}\n\n`;
                                
                                mentions.push(contactId);
                            } catch (error) {
                                // Se não conseguir obter o contato, usar apenas o número
                                const posicaoEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${item.posicao}º`;
                                const megasFormatados = item.megas >= 1024 ? 
                                    `${(item.megas/1024).toFixed(1)}GB` : `${item.megas}MB`;
                                
                                mensagem += `${posicaoEmoji} @${item.numero}\n`;
                                mensagem += `   💾 ${megasFormatados} no grupo (${item.compras}x)\n`;
                                mensagem += `   📊 Total: ${item.megasTotal >= 1024 ? (item.megasTotal/1024).toFixed(1)+'GB' : item.megasTotal+'MB'}\n\n`;
                                
                                mentions.push(contactId);
                            }
                        }
                        
                        mensagem += `🏆 *Total de compradores no grupo: ${ranking.length}*`;
                        
                        await client.sendMessage(message.from, mensagem, { mentions: mentions });
                        return;
                    } catch (error) {
                        console.error('❌ Erro ao obter ranking:', error);
                        await message.reply(`❌ *ERRO*\n\nNão foi possível obter o ranking de compradores.\n\n⚠️ Erro: ${error.message}`);
                        return;
                    }
                }
                
                // .inativos - Mostrar compradores inativos (mais de 10 dias sem comprar)
                if (comando === '.inativos') {
                    try {
                        const inativos = await sistemaCompras.obterInativos();
                        
                        if (inativos.length === 0) {
                            await message.reply(`😴 *COMPRADORES INATIVOS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n🎉 Todos os compradores estão ativos!\nNinguém está há mais de 10 dias sem comprar.`);
                            return;
                        }
                        
                        let mensagem = `😴 *COMPRADORES INATIVOS*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                        mensagem += `⏰ Mais de 10 dias sem comprar\n\n`;
                        let mentions = [];
                        
                        for (let i = 0; i < Math.min(inativos.length, 20); i++) {
                            const item = inativos[i];
                            const contactId = item.numero + '@c.us';
                            
                            // Obter informações do contato
                            try {
                                const contact = await client.getContactById(contactId);
                                
                                // Prioridade: nome salvo > nome do perfil > número
                                const nomeExibicao = contact.name || contact.pushname || item.numero;
                                const numeroLimpo = contact.id.user; // Número sem @ e sem +
                                
                                const totalFormatado = item.megasTotal >= 1024 ? 
                                    `${(item.megasTotal/1024).toFixed(1)}GB` : `${item.megasTotal}MB`;
                                
                                mensagem += `👤 @${numeroLimpo}\n`;
                                mensagem += `   ⏰ ${item.diasSemComprar} dias sem comprar\n`;
                                mensagem += `   📊 Total: ${item.totalCompras}x compras (${totalFormatado})\n\n`;
                                
                                mentions.push(contactId);
                            } catch (error) {
                                // Se não conseguir obter o contato, usar apenas o número
                                const totalFormatado = item.megasTotal >= 1024 ? 
                                    `${(item.megasTotal/1024).toFixed(1)}GB` : `${item.megasTotal}MB`;
                                
                                mensagem += `👤 @${item.numero}\n`;
                                mensagem += `   ⏰ ${item.diasSemComprar} dias sem comprar\n`;
                                mensagem += `   📊 Total: ${item.totalCompras}x compras (${totalFormatado})\n\n`;
                                
                                mentions.push(contactId);
                            }
                        }
                        
                        if (inativos.length > 20) {
                            mensagem += `... e mais ${inativos.length - 20} compradores inativos\n\n`;
                        }
                        
                        mensagem += `😴 *Total de inativos: ${inativos.length}*`;
                        
                        await client.sendMessage(message.from, mensagem, { mentions: mentions });
                        return;
                    } catch (error) {
                        console.error('❌ Erro ao obter inativos:', error);
                        await message.reply(`❌ *ERRO*\n\nNão foi possível obter a lista de inativos.\n\n⚠️ Erro: ${error.message}`);
                        return;
                    }
                }
                
                // .semcompra - Mostrar usuários que nunca compraram
                if (comando === '.semcompra') {
                    try {
                        const semCompra = await sistemaCompras.obterSemCompra();
                        
                        if (semCompra.length === 0) {
                            await message.reply(`🆕 *USUÁRIOS SEM COMPRAS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n✨ Todos os usuários registrados já fizeram pelo menos uma compra!`);
                            return;
                        }
                        
                        let mensagem = `🆕 *USUÁRIOS SEM COMPRAS*\n━━━━━━━━━━━━━━━━━━━━━━━\n`;
                        mensagem += `👥 Nunca fizeram compras\n\n`;
                        let mentions = [];
                        
                        for (let i = 0; i < Math.min(semCompra.length, 30); i++) {
                            const item = semCompra[i];
                            const contactId = item.numero + '@c.us';
                            
                            // Obter informações do contato
                            try {
                                const contact = await client.getContactById(contactId);
                                
                                // Prioridade: nome salvo > nome do perfil > número
                                const nomeExibicao = contact.name || contact.pushname || item.numero;
                                const numeroLimpo = contact.id.user; // Número sem @ e sem +
                                
                                mensagem += `👤 @${numeroLimpo}\n`;
                                mensagem += `   📅 Registrado: ${new Date(item.primeiraCompra).toLocaleDateString('pt-BR')}\n`;
                                mensagem += `   💰 Compras: ${item.totalCompras} (${item.megasTotal}MB)\n\n`;
                                
                                mentions.push(contactId);
                            } catch (error) {
                                // Se não conseguir obter o contato, usar apenas o número
                                mensagem += `👤 @${item.numero}\n`;
                                mensagem += `   📅 Registrado: ${new Date(item.primeiraCompra).toLocaleDateString('pt-BR')}\n`;
                                mensagem += `   💰 Compras: ${item.totalCompras} (${item.megasTotal}MB)\n\n`;
                                
                                mentions.push(contactId);
                            }
                        }
                        
                        if (semCompra.length > 30) {
                            mensagem += `... e mais ${semCompra.length - 30} usuários sem compras\n\n`;
                        }
                        
                        mensagem += `🆕 *Total sem compras: ${semCompra.length}*\n\n`;
                        mensagem += `💡 *Dica:* Considere campanhas de incentivo para estes usuários!`;
                        
                        await client.sendMessage(message.from, mensagem, { mentions: mentions });
                        return;
                    } catch (error) {
                        console.error('❌ Erro ao obter sem compra:', error);
                        await message.reply(`❌ *ERRO*\n\nNão foi possível obter a lista de usuários sem compras.\n\n⚠️ Erro: ${error.message}`);
                        return;
                    }
                }

                // .resetranking - Reset manual do ranking diário (ADMIN APENAS)
                if (comando === '.resetranking') {
                    try {
                        // Verificar permissão de admin
                        const admins = ['258861645968', '258123456789', '258852118624']; // Lista de admins
                        if (!admins.includes(remetente)) {
                            return; // Falha silenciosa para segurança
                        }

                        console.log(`🔄 RESET: Admin ${remetente} solicitou reset do ranking diário`);

                        // Executar reset através do sistema de compras
                        const resultado = await sistemaCompras.resetarRankingGrupo(message.from);

                        if (resultado.success) {
                            let resposta = `🔄 *RANKING RESETADO*\n\n`;
                            resposta += `✅ *Status:* ${resultado.message}\n`;
                            resposta += `👥 *Clientes afetados:* ${resultado.clientesResetados}\n`;
                            resposta += `📅 *Data do reset:* ${new Date(resultado.dataReset).toLocaleString('pt-BR')}\n`;
                            resposta += `👑 *Executado por:* Administrador\n\n`;
                            resposta += `💡 *Próximos passos:*\n`;
                            resposta += `• Use .ranking para verificar novo estado\n`;
                            resposta += `• Novos comprovantes começarão nova contagem`;

                            await message.reply(resposta);
                        } else {
                            await message.reply(`❌ *ERRO NO RESET*\n\n⚠️ ${resultado.message}\n\n💡 Contate o suporte técnico se o problema persistir`);
                        }

                    } catch (error) {
                        console.error('❌ Erro no comando .resetranking:', error);
                        await message.reply(`❌ *ERRO INTERNO*\n\n⚠️ Não foi possível resetar o ranking\n\n📝 Erro: ${error.message}`);
                    }
                    return;
                }
                
                // .setboasvindas - Definir mensagem de boas-vindas personalizada (ADMIN APENAS)
                if (comando.startsWith('.setboasvindas ')) {
                    if (!isAdmin) {
                        await message.reply('❌ Apenas administradores podem usar este comando!');
                        return;
                    }
                    
                    try {
                        // Extrair a nova mensagem
                        const novaMensagem = message.body.substring('.setboasvindas '.length).trim();
                        
                        if (novaMensagem.length === 0) {
                            await message.reply(`❌ *ERRO*\n\nUso: .setboasvindas [mensagem]\n\n📝 *Placeholder disponível:*\n@NOME - será substituído pelo nome do novo membro\n\n*Exemplo:*\n.setboasvindas 🎉 Bem-vindo @NOME! Nosso sistema é 100% automático!`);
                            return;
                        }
                        
                        if (novaMensagem.length > 2000) {
                            await message.reply(`❌ *MENSAGEM MUITO LONGA*\n\nMáximo: 2000 caracteres\nAtual: ${novaMensagem.length} caracteres`);
                            return;
                        }
                        
                        // Salvar no arquivo (simulação - na prática você salvaria em BD)
                        console.log(`🔧 ADMIN ${remetente} definiu nova mensagem de boas-vindas para grupo ${message.from}`);
                        
                        const resposta = `✅ *MENSAGEM DE BOAS-VINDAS ATUALIZADA*\n\n` +
                                        `👤 *Admin:* ${message._data.notifyName || 'Admin'}\n` +
                                        `📱 *Grupo:* ${message.from}\n` +
                                        `📝 *Caracteres:* ${novaMensagem.length}/2000\n\n` +
                                        `📋 *Prévia da mensagem:*\n` +
                                        `${novaMensagem.substring(0, 200)}${novaMensagem.length > 200 ? '...' : ''}\n\n` +
                                        `✅ A nova mensagem será usada para próximos membros!\n` +
                                        `💡 Use .testboasvindas para testar`;
                        
                        await message.reply(resposta);
                        
                    } catch (error) {
                        console.error('❌ Erro no comando .setboasvindas:', error);
                        await message.reply(`❌ *ERRO*\n\nNão foi possível atualizar a mensagem\n\n📝 Erro: ${error.message}`);
                    }
                    return;
                }
                
                // .getboasvindas - Ver mensagem atual de boas-vindas (ADMIN APENAS)
                if (comando === '.getboasvindas') {
                    if (!isAdmin) {
                        await message.reply('❌ Apenas administradores podem usar este comando!');
                        return;
                    }
                    
                    try {
                        const configGrupo = getConfiguracaoGrupo(message.from);
                        if (!configGrupo) {
                            await message.reply('❌ Este grupo não está configurado!');
                            return;
                        }
                        
                        const mensagemAtual = configGrupo.boasVindas || 'Mensagem padrão (não personalizada)';
                        
                        const resposta = `📋 *MENSAGEM DE BOAS-VINDAS ATUAL*\n\n` +
                                        `📱 *Grupo:* ${configGrupo.nome}\n` +
                                        `📝 *Caracteres:* ${mensagemAtual.length}/2000\n\n` +
                                        `📋 *Mensagem:*\n${mensagemAtual}\n\n` +
                                        `💡 Use .setboasvindas para alterar\n` +
                                        `🧪 Use .testboasvindas para testar`;
                        
                        await message.reply(resposta);
                        
                    } catch (error) {
                        console.error('❌ Erro no comando .getboasvindas:', error);
                        await message.reply(`❌ *ERRO*\n\nNão foi possível obter a mensagem\n\n📝 Erro: ${error.message}`);
                    }
                    return;
                }
                
                // .testboasvindas - Testar mensagem de boas-vindas (ADMIN APENAS)  
                if (comando === '.testboasvindas') {
                    if (!isAdmin) {
                        await message.reply('❌ Apenas administradores podem usar este comando!');
                        return;
                    }
                    
                    try {
                        await message.reply('🧪 *TESTE DE BOAS-VINDAS*\n\nEnviando mensagem de teste...');
                        
                        // Enviar boas-vindas para o próprio admin como teste
                        setTimeout(async () => {
                            await enviarBoasVindas(message.from, autorMensagem);
                        }, 1000);
                        
                    } catch (error) {
                        console.error('❌ Erro no comando .testboasvindas:', error);
                        await message.reply(`❌ *ERRO*\n\nNão foi possível testar a mensagem\n\n📝 Erro: ${error.message}`);
                    }
                    return;
                }
                
                // .bonus NUMERO QUANTIDADE - Dar bônus manual (ADMIN APENAS)
                if (comando.startsWith('.bonus ')) {
                    try {
                        console.log(`🔍 Debug .bonus: autorMensagem = ${autorMensagem}`);
                        // Verificar permissão de admin
                        const admins = ['258861645968', '258123456789', '258852118624']; // Lista de admins
                        const numeroAdmin = autorMensagem.replace('@c.us', '');
                        if (!admins.includes(numeroAdmin)) {
                            console.log(`❌ Admin não autorizado: ${autorMensagem} (${numeroAdmin})`);
                            return; // Falha silenciosa para segurança
                        }

                        const parametros = comando.split(' ');
                        if (parametros.length < 3) {
                            await message.reply(`❌ *FORMATO INCORRETO*\n\n✅ Use: *.bonus @usuario QUANTIDADE* ou *.bonus NUMERO QUANTIDADE*\nExemplos:\n• *.bonus @258123456789 500MB*\n• *.bonus 258123456789 500MB*`);
                            return;
                        }

                        let numeroDestino = parametros[1];
                        const quantidadeStr = parametros[2].toUpperCase();

                        // Verificar se é menção ou número direto
                        if (numeroDestino.startsWith('@')) {
                            // Remover @ e verificar se tem menções na mensagem
                            const numeroMencao = numeroDestino.substring(1);
                            if (message.mentionedIds && message.mentionedIds.length > 0) {
                                // Usar a primeira menção encontrada
                                const mencaoId = message.mentionedIds[0];
                                numeroDestino = mencaoId.replace('@c.us', '');
                            } else {
                                // Tentar usar o número após @
                                numeroDestino = numeroMencao;
                            }
                        }

                        // Validar número - aceitar 9 dígitos (848715208) ou 12 dígitos (258848715208)
                        if (!/^\d{9}$/.test(numeroDestino) && !/^\d{12}$/.test(numeroDestino)) {
                            await message.reply(`❌ *NÚMERO INVÁLIDO*\n\n✅ Use formato:\n• *.bonus @848715208 500MB* (9 dígitos)\n• *.bonus @258848715208 500MB* (12 dígitos)\n• *.bonus 848715208 500MB* (número direto)`);
                            return;
                        }
                        
                        // Converter para formato completo se necessário (adicionar 258 no início)
                        if (numeroDestino.length === 9) {
                            numeroDestino = '258' + numeroDestino;
                        }

                        // Converter quantidade para MB
                        let quantidadeMB;
                        if (quantidadeStr.endsWith('GB')) {
                            const gb = parseFloat(quantidadeStr.replace('GB', ''));
                            if (isNaN(gb) || gb <= 0) {
                                await message.reply(`❌ Quantidade inválida: *${quantidadeStr}*`);
                                return;
                            }
                            quantidadeMB = Math.round(gb * 1024);
                        } else if (quantidadeStr.endsWith('MB')) {
                            quantidadeMB = parseInt(quantidadeStr.replace('MB', ''));
                            if (isNaN(quantidadeMB) || quantidadeMB <= 0) {
                                await message.reply(`❌ Quantidade inválida: *${quantidadeStr}*`);
                                return;
                            }
                        } else {
                            await message.reply(`❌ *FORMATO INVÁLIDO*\n\n✅ Use: MB ou GB\nExemplos: 500MB, 1.5GB, 2GB`);
                            return;
                        }

                        const participantId = numeroDestino + '@c.us';
                        
                        // Inicializar saldo se não existir
                        if (!bonusSaldos[participantId]) {
                            bonusSaldos[participantId] = {
                                saldo: 0,
                                detalhesReferencias: {},
                                historicoSaques: [],
                                totalReferencias: 0,
                                bonusAdmin: []
                            };
                        }

                        // Adicionar bônus
                        bonusSaldos[participantId].saldo += quantidadeMB;
                        
                        // Registrar histórico de bônus admin
                        if (!bonusSaldos[participantId].bonusAdmin) {
                            bonusSaldos[participantId].bonusAdmin = [];
                        }
                        
                        bonusSaldos[participantId].bonusAdmin.push({
                            quantidade: quantidadeMB,
                            data: new Date().toISOString(),
                            admin: autorMensagem,
                            motivo: 'Bônus administrativo'
                        });

                        agendarSalvamento();

                        const quantidadeFormatada = quantidadeMB >= 1024 ? `${(quantidadeMB/1024).toFixed(2)}GB` : `${quantidadeMB}MB`;
                        const novoSaldo = bonusSaldos[participantId].saldo;
                        const novoSaldoFormatado = novoSaldo >= 1024 ? `${(novoSaldo/1024).toFixed(2)}GB` : `${novoSaldo}MB`;

                        console.log(`🎁 ADMIN BONUS: ${autorMensagem} deu ${quantidadeFormatada} para ${numeroDestino}`);

                        // Notificar o usuário que recebeu o bônus
                        try {
                            await client.sendMessage(message.from, 
                                `🎁 *BÔNUS ADMINISTRATIVO!*\n\n` +
                                `💎 @${numeroDestino}, recebeste *${quantidadeFormatada}* de bônus!\n\n` +
                                `👨‍💼 *Ofertado por:* Administrador\n` +
                                `💰 *Novo saldo:* ${novoSaldoFormatado}\n\n` +
                                `${novoSaldo >= 1024 ? '🚀 *Já podes sacar!* Use: *.sacar*' : '💡 *Continua a acumular para sacar!*'}`, {
                                mentions: [participantId]
                            });
                        } catch (notificationError) {
                            console.error('❌ Erro ao enviar notificação de bônus admin:', notificationError);
                        }

                        await message.reply(
                            `✅ *BÔNUS ADMINISTRATIVO CONCEDIDO*\n\n` +
                            `👤 Beneficiário: ${numeroDestino}\n` +
                            `🎁 Bônus concedido: ${quantidadeFormatada}\n` +
                            `💰 Novo saldo: ${novoSaldoFormatado}\n` +
                            `👑 Concedido por: Administrador\n` +
                            `📅 Data: ${new Date().toLocaleString('pt-BR')}\n\n` +
                            `💡 *O usuário foi notificado automaticamente*`
                        );
                        
                        return;
                    } catch (error) {
                        console.error('❌ Erro no comando .bonus:', error);
                        await message.reply(`❌ *ERRO INTERNO*\n\n⚠️ Não foi possível conceder bônus\n\n📝 Erro: ${error.message}`);
                        return;
                    }
                }
            }

            // === COMANDOS GOOGLE SHEETS ===
            if (comando === '.test_sheets') {
                console.log(`🧪 Testando Google Sheets...`);
                
                const resultado = await enviarParaGoogleSheets('TEST123', '99', '842223344', 'test_group', 'Teste Admin', 'TestUser');
                
                if (resultado.sucesso) {
                    await message.reply(`✅ *Google Sheets funcionando!*\n\n📊 URL: ${GOOGLE_SHEETS_CONFIG.scriptUrl}\n📝 Row: ${resultado.row}\n🎉 Dados enviados com sucesso!`);
                } else {
                    await message.reply(`❌ *Google Sheets com problema!*\n\n📊 URL: ${GOOGLE_SHEETS_CONFIG.scriptUrl}\n⚠️ Erro: ${resultado.erro}\n\n🔧 *Verifique:*\n• Script publicado corretamente\n• Permissões do Google Sheets\n• Internet funcionando`);
                }
                return;
            }

            if (comando === '.test_vision') {
                const visionStatus = ia.googleVisionEnabled;
                let resposta = `🔍 *TESTE GOOGLE VISION*\n⚠ NB: Válido apenas para Vodacom━━━━━━━━\n\n`;
                
                if (visionStatus) {
                    resposta += `✅ **Google Vision: ATIVO**\n`;
                    resposta += `🔧 **Configuração:**\n`;
                    resposta += `   • Timeout: ${ia.googleVisionTimeout}ms\n`;
                    resposta += `   • Fallback: GPT-4 Vision\n\n`;
                    resposta += `📝 **Para testar:**\n`;
                    resposta += `1. Envie uma imagem de comprovante\n`;
                    resposta += `2. Verifique nos logs qual método foi usado\n`;
                    resposta += `3. Google Vision será tentado primeiro\n`;
                    resposta += `4. GPT-4 Vision como fallback\n\n`;
                    resposta += `📊 **Vantagens do método híbrido:**\n`;
                    resposta += `   ✅ Maior precisão OCR\n`;
                    resposta += `   ✅ Menor custo\n`;
                    resposta += `   ✅ Mais rápido\n`;
                    resposta += `   ✅ Sistema redundante`;
                } else {
                    resposta += `❌ **Google Vision: DESABILITADO**\n\n`;
                    resposta += `🔧 **Para ativar:**\n`;
                    resposta += `1. Configure GOOGLE_APPLICATION_CREDENTIALS no .env\n`;
                    resposta += `2. Ou configure GOOGLE_VISION_API_KEY\n`;
                    resposta += `3. Defina GOOGLE_VISION_ENABLED=true\n\n`;
                    resposta += `🧠 **Atualmente usando:**\n`;
                    resposta += `   • GPT-4 Vision apenas\n`;
                    resposta += `   • Funciona normalmente\n`;
                    resposta += `   • Sem redundância`;
                }
                
                await message.reply(resposta);
                return;
            }

            // === COMANDO PARA ADICIONAR COMANDOS CUSTOMIZADOS ===
            if (message.body.startsWith('.addcomando ')) {
                const comandoParsado = parsearComandoCustomizado(message.body);
                
                if (!comandoParsado) {
                    await message.reply(`❌ *Sintaxe incorreta!*\n\n✅ *Sintaxe correta:*\n\`.addcomando NomeComando(Sua resposta aqui)\`\n\n📝 *Exemplo:*\n\`.addcomando horario(Funcionamos de 8h às 18h)\`\n\n⚠️ *Importante:*\n• Nome sem espaços\n• Resposta entre parênteses\n• Pode usar quebras de linha`);
                    return;
                }
                
                try {
                    await adicionarComandoCustomizado(
                        message.from,
                        comandoParsado.nome,
                        comandoParsado.resposta,
                        message.author || message.from
                    );
                    
                    await message.reply(`✅ *Comando criado com sucesso!*\n\n🔧 **Comando:** \`${comandoParsado.nome}\`\n📝 **Resposta:** ${comandoParsado.resposta.substring(0, 100)}${comandoParsado.resposta.length > 100 ? '...' : ''}\n\n💡 **Para usar:** Digite apenas \`${comandoParsado.nome}\``);
                    console.log(`✅ Admin ${message.author || message.from} criou comando '${comandoParsado.nome}' no grupo ${message.from}`);
                } catch (error) {
                    await message.reply(`❌ **Erro ao criar comando**\n\nTente novamente ou contacte o desenvolvedor.`);
                    console.error('❌ Erro ao adicionar comando customizado:', error);
                }
                return;
            }

            // === COMANDO PARA LISTAR COMANDOS CUSTOMIZADOS ===
            if (comando === '.comandos') {
                const grupoId = message.from;
                const comandosGrupo = comandosCustomizados[grupoId];
                
                if (!comandosGrupo || Object.keys(comandosGrupo).length === 0) {
                    await message.reply('📋 *Nenhum comando customizado criado ainda*\n\n💡 **Para criar:** `.addcomando nome(resposta)`');
                    return;
                }
                
                let listaComandos = '📋 *COMANDOS CUSTOMIZADOS*\n⚠ NB: Válido apenas para Vodacom━━━━━━━━\n\n';
                
                Object.keys(comandosGrupo).forEach(nome => {
                    const cmd = comandosGrupo[nome];
                    const preview = cmd.resposta.length > 50 ? 
                        cmd.resposta.substring(0, 50) + '...' : 
                        cmd.resposta;
                    
                    listaComandos += `🔧 **${nome}**\n📝 ${preview}\n\n`;
                });
                
                listaComandos += `📊 **Total:** ${Object.keys(comandosGrupo).length} comando(s)`;
                
                await message.reply(listaComandos);
                return;
            }

            // === COMANDO PARA REMOVER COMANDOS CUSTOMIZADOS ===
            if (message.body.startsWith('.delcomando ')) {
                const nomeComando = message.body.replace('.delcomando ', '').trim().toLowerCase();
                
                if (!nomeComando) {
                    await message.reply(`❌ *Nome do comando é obrigatório!*\n\n✅ *Sintaxe:* \`.delcomando nomecomando\`\n\n📝 *Para ver comandos:* \`.comandos\``);
                    return;
                }
                
                try {
                    const removido = await removerComandoCustomizado(message.from, nomeComando);
                    
                    if (removido) {
                        await message.reply(`✅ *Comando removido!*\n\n🗑️ **Comando:** \`${nomeComando}\`\n\n📝 **Para ver restantes:** \`.comandos\``);
                        console.log(`✅ Admin ${message.author || message.from} removeu comando '${nomeComando}' do grupo ${message.from}`);
                    } else {
                        await message.reply(`❌ *Comando não encontrado!*\n\n🔍 **Comando:** \`${nomeComando}\`\n📝 **Ver comandos:** \`.comandos\``);
                    }
                } catch (error) {
                    await message.reply(`❌ **Erro ao remover comando**\n\nTente novamente ou contacte o desenvolvedor.`);
                    console.error('❌ Erro ao remover comando customizado:', error);
                }
                return;
            }

            if (comando === '.test_grupo') {
                const grupoAtual = message.from;
                const configGrupo = getConfiguracaoGrupo(grupoAtual);
                
                if (!configGrupo) {
                    await message.reply('❌ Este grupo não está configurado!');
                    return;
                }
                
                console.log(`🧪 Testando Google Sheets para grupo: ${configGrupo.nome}`);
                
                const resultado = await enviarParaGoogleSheets('TEST999', '88', '847777777', grupoAtual, configGrupo.nome, 'TestAdmin');
                
                if (resultado.sucesso) {
                    await message.reply(`✅ *Teste enviado para ${configGrupo.nome}!*\n\n📊 Row: ${resultado.row}\n🔍 O celular deste grupo deve processar em até 30 segundos.\n\n📱 *Grupo ID:* \`${grupoAtual}\``);
                } else {
                    await message.reply(`❌ *Erro no teste:* ${resultado.erro}`);
                }
                return;
            }

            if (comando === '.grupos_status') {
                let resposta = `📊 *STATUS DOS GRUPOS*\n⚠ NB: Válido apenas para Vodacom━━━━━━━━\n\n`;
                
                for (const [grupoId, config] of Object.entries(CONFIGURACAO_GRUPOS)) {
                    const dadosGrupo = dadosParaTasker.filter(d => d.grupo_id === grupoId);
                    const hoje = dadosGrupo.filter(d => {
                        const dataItem = new Date(d.timestamp).toDateString();
                        return dataItem === new Date().toDateString();
                    });
                    
                    resposta += `🏢 *${config.nome}*\n`;
                    resposta += `   📈 Total: ${dadosGrupo.length}\n`;
                    resposta += `   📅 Hoje: ${hoje.length}\n`;
                    resposta += `   📊 Sheets: ${dadosGrupo.filter(d => d.metodo === 'google_sheets').length}\n`;
                    resposta += `   📱 Backup: ${dadosGrupo.filter(d => d.metodo === 'whatsapp_backup').length}\n`;
                    resposta += `   🆔 ID: \`${grupoId}\`\n\n`;
                }
                
                await message.reply(resposta);
                return;
            }

            if (comando === '.sheets') {
                const dados = obterDadosTasker();
                const hoje = obterDadosTaskerHoje();
                const sheets = dados.filter(d => d.metodo === 'google_sheets').length;
                const whatsapp = dados.filter(d => d.metodo === 'whatsapp_backup').length;
                
                let resposta = `📊 *GOOGLE SHEETS STATUS*\n⚠ NB: Válido apenas para Vodacom━━━━━━━━\n\n`;
                resposta += `📈 Total enviado: ${dados.length}\n`;
                resposta += `📅 Hoje: ${hoje.length}\n`;
                resposta += `📊 Via Google Sheets: ${sheets}\n`;
                resposta += `📱 Via WhatsApp: ${whatsapp}\n`;
                resposta += `📱 Fila atual: ${filaMensagens.length}\n\n`;
                
                if (dados.length > 0) {
                    resposta += `📋 *Últimos 5 enviados:*\n`;
                    dados.slice(-5).forEach((item, index) => {
                        const metodo = item.metodo === 'google_sheets' ? '📊' : '📱';
                        resposta += `${index + 1}. ${metodo} ${item.dados} (${item.grupo})\n`;
                    });
                }
                
                await message.reply(resposta);
                return;
            }

            if (comando.startsWith('.clear_grupo ')) {
                const nomeGrupo = comando.replace('.clear_grupo ', '');
                const antes = dadosParaTasker.length;
                
                dadosParaTasker = dadosParaTasker.filter(d => !d.grupo.toLowerCase().includes(nomeGrupo.toLowerCase()));
                
                const removidos = antes - dadosParaTasker.length;
                await message.reply(`🗑️ *${removidos} registros do grupo "${nomeGrupo}" removidos!*`);
                return;
            }

            if (comando === '.clear_sheets') {
                dadosParaTasker = [];
                await message.reply('🗑️ *Dados do Google Sheets limpos!*');
                return;
            }

            // === COMANDOS TASKER - SISTEMA DE PACOTES ===
            
            // DEBUG: Verificar status do sistema de pacotes
            if (comando === '.debug_pacotes') {
                let resposta = `🔧 *DEBUG SISTEMA PACOTES*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                resposta += `🔌 SISTEMA_PACOTES_ENABLED: ${process.env.SISTEMA_PACOTES_ENABLED}\n`;
                resposta += `📦 sistemaPacotes: ${sistemaPacotes ? 'INICIALIZADO' : 'NULL'}\n`;
                resposta += `👤 isAdminQualquer: ${isAdminQualquer}\n`;
                resposta += `📝 Comando original: "${message.body}"\n`;
                resposta += `🆔 Grupo ID: ${message.from}\n`;
                
                if (sistemaPacotes) {
                    resposta += `\n✅ Sistema de Pacotes está ATIVO e funcionando!`;
                } else {
                    resposta += `\n❌ Sistema de Pacotes está DESABILITADO ou falhou ao inicializar!`;
                }
                
                await message.reply(resposta);
                return;
            }
            
            if (comando === '.pacotes_tasker') {
                const dadosPacotes = obterDadosPacotesTasker();
                
                if (dadosPacotes.length === 0) {
                    await message.reply(`📦 *DADOS TASKER - PACOTES*\n\n❌ Nenhum cliente com pacote ativo para o Tasker.`);
                    return;
                }
                
                let resposta = `📦 *DADOS TASKER - PACOTES* (${dadosPacotes.length})\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                dadosPacotes.forEach((cliente, index) => {
                    const proximaRenovacao = new Date(cliente.proximaRenovacao);
                    resposta += `${index + 1}. **${cliente.numero}**\n`;
                    resposta += `   📋 Ref: ${cliente.referenciaOriginal}\n`;
                    resposta += `   📦 Tipo: ${cliente.tipoPacote}\n`;
                    resposta += `   📅 Dias restantes: ${cliente.diasRestantes}\n`;
                    resposta += `   ⏰ Próxima: ${proximaRenovacao.toLocaleString('pt-BR')}\n\n`;
                });
                
                resposta += `💡 *O Tasker pode acessar estes dados via função do bot para processar renovações automaticamente.*`;
                
                await message.reply(resposta);
                return;
            }
            
            if (comando === '.renovacoes_tasker') {
                const renovacoesPendentes = obterRenovacoesPendentesTasker();
                
                if (renovacoesPendentes.length === 0) {
                    await message.reply(`🔄 *RENOVAÇÕES TASKER*\n\n✅ Nenhuma renovação pendente nas próximas 6 horas.`);
                    return;
                }
                
                let resposta = `🔄 *RENOVAÇÕES TASKER* (${renovacoesPendentes.length})\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                renovacoesPendentes.forEach((cliente, index) => {
                    const proximaRenovacao = new Date(cliente.proximaRenovacao);
                    
                    resposta += `${index + 1}. **${cliente.numero}**\n`;
                    resposta += `   📋 Ref: ${cliente.referenciaOriginal}\n`;
                    resposta += `   📦 Tipo: ${cliente.tipoPacote}\n`;
                    resposta += `   📅 Dias restantes: ${cliente.diasRestantes}\n`;
                    resposta += `   ⏰ Próxima renovação: ${proximaRenovacao.toLocaleString('pt-BR')}\n\n`;
                });
                
                resposta += `💡 *Horários já calculados com 2h de antecipação em relação ao dia anterior.*`;
                
                await message.reply(resposta);
                return;
            }

            // === COMANDOS DO SISTEMA DE COMPRAS ===
            
            if (comando === '.compras_stats') {
                if (!sistemaCompras) {
                    await message.reply('❌ Sistema de compras não está ativo!');
                    return;
                }
                
                const estatisticas = await sistemaCompras.obterEstatisticas();
                
                let resposta = `🛒 *ESTATÍSTICAS DE COMPRAS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                resposta += `📊 Total de compradores: ${estatisticas.totalCompradores}\n`;
                resposta += `📅 Compradores hoje: ${estatisticas.compradoresHoje}\n`;
                resposta += `⏳ Compras pendentes: ${estatisticas.comprasPendentes}\n`;
                resposta += `💾 Total de megas hoje: ${estatisticas.totalMegasHoje >= 1024 ? (estatisticas.totalMegasHoje/1024).toFixed(1) + ' GB' : estatisticas.totalMegasHoje + ' MB'}\n\n`;
                
                if (estatisticas.ranking.length > 0) {
                    resposta += `🏆 *TOP 5 RANKING HOJE:*\n`;
                    estatisticas.ranking.slice(0, 5).forEach((cliente, index) => {
                        const megasFormatados = cliente.megasHoje >= 1024 ? `${(cliente.megasHoje/1024).toFixed(1)} GB` : `${cliente.megasHoje} MB`;
                        resposta += `${index + 1}º ${cliente.numero} - ${megasFormatados} (${cliente.comprasHoje}x)\n`;
                    });
                }
                
                await message.reply(resposta);
                return;
            }
            
            if (comando === '.ranking') {
                if (!sistemaCompras) {
                    await message.reply('❌ Sistema de compras não está ativo!');
                    return;
                }
                
                const estatisticas = await sistemaCompras.obterEstatisticas();
                
                if (estatisticas.ranking.length === 0) {
                    await message.reply('🏆 *RANKING DIÁRIO*\n\n❌ Nenhuma compra registrada hoje.');
                    return;
                }
                
                let resposta = `🏆 *RANKING DIÁRIO DE COMPRAS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
                estatisticas.ranking.forEach((cliente, index) => {
                    const megasFormatados = cliente.megasHoje >= 1024 ? `${(cliente.megasHoje/1024).toFixed(1)} GB` : `${cliente.megasHoje} MB`;
                    const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '🏅';
                    resposta += `${emoji} **${index + 1}º lugar**\n`;
                    resposta += `   📱 ${cliente.numero}\n`;
                    resposta += `   📊 ${megasFormatados} (${cliente.comprasHoje} compras)\n\n`;
                });
                
                resposta += `📅 *Ranking atualizado automaticamente a cada compra confirmada!*`;
                
                await message.reply(resposta);
                return;
            }
            
            if (comando.startsWith('.comprador ')) {
                if (!sistemaCompras) {
                    await message.reply('❌ Sistema de compras não está ativo!');
                    return;
                }
                
                const numero = comando.replace('.comprador ', '').trim();
                
                if (!/^\d{9}$/.test(numero)) {
                    await message.reply('❌ Use: *.comprador 849123456*');
                    return;
                }
                
                const cliente = sistemaCompras.historicoCompradores[numero];
                
                if (!cliente) {
                    await message.reply(`❌ Cliente *${numero}* não encontrado no sistema de compras.`);
                    return;
                }
                
                const posicao = await sistemaCompras.obterPosicaoCliente(numero);
                const megasHojeFormatados = cliente.megasHoje >= 1024 ? `${(cliente.megasHoje/1024).toFixed(1)} GB` : `${cliente.megasHoje} MB`;
                const megasTotalFormatados = cliente.megasTotal >= 1024 ? `${(cliente.megasTotal/1024).toFixed(1)} GB` : `${cliente.megasTotal} MB`;
                
                let resposta = `👤 *PERFIL DO COMPRADOR*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                resposta += `📱 **Número:** ${numero}\n`;
                resposta += `🏆 **Posição hoje:** ${posicao.posicao}º lugar\n`;
                resposta += `📊 **Hoje:** ${megasHojeFormatados} (${cliente.comprasHoje} compras)\n`;
                resposta += `💎 **Total geral:** ${megasTotalFormatados} (${cliente.totalCompras} compras)\n`;
                resposta += `📅 **Primeira compra:** ${new Date(cliente.primeiraCompra).toLocaleDateString('pt-BR')}\n`;
                resposta += `⏰ **Última compra:** ${new Date(cliente.ultimaCompra).toLocaleDateString('pt-BR')}\n`;
                
                await message.reply(resposta);
                return;
            }

            // === NOVOS COMANDOS PARA DETECÇÃO DE GRUPOS ===
            if (comando === '.grupos') {
                try {
                    let resposta = `📋 *GRUPOS DETECTADOS*\n⚠ NB: Válido apenas para Vodacom━━━━━━━━\n\n`;
                    
                    const chats = await client.getChats();
                    const grupos = chats.filter(chat => chat.isGroup);
                    
                    resposta += `📊 Total de grupos: ${grupos.length}\n\n`;
                    
                    for (const grupo of grupos) {
                        const isMonitorado = CONFIGURACAO_GRUPOS.hasOwnProperty(grupo.id._serialized);
                        const status = isMonitorado ? '✅' : '❌';
                        
                        resposta += `${status} *${grupo.name}*\n`;
                        resposta += `   🆔 \`${grupo.id._serialized}\`\n`;
                        resposta += `   👥 ${grupo.participants.length} membros\n\n`;
                    }
                    
                    resposta += `\n🔧 *Para adicionar grupo:*\nCopie ID e adicione em CONFIGURACAO_GRUPOS`;
                    
                    await message.reply(resposta);
                    
                    console.log(`\n📋 COMANDO .grupos executado - ${grupos.length} grupos encontrados`);
                    grupos.forEach(grupo => {
                        const isMonitorado = CONFIGURACAO_GRUPOS.hasOwnProperty(grupo.id._serialized);
                        console.log(`${isMonitorado ? '✅' : '❌'} ${grupo.name}: ${grupo.id._serialized}`);
                    });
                    
                } catch (error) {
                    console.error('❌ Erro ao listar grupos:', error);
                    await message.reply('❌ Erro ao obter lista de grupos');
                }
                return;
            }

            if (comando === '.grupo_atual') {
                if (!message.from.endsWith('@g.us')) {
                    await message.reply('❌ Use este comando em um grupo!');
                    return;
                }
                
                await logGrupoInfo(message.from, 'COMANDO .grupo_atual');
                
                const configGrupo = getConfiguracaoGrupo(message.from);
                const status = configGrupo ? '✅ CONFIGURADO' : '❌ NÃO CONFIGURADO';
                
                await message.reply(
                    `📋 *INFORMAÇÕES DESTE GRUPO*\n\n` +
                    `🆔 ID: \`${message.from}\`\n` +
                    `📊 Status: ${status}\n\n` +
                    `${configGrupo ? `🏢 Nome: ${configGrupo.nome}` : '🔧 Precisa ser configurado'}\n\n` +
                    `📝 Verifique o console para detalhes completos`
                );
                return;
            }
        }

        // === COMANDOS DE REFERÊNCIA E BÔNUS (TODOS USUÁRIOS) ===
        if (message.type === 'chat' && message.body.startsWith('.')) {
            const comando = message.body.toLowerCase().trim();
            const remetente = message.author || message.from;

            // .meucodigo - Gerar/ver código de referência
            if (comando === '.meucodigo') {
                let codigo = null;
                
                // Verificar se já tem código
                for (const [cod, dados] of Object.entries(codigosReferencia)) {
                    if (dados.dono === remetente) {
                        codigo = cod;
                        break;
                    }
                }
                
                // Se não tem, criar novo
                if (!codigo) {
                    codigo = gerarCodigoReferencia(remetente);
                    codigosReferencia[codigo] = {
                        dono: remetente,
                        nome: message._data.notifyName || 'N/A',
                        criado: new Date().toISOString(),
                        ativo: true
                    };
                    agendarSalvamento();
                }
                
                await message.reply(
                    `🎁 *SEU CÓDIGO DE REFERÊNCIA*\n\n` +
                    `📋 Código: *${codigo}*\n\n` +
                    `🚀 *Como usar:*\n` +
                    `• Compartilhe este código com amigos\n` +
                    `• Quando eles fizerem primeira compra, você ganha 200MB\n` +
                    `• A cada 5 compras deles, acumula 1GB\n` +
                    `• Acumule 1GB+ para sacar bônus\n\n` +
                    `💡 *Dica:* Diga aos amigos para usar *.convite ${codigo}* quando entrarem no grupo!`
                );
                return;
            }

            // .convite CODIGO - Registrar referência
            if (comando.startsWith('.convite ')) {
                const codigo = comando.split(' ')[1]?.toUpperCase();
                
                if (!codigo) {
                    await message.reply('❌ Use: *.convite CODIGO*\nExemplo: *.convite AB12CD*');
                    return;
                }
                
                // Verificar se código existe
                if (!codigosReferencia[codigo]) {
                    await message.reply(`❌ Código *${codigo}* não encontrado!\n\n💡 Peça para quem te convidou verificar o código com *.meucodigo*`);
                    return;
                }
                
                // Verificar se já tem referência
                if (referenciasClientes[remetente]) {
                    await message.reply(`⚠️ Você já foi convidado por alguém!\n\nNão é possível usar outro código de referência.`);
                    return;
                }
                
                // Verificar se não está tentando usar próprio código
                if (codigosReferencia[codigo].dono === remetente) {
                    await message.reply('❌ Não podes usar teu próprio código de referência! 😅');
                    return;
                }

                // NOVA VALIDAÇÃO: Verificar se é elegível (entrou nos últimos 5 dias)
                if (!isElegivelParaCodigo(remetente, message.from)) {
                    await message.reply(
                        `⏳ *CÓDIGO EXPIRADO PARA SEU PERFIL*\n\n` +
                        `❌ Códigos de referência só funcionam para membros que entraram no grupo nos últimos 5 dias.\n\n` +
                        `🤔 *Por que isso acontece?*\n` +
                        `• Sistema anti-abuse\n` +
                        `• Incentiva convites genuínos\n` +
                        `• Protege economia do grupo\n\n` +
                        `💡 *Solução:* Você ainda pode gerar seu próprio código com *.meucodigo* e convidar outros!`
                    );
                    return;
                }
                
                // Registrar referência
                referenciasClientes[remetente] = {
                    convidadoPor: codigosReferencia[codigo].dono,
                    codigo: codigo,
                    dataRegistro: new Date().toISOString(),
                    comprasRealizadas: 0
                };
                
                agendarSalvamento();
                
                const convidadorId = codigosReferencia[codigo].dono;
                const nomeConvidador = codigosReferencia[codigo].nome;
                
                await client.sendMessage(message.from, 
                    `✅ *CÓDIGO APLICADO COM SUCESSO!*\n\n` +
                    `🎉 @${convidadorId.replace('@c.us', '')} te convidou - registrado!\n\n` +
                    `💎 *Benefícios:*\n` +
                    `• Nas tuas próximas 5 compras, @${convidadorId.replace('@c.us', '')} ganha 200MB cada\n` +
                    `• Tu recebes teus megas normalmente\n` +
                    `• Ajudas um amigo a ganhar bônus!\n\n` +
                    `🚀 *Próximo passo:* Faz tua primeira compra!`, {
                    mentions: [convidadorId]
                });
                return;
            }

            // .bonus - Ver saldo de bônus
            if (comando === '.bonus' || comando === '.saldo') {
                const saldo = bonusSaldos[remetente];
                
                if (!saldo || saldo.saldo === 0) {
                    await message.reply(
                        `💰 *TEU SALDO DE BÔNUS*\n\n` +
                        `🎁 Total acumulado: *0MB*\n` +
                        `📊 Referências ativas: *0 pessoas*\n\n` +
                        `🚀 *Como ganhar bônus:*\n` +
                        `1. Gera teu código com *.meucodigo*\n` +
                        `2. Convida amigos para o grupo\n` +
                        `3. Eles usam *.convite TEUCODIGO*\n` +
                        `4. A cada compra deles, ganhas 200MB\n` +
                        `5. Com 1GB+ podes sacar com *.sacar*`
                    );
                    return;
                }
                
                const saldoGB = (saldo.saldo / 1024).toFixed(2);
                const podeSacar = saldo.saldo >= 1024;
                const referenciasAtivas = Object.keys(saldo.detalhesReferencias || {}).length;
                
                let detalhes = '';
                if (saldo.detalhesReferencias) {
                    Object.entries(saldo.detalhesReferencias).forEach(([cliente, dados]) => {
                        const nome = dados.nome || 'Cliente';
                        detalhes += `• ${nome}: ${dados.compras}/5 compras (${dados.bonusGanho}MB ganhos)\n`;
                    });
                }
                
                await message.reply(
                    `💰 *TEU SALDO DE BÔNUS*\n\n` +
                    `🎁 Total acumulado: *${saldo.saldo}MB* (${saldoGB}GB)\n` +
                    `📊 Referências ativas: *${referenciasAtivas} pessoas*\n` +
                    `💡 Mínimo para saque: 1GB (1024MB)\n\n` +
                    `${detalhes ? `👥 *Detalhes das referências:*\n${detalhes}\n` : ''}` +
                    `${podeSacar ? '🚀 *Pronto para sacar!*\nUse: *.sacar 1GB 845123456*' : '⏳ Incentiva teus convidados a comprar!'}`
                );
                return;
            }

            // .sacar QUANTIDADE NUMERO - Solicitar saque
            if (comando.startsWith('.sacar ')) {
                const partes = comando.split(' ');
                if (partes.length < 3) {
                    await message.reply(
                        `❌ *FORMATO INCORRETO*\n\n` +
                        `✅ Use: *.sacar QUANTIDADE NUMERO*\n\n` +
                        `📋 *Exemplos:*\n` +
                        `• *.sacar 1GB 845123456*\n` +
                        `• *.sacar 2048MB 847654321*\n` +
                        `• *.sacar 1.5GB 843210987*`
                    );
                    return;
                }
                
                const quantidadeStr = partes[1].toUpperCase();
                const numeroDestino = partes[2];
                
                // Validar número
                if (!/^8[0-9]{8}$/.test(numeroDestino)) {
                    await message.reply(`❌ Número inválido: *${numeroDestino}*\n\n✅ Use formato: 8XXXXXXXX`);
                    return;
                }
                
                // Converter quantidade para MB
                let quantidadeMB = 0;
                if (quantidadeStr.endsWith('GB')) {
                    const gb = parseFloat(quantidadeStr.replace('GB', ''));
                    quantidadeMB = gb * 1024;
                } else if (quantidadeStr.endsWith('MB')) {
                    quantidadeMB = parseInt(quantidadeStr.replace('MB', ''));
                } else {
                    await message.reply(`❌ Formato inválido: *${quantidadeStr}*\n\n✅ Use: 1GB, 1.5GB, 1024MB, etc.`);
                    return;
                }
                
                // Verificar saldo
                const saldo = bonusSaldos[remetente];
                if (!saldo || saldo.saldo < quantidadeMB) {
                    const saldoAtual = saldo ? saldo.saldo : 0;
                    await message.reply(
                        `❌ *SALDO INSUFICIENTE*\n\n` +
                        `💰 Teu saldo: ${saldoAtual}MB\n` +
                        `🎯 Solicitado: ${quantidadeMB}MB\n\n` +
                        `💡 Precisas de mais ${quantidadeMB - saldoAtual}MB\n` +
                        `🚀 Convida mais amigos para ganhar bônus!`
                    );
                    return;
                }
                
                // Verificar mínimo
                if (quantidadeMB < 1024) {
                    await message.reply(`❌ Valor mínimo para saque: *1GB (1024MB)*\n\n🎯 Solicitado: ${quantidadeMB}MB`);
                    return;
                }
                
                // Gerar referência do pedido
                const agora = new Date();
                const referenciaSaque = `SAQ${agora.getFullYear().toString().slice(-2)}${String(agora.getMonth() + 1).padStart(2, '0')}${String(agora.getDate()).padStart(2, '0')}${String(Object.keys(pedidosSaque).length + 1).padStart(3, '0')}`;
                
                // Criar pedido
                const pedido = {
                    referencia: referenciaSaque,
                    cliente: remetente,
                    nomeCliente: message._data.notifyName || 'N/A',
                    quantidade: quantidadeMB,
                    numeroDestino: numeroDestino,
                    dataSolicitacao: agora.toISOString(),
                    status: 'pendente',
                    grupo: message.from
                };
                
                // Salvar pedido
                pedidosSaque[referenciaSaque] = pedido;
                
                // Debitar do saldo
                bonusSaldos[remetente].saldo -= quantidadeMB;
                bonusSaldos[remetente].historicoSaques = bonusSaldos[remetente].historicoSaques || [];
                bonusSaldos[remetente].historicoSaques.push({
                    referencia: referenciaSaque,
                    quantidade: quantidadeMB,
                    data: agora.toISOString()
                });
                
                agendarSalvamento();
                
                // Enviar para Tasker
                try {
                    await enviarParaTasker(referenciaSaque, quantidadeMB, numeroDestino, message.from, `SAQUE_BONUS_${message._data.notifyName || 'Cliente'}`);
                } catch (error) {
                    console.error('❌ Erro ao enviar saque para Tasker:', error);
                }
                
                const quantidadeFormatada = quantidadeMB >= 1024 ? `${(quantidadeMB/1024).toFixed(2)}GB` : `${quantidadeMB}MB`;
                const novoSaldo = bonusSaldos[remetente].saldo;
                
                await message.reply(
                    `✅ *SOLICITAÇÃO DE SAQUE CRIADA*\n\n` +
                    `👤 Cliente: ${message._data.notifyName || 'N/A'}\n` +
                    `📱 Número: ${numeroDestino}\n` +
                    `💎 Quantidade: ${quantidadeFormatada}\n` +
                    `🔖 Referência: *${referenciaSaque}*\n` +
                    `⏰ Processamento: até 24h\n\n` +
                    `💰 *Novo saldo:* ${novoSaldo}MB\n\n` +
                    `✅ Pedido enviado para processamento!\n` +
                    `🎉 Obrigado por usar nosso sistema de referências!`
                );
                return;
            }
        }

        // === DETECÇÃO DE GRUPOS NÃO CONFIGURADOS ===
        if (message.from.endsWith('@g.us') && !isGrupoMonitorado(message.from) && !message.fromMe) {
            if (!gruposLogados.has(message.from)) {
                await logGrupoInfo(message.from, 'MENSAGEM RECEBIDA');
                gruposLogados.add(message.from);
                
                // Limpar cache a cada 50 grupos para evitar memory leak
                if (gruposLogados.size > 50) {
                    gruposLogados.clear();
                }
            }
        }

        // === PROCESSAMENTO DE GRUPOS ===
        if (!message.from.endsWith('@g.us') || !isGrupoMonitorado(message.from)) {
            return;
        }

        const configGrupo = getConfiguracaoGrupo(message.from);
        if (!configGrupo || message.fromMe) {
            return;
        }

        // === DETECÇÃO DE NOVOS MEMBROS (ALTERNATIVO) ===
        await detectarNovoMembro(message.from, autorMensagem, configGrupo);

        // === MODERAÇÃO ===
        if (message.type === 'chat') {
            // Verificar se é um comando administrativo antes da moderação
            const isComandoAdmin = message.body.startsWith('.') && (
                message.body.startsWith('.addcomando ') ||
                message.body.startsWith('.delcomando ') ||
                message.body.startsWith('.comandos') ||
                message.body.startsWith('.ia') ||
                message.body.startsWith('.stats') ||
                message.body.startsWith('.sheets') ||
                message.body.startsWith('.test_') ||
                message.body.startsWith('.grupos') ||
                message.body.startsWith('.clear_') ||
                message.body.startsWith('.ranking') ||
                message.body.startsWith('.inativos') ||
                message.body.startsWith('.semcompra') ||
                message.body.startsWith('.resetranking')
            );

            // Verificar se é admin executando comando
            const autorModeracaoMsg = message.author || message.from;
            const isAdminExecutando = await isAdminGrupo(message.from, autorModeracaoMsg) || isAdministrador(autorModeracaoMsg);

            // Pular moderação para comandos administrativos executados por admins
            if (!isComandoAdmin || !isAdminExecutando) {
                const analise = contemConteudoSuspeito(message.body);
                
                if (analise.suspeito) {
                    console.log(`🚨 Conteúdo suspeito detectado`);
                    await aplicarModeracao(message, "Link detectado");
                    return;
                }
            }
        }

        // === PROCESSAMENTO DE IMAGENS DESATIVADO ===
        if (message.type === 'image') {
            console.log(`📸 Imagem recebida - Processamento desativado`);

            await message.reply(
                '❌ Processamento de imagens desativado\n' +
                '📄 Solicitamos que o comprovante seja enviado em formato de texto.\n\n' +
                'ℹ️ Esta medida foi adotada para garantir que o sistema funcione de forma mais rápida, estável e com menos falhas.'
            );
            return;
        }

        if (message.type !== 'chat') {
            return;
        }

        // Comandos de tabela e pagamento
        if (/tabela/i.test(message.body)) {
            await safeReply(message, client, configGrupo.tabela);
            return;
        }

        if (/pagamento/i.test(message.body)) {
            await safeReply(message, client, configGrupo.pagamento);
            return;
        }

        // === DETECÇÃO DE PERGUNTA POR NÚMERO (NÃO-ADMIN) ===
        if (!isAdmin && detectarPerguntaPorNumero(message.body)) {
            console.log(`📱 Pergunta por número detectada de não-admin`);
            await message.reply(
                `📱 *Para solicitar número ou suporte:*\n\n` +
                `💳 *Primeiro faça o pagamento:*\n\n` +
                `${configGrupo.pagamento}\n\n` +
                `📝 *Depois envie:*\n` +
                `• Comprovante de pagamento\n` +
                `• Número que vai receber os megas\n\n` +
                `🤖 *Sistema automático 24/7!*`
            );
            return;
        }

        // === VERIFICAR COMANDOS CUSTOMIZADOS ===
        const textoMensagem = message.body.trim().toLowerCase();
        const respostaComando = executarComandoCustomizado(message.from, textoMensagem);
        
        if (respostaComando) {
            await message.reply(respostaComando);
            console.log(`🎯 Comando customizado '${textoMensagem}' executado no grupo ${message.from}`);
            return;
        }

        // === MONITORAMENTO DE CONFIRMAÇÕES DO BOT SECUNDÁRIO ===
        if (sistemaCompras && message.body.includes('✅') && message.body.includes('Transação Concluída Com Sucesso')) {
            // Extrair referência do padrão: "🔖 *Referência:* CI22H8QJSDQ"
            const regexReferencia = /🔖\s*\*?Referência:\*?\s*([A-Za-z0-9._-]+)/i;
            const matchReferencia = message.body.match(regexReferencia);
            
            // Extrair número do padrão: "📱 *Número:* 842362318"
            const regexNumero = /📱\s*\*?Número:\*?\s*(\d{9})/i;
            const matchNumero = message.body.match(regexNumero);
            
            if (matchReferencia && matchNumero) {
                const referenciaConfirmada = matchReferencia[1]; // Manter case original
                const numeroConfirmado = matchNumero[1];
                console.log(`🛒 CONFIRMAÇÃO BOT: Detectada transação concluída - Ref: ${referenciaConfirmada} | Número: ${numeroConfirmado}`);
                console.log(`🔍 CONFIRMAÇÃO BOT: Tipo detectado: ${/emola|e-mola/i.test(message.body) ? 'EMOLA' : /mpesa|m-pesa/i.test(message.body) ? 'MPESA' : 'DESCONHECIDO'}`);
                
                // Processar confirmação
                const resultadoConfirmacao = await sistemaCompras.processarConfirmacao(referenciaConfirmada, numeroConfirmado);
                
                if (resultadoConfirmacao) {
                    console.log(`✅ COMPRAS: Confirmação processada - ${resultadoConfirmacao.numero} | ${resultadoConfirmacao.megas}MB`);
                    
                    // Enviar mensagem de parabenização com menção clicável
                    if (resultadoConfirmacao.mensagem && resultadoConfirmacao.contactId) {
                        try {
                            // Obter nome do contato para substituir o placeholder
                            const contact = await client.getContactById(resultadoConfirmacao.contactId);
                            
                            // Prioridade: nome salvo > pushname (nome do perfil) > name > número
                            const nomeExibicao = contact.name || contact.pushname || contact.number;
                            const numeroLimpo = contact.id.user; // Número sem @ e sem +
                            
                            // Substituir placeholder pelo número (formato correto para menções clickáveis)
                            const mensagemFinal = resultadoConfirmacao.mensagem.replace('@NOME_PLACEHOLDER', `@${numeroLimpo}`);
                            
                            // Enviar com menção clicável
                            await client.sendMessage(message.from, mensagemFinal, { 
                                mentions: [resultadoConfirmacao.contactId] 
                            });
                        } catch (error) {
                            console.error('❌ Erro ao enviar parabenização com menção:', error);
                            // Fallback: enviar sem menção clicável
                            const mensagemFallback = resultadoConfirmacao.mensagem.replace('@NOME_PLACEHOLDER', `@${resultadoConfirmacao.numeroComprador}`);
                            await message.reply(mensagemFallback);
                        }
                    }
                } else {
                    console.log(`⚠️ COMPRAS: Confirmação ${referenciaConfirmada} não encontrada ou já processada`);
                }
                return;
            }
        }

        // === PROCESSAMENTO COM IA (LÓGICA SIMPLES IGUAL AO BOT ATACADO) ===
        const remetente = message.author || message.from;
        const resultadoIA = await ia.processarMensagemBot(message.body, remetente, 'texto', configGrupo);
        
        if (resultadoIA.erro) {
            console.error(`❌ Erro na IA:`, resultadoIA.mensagem);
            return;
        }

        if (resultadoIA.sucesso) {
            
            if (resultadoIA.tipo === 'comprovante_recebido' || resultadoIA.tipo === 'comprovante_imagem_recebido') {
                const metodoInfo = resultadoIA.metodo ? ` (${resultadoIA.metodo})` : '';
                await message.reply(
                    `✅ *Comprovante processado${metodoInfo}!*\n\n` +
                    `💰 Referência: ${resultadoIA.referencia}\n` +
                    `📊 Megas: ${resultadoIA.megas}\n\n` +
                    `📱 *Envie UM número que vai receber ${resultadoIA.megas}!*`
                );
                return;
                
            } else if (resultadoIA.tipo === 'numero_processado_com_aviso') {
                const dadosCompletos = resultadoIA.dadosCompletos;
                const [referencia, megas, numero] = dadosCompletos.split('|');
                const nomeContato = message._data.notifyName || 'N/A';
                const autorMensagem = message.author || 'Desconhecido';

                // PROCESSAR BÔNUS DE REFERÊNCIA
                const bonusInfo = await processarBonusCompra(remetente, megas);

                // VERIFICAR PAGAMENTO ANTES DE ENVIAR PARA PLANILHA
                // Usar o valor real do comprovante (não o valor calculado dos megas)
                const valorComprovante = resultadoIA.valorComprovante || megas;
                const pagamentoConfirmado = await verificarPagamentoIndividual(referencia, valorComprovante);

                if (!pagamentoConfirmado) {
                    console.log(`❌ REVENDEDORES: Pagamento não confirmado para texto - ${referencia} (${valorComprovante}MT)`);
                    await message.reply(
                        `⏳ *AGUARDANDO CONFIRMAÇÃO DO PAGAMENTO*\n\n` +
                        `💰 Referência: ${referencia}\n` +
                        `📊 Megas: ${megas} MB\n` +
                        `📱 Número: ${numero}\n` +
                        `💳 Valor: ${valorComprovante}MT\n\n` +
                        `🔍 Aguardando confirmação do pagamento no sistema...\n` +
                        `⏰ ${new Date().toLocaleString('pt-BR')}`
                    );
                    return;
                }

                console.log(`✅ REVENDEDORES: Pagamento confirmado para texto! Processando...`);

                const resultadoEnvio = await enviarParaTasker(referencia, megas, numero, message.from, autorMensagem);

                // Verificar se é pedido duplicado
                if (resultadoEnvio && resultadoEnvio.duplicado) {
                    const statusTexto = resultadoEnvio.status_existente === 'PROCESSADO' ? 'já foi processado' : 'está pendente na fila';
                    await message.reply(
                        `⚠️ *PEDIDO DUPLICADO DETECTADO*\n\n` +
                        `💰 Referência: ${referencia}\n` +
                        `📊 Megas: ${megas} MB\n` +
                        `📱 Número: ${numero}\n\n` +
                        `❌ Este pedido ${statusTexto}.\n` +
                        `📝 Status: ${resultadoEnvio.status_existente}\n\n` +
                        `⏰ ${new Date().toLocaleString('pt-BR')}`
                    );
                    return;
                }

                await registrarComprador(message.from, numero, nomeContato, megas);
                
                if (message.from === ENCAMINHAMENTO_CONFIG.grupoOrigem) {
                    const timestampMensagem = new Date().toLocaleString('pt-BR');
                    adicionarNaFila(dadosCompletos, autorMensagem, configGrupo.nome, timestampMensagem);
                }
                
                // Enviar mensagem normal + aviso da tabela
                await message.reply(
                    `✅ *Pedido Recebido!*\n\n` +
                    `💰 Referência: ${referencia}\n` +
                    `📊 Megas: ${megas} MB\n` +
                    `📱 Número: ${numero}\n\n` +
                    `${resultadoIA.avisoTabela}`
                );
                return;
                
            } else if (resultadoIA.tipo === 'numero_processado') {
                const dadosCompletos = resultadoIA.dadosCompletos;
                const [referencia, megas, numero] = dadosCompletos.split('|');
                const nomeContato = message._data.notifyName || 'N/A';
                const autorMensagem = message.author || 'Desconhecido';

                // PROCESSAR BÔNUS DE REFERÊNCIA
                const bonusInfo = await processarBonusCompra(remetente, megas);

                // VERIFICAR PAGAMENTO ANTES DE ENVIAR PARA PLANILHA
                // Usar o valor real do comprovante (não o valor calculado dos megas)
                const valorComprovante = resultadoIA.valorComprovante || megas;
                const pagamentoConfirmado = await verificarPagamentoIndividual(referencia, valorComprovante);

                if (!pagamentoConfirmado) {
                    console.log(`❌ REVENDEDORES: Pagamento não confirmado para texto - ${referencia} (${valorComprovante}MT)`);
                    await message.reply(
                        `⏳ *AGUARDANDO CONFIRMAÇÃO DO PAGAMENTO*\n\n` +
                        `💰 Referência: ${referencia}\n` +
                        `📊 Megas: ${megas} MB\n` +
                        `📱 Número: ${numero}\n` +
                        `💳 Valor: ${valorComprovante}MT\n\n` +
                        `🔍 Aguardando confirmação do pagamento no sistema...\n` +
                        `⏰ ${new Date().toLocaleString('pt-BR')}`
                    );
                    return;
                }

                console.log(`✅ REVENDEDORES: Pagamento confirmado para texto! Processando...`);

                const resultadoEnvio = await enviarParaTasker(referencia, megas, numero, message.from, autorMensagem);

                // Verificar se é pedido duplicado
                if (resultadoEnvio && resultadoEnvio.duplicado) {
                    const statusTexto = resultadoEnvio.status_existente === 'PROCESSADO' ? 'já foi processado' : 'está pendente na fila';
                    await message.reply(
                        `⚠️ *PEDIDO DUPLICADO DETECTADO*\n\n` +
                        `💰 Referência: ${referencia}\n` +
                        `📊 Megas: ${megas} MB\n` +
                        `📱 Número: ${numero}\n\n` +
                        `❌ Este pedido ${statusTexto}.\n` +
                        `📝 Status: ${resultadoEnvio.status_existente}\n\n` +
                        `⏰ ${new Date().toLocaleString('pt-BR')}`
                    );
                    return;
                }

                await registrarComprador(message.from, numero, nomeContato, megas);
                
                if (message.from === ENCAMINHAMENTO_CONFIG.grupoOrigem) {
                    const timestampMensagem = new Date().toLocaleString('pt-BR');
                    adicionarNaFila(dadosCompletos, autorMensagem, configGrupo.nome, timestampMensagem);
                }
                
                await message.reply(
                    `✅ *Pedido Recebido!*\n\n` +
                    `💰 Referência: ${referencia}\n` +
                    `📊 Megas: ${megas}\n` +
                    `📱 Número: ${numero}\n\n` +
                    `_⏳Processando... Aguarde enquanto o Sistema executa a transferência_`
                );
                return;
            }
        }

        // === TRATAMENTO DE ERROS ===
        if (resultadoIA.tipo === 'numeros_sem_comprovante') {
            await message.reply(
                `📱 *Número detectado*\n\n` +
                `❌ Não encontrei seu comprovante.\n\n` +
                `📝 Envie primeiro o comprovante de pagamento.`
            );
            return;
        }

    } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error);
    }
});

client.on('disconnected', (reason) => {
    console.log('❌ Bot desconectado:', reason);
});

// Capturar erros não tratados
process.on('unhandledRejection', (reason, promise) => {
    if (reason.message && reason.message.includes('Execution context was destroyed')) {
        console.log('⚠️ Contexto do Puppeteer reiniciado, continuando...');
    } else {
        console.error('❌ Promise rejeitada:', reason);
    }
});

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error.message);
});

// === INICIALIZAÇÃO ===
(async function inicializar() {
    console.log('🚀 Iniciando bot...');
    await carregarComandosCustomizados();
    console.log('🔧 Comandos carregados, inicializando cliente WhatsApp...');
    
    try {
        client.initialize();
        console.log('📱 Cliente WhatsApp inicializado, aguardando conexão...');
    } catch (error) {
        console.error('❌ Erro ao inicializar cliente:', error);
    }
})();

// Salvar histórico a cada 5 minutos
setInterval(salvarHistorico, 5 * 60 * 1000);

// Limpar dados antigos do Tasker a cada hora
setInterval(() => {
    if (dadosParaTasker.length > 200) {
        dadosParaTasker = dadosParaTasker.slice(-100);
        console.log('🗑️ Dados antigos do Tasker removidos');
    }
}, 60 * 60 * 1000);

// === CACHE DESNECESSÁRIO REMOVIDO ===
// Arquivos .json dos pacotes removidos para otimização
// Dados disponíveis via comandos quando necessário

// Limpar cache de grupos logados a cada 2 horas
setInterval(() => {
    gruposLogados.clear();
    console.log('🗑️ Cache de grupos detectados limpo');
}, 2 * 60 * 60 * 1000);

process.on('uncaughtException', (error) => {
    console.error('❌ Erro não capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Promise rejeitada:', reason);
});

process.on('SIGINT', async () => {
    console.log('\n💾 Salvando dados finais...');

    try {
        // Salvar apenas dados importantes (sem arquivos desnecessários)
        await Promise.allSettled([
            salvarDadosReferencia(),
            salvarHistorico()
        ]);

        console.log('✅ Dados salvos com sucesso!');
    } catch (error) {
        console.error('❌ Erro ao salvar:', error);
    }

    console.log('🧠 IA: ATIVA');
    console.log('📊 Google Sheets: CONFIGURADO');
    console.log(`🔗 URL: ${GOOGLE_SHEETS_CONFIG.scriptUrl}`);
    console.log('🤖 Bot Retalho - Funcionamento otimizado');
    console.log(ia.getStatus());
    process.exit(0);
});










