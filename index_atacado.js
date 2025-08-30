require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');

// Tratamento de erros não capturados
process.on('unhandledRejection', (reason, promise) => {
    console.log('❌ Promise rejeitada:', reason);
    // Não encerrar o processo, apenas logar
});

process.on('uncaughtException', (error) => {
    console.log('❌ Exceção não capturada:', error);
    // Não encerrar o processo, apenas logar
});
const qrcode = require('qrcode-terminal');
const fs = require('fs').promises;
const axios = require('axios'); // npm install axios

// === IMPORTAR A IA ATACADO ===
const WhatsAppAIAtacado = require('./whatsapp_ai_atacado');

// === IMPORTAR O BOT DE DIVISÃO ===
const WhatsAppBotDivisao = require('./whatsapp_bot_divisao');

// === CONFIGURAÇÃO GOOGLE SHEETS - BOT ATACADO (CONFIGURADA) ===
const GOOGLE_SHEETS_CONFIG_ATACADO = {
    scriptUrl: process.env.GOOGLE_SHEETS_SCRIPT_URL_ATACADO || 'https://script.google.com/macros/s/AKfycbzdvM-IrH4a6gS53WZ0J-AGXY0duHfgv15DyxdqUm1BLEm3Z15T67qgstu6yPTedgOSCA/exec',
    planilhaUrl: 'https://docs.google.com/spreadsheets/d/1ivc8gHD5WBWsvcwmK2dLBWpEHCI9J0C17Kog2NesuuE/edit',
    planilhaId: '1ivc8gHD5WBWsvcwmK2dLBWpEHCI9J0C17Kog2NesuuE',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 2000
};

// === CONFIGURAÇÃO GOOGLE SHEETS - BOT RETALHO (mantida para compatibilidade) ===
const GOOGLE_SHEETS_CONFIG = {
    scriptUrl: process.env.GOOGLE_SHEETS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz.../exec',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 2000,
    planilhaId: process.env.GOOGLE_SHEETS_ID || '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms',
    nomePlanilha: 'Dados Retalho',
    colunas: {
        timestamp: 'A',
        referencia: 'B',
        valor: 'C',
        numero: 'D',
        grupo: 'E',
        autor: 'F',
        status: 'G'
    }
};

console.log(`📊 Google Sheets configurado: ${GOOGLE_SHEETS_CONFIG_ATACADO.scriptUrl}`);

// Criar instância do cliente
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot_atacado" // Diferente do bot retalho
    }),
    puppeteer: {
        headless: false,
        timeout: 0,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-web-security',
            '--disable-features=VizDisplayCompositor',
            '--disable-extensions',
            '--disable-plugins'
        ],
        ignoreDefaultArgs: ['--disable-extensions'],
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false
    }
});

// === INICIALIZAR A IA ===
require('dotenv').config();
const ia = new WhatsAppAIAtacado(process.env.OPENAI_API_KEY);

// === INICIALIZAR O BOT DE DIVISÃO ===
const botDivisao = new WhatsAppBotDivisao();

// Configuração para encaminhamento
const ENCAMINHAMENTO_CONFIG = {
    grupoOrigem: '120363402160265624@g.us', // Grupo de atacado
    numeroDestino: '258861645968@c.us',
    intervaloSegundos: 2
};

// Fila de mensagens para encaminhar
let filaMensagens = [];
let processandoFila = false;

// === VARIÁVEIS PARA DADOS ===
let dadosParaTasker = [];

// Base de dados de compradores
let historicoCompradores = {};
const ARQUIVO_HISTORICO = 'historico_compradores_atacado.json';

// Cache de administradores dos grupos
let adminCache = {};

// Cache para evitar logs repetidos de grupos
let gruposLogados = new Set();

// Sistema de comandos personalizados por grupo
let comandosPersonalizados = {
    // Estrutura: { grupoId: { comando: { criador, resposta, timestamp } } }
};

// Configuração de administradores GLOBAIS
const ADMINISTRADORES_GLOBAIS = [
    '258861645968@c.us',
    '258871112049@c.us', 
    '258852118624@c.us',
    '23450974470333@lid'  // Calton Samo - ID interno WhatsApp
];

// === CONFIGURAÇÃO DE MODERAÇÃO ===
const MODERACAO_CONFIG = {
    ativado: {
        '120363402160265624@g.us': true
    },
    detectarLinks: true,
    apagarMensagem: true,
    removerUsuario: false,
    excecoes: [
        '258861645968@c.us',
        '258871112049@c.us', 
        '258852118624@c.us'
    ]
};

// === CONFIGURAÇÃO DOS GRUPOS PARA O BOT DE DIVISÃO ===
// Esta configuração deve estar sincronizada com CONFIGURACAO_GRUPOS
const CONFIGURACAO_GRUPOS_DIVISAO = {
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
        }
    },
    '120363402160265624@g.us': {
        nome: 'Treinamento IA',
        precos: {
            10240: 130,    // 10GB = 130MT
            20480: 260,    // 20GB = 260MT
            30720: 390,    // 30GB = 390MT
            40960: 520,    // 40GB = 520MT
            51200: 630,    // 50GB = 630MT
            61440: 750,    // 60GB = 750MT
            71680: 875,    // 70GB = 875MT
            81920: 1000    // 80GB = 1000MT
        }
    }
    // Only Saldo foi removido pois não precisa de divisão automática
};

// Atualizar a configuração do bot de divisão
botDivisao.CONFIGURACAO_GRUPOS = CONFIGURACAO_GRUPOS_DIVISAO;

// Configuração para cada grupo (ATACADO)
const CONFIGURACAO_GRUPOS = {
    '120363419652375064@g.us': {
        nome: 'Net Fornecedor V',
        // CORREÇÃO: Adicionar preços estruturados para cálculo correto de megas
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
        tabela: `GB'S COMPLETOS
📱 10GB➜125MT 
📱 20GB ➜ 250MT  
📱 30GB ➜ 375MT  
📱 40GB ➜ 500MT  
📱 50GB ➜ 625MT  
📱 60GB ➜ 750MT  
📱 70GB ➜ 875MT  
📱 80GB ➜ 1000MT  
📱 90GB ➜ 1125MT  
📱 100GB➜1250MT

📞 1 Comprovante = 1 Número = Valor Completo`,

        pagamento: `FORMAS DE PAGAMENTO
 
M-PESA❤: 840326152 
E-MOLA🧡: 870059057 
NOME: Vasco José Mahumane 

📝 Após a transferência, mande:
1️⃣ Comprovativo 
2️⃣ UM número que vai receber`
    },
    '120363419741642342@g.us': {
        nome: 'Only Saldo',
        tabela: `SALDO PROMO 1K🟰815📞
    
 📞 50      💫 45     MT
 📞 100    💫 85     MT
📞 200     💫 170   MT
📞 300     💫 255   MT
📞 400     💫 340   MT
📞 500     💫 410   MT 
📞 1000   💫 815   MT
📞 2000   💫 1630 MT
📞 3000   💫 2445 MT
📞 4000   💫 3260 MT
📞 5000   💫 4075 MT
📞 6000   💫 4890 MT
📞 7000   💫 5705 MT
📞 8000   💫 6520 MT
📞 9000   💫 7335 MT
📞 10000 💫 8150 MT

📩 Após o envio do valor, mande o compravativo no grupo e o respectivo número beneficiário.`,

        pagamento: `FORMAS DE PAGAMENTO
 
M-PESA❤: 840326152 
E-MOLA🧡: 870059057 
NOME: Vasco José Mahumane 

📝 Após a transferência, mande:
1️⃣ Comprovativo 
2️⃣ UM número que vai receber`
    },
    '120363402160265624@g.us': {
        nome: 'Treinamento IA',
        tabela: `🚨PROMOÇÃO DE GIGABYTES🚨
MAIS DE 40 GIGABYTES 12.5
Oferecemos-lhe serviços extremamente rápido e seguro.🥳
🛜📶 TABELA NORMAL🌐
♨ GB's🛜 COMPLETOS🔥
🌐 10GB  🔰   130MT💳
🌐 20GB  🔰   260MT💳
🌐 30GB  🔰   390MT💳
🌐 40GB  🔰   520MT💳

PACOTE VIP 12.5 24H
🌐 50GB  🔰   630MT💳
🌐 60GB  🔰   750MT💳
🌐 70GB  🔰   875MT💳
🌐 80GB  🔰 1000MT💳

SINTAM-SE AVONTADE, EXPLOREM-NOS ENQUANTO PUDEREM!`,

        pagamento: `FORMAS DE PAGAMENTO
 
M-PESA❤: 840326152 
E-MOLA🧡: 870059057 
NOME: Vasco José Mahumane 

📝 Após a transferência, mande:
1️⃣ Comprovativo 
2️⃣ UM número que vai receber`
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

// === FUNÇÃO GOOGLE SHEETS SIMPLIFICADA ===
async function enviarParaGoogleSheets(dadosCompletos, grupoId, timestamp) {
    const dados = {
        grupo_id: grupoId,
        timestamp: timestamp,
        dados: dadosCompletos  // REF|MEGAS|NUMERO|TIMESTAMP como string única
    };
    
    try {
        console.log(`📊 Enviando para Google Sheets SIMPLIFICADO: ${dadosCompletos}`);
        console.log(`📍 Grupo: ${grupoId}`);
        console.log(`⏰ Timestamp: ${timestamp}`);
        
        const response = await axios.post(GOOGLE_SHEETS_CONFIG_ATACADO.scriptUrl, dados, {
            timeout: GOOGLE_SHEETS_CONFIG_ATACADO.timeout,
            headers: {
                'Content-Type': 'application/json',
                'X-Bot-Source': 'WhatsApp-Bot-Atacado-Simplificado'
            },
            validateStatus: function (status) {
                return status < 500;
            }
        });
        
        if (response.data && response.data.success) {
            console.log(`✅ Google Sheets: Dados enviados! Row: ${response.data.row}`);
            console.log(`📋 Dados inseridos: ${response.data.dados}`);
            return { sucesso: true, row: response.data.row };
        } else {
            throw new Error(response.data?.error || 'Resposta inválida');
        }
        
    } catch (error) {
        console.error(`❌ Erro Google Sheets: ${error.message}`);
        return { sucesso: false, erro: error.message };
    }
}

// === FUNÇÃO PRINCIPAL PARA TASKER ===
async function enviarParaTasker(referencia, megas, numero, grupoId) {
    const timestamp = new Date().toLocaleString('pt-BR', {
        year: 'numeric',
        month: '2-digit', 
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    
    // CRIAR STRING COM TIMESTAMP NO FINAL
    const dadosCompletos = `${referencia}|${megas}|${numero}|${timestamp}`;
    
    const grupoNome = getConfiguracaoGrupo(grupoId)?.nome || 'Desconhecido';
    
    console.log(`📊 ENVIANDO DADOS SIMPLIFICADOS:`);
    console.log(`   📋 Dados: ${dadosCompletos}`);
    console.log(`   📍 Grupo: ${grupoNome} (${grupoId})`);
    console.log(`   ⏰ Timestamp: ${timestamp}`);
    
    // Armazenar localmente (backup)
    dadosParaTasker.push({
        dados: dadosCompletos,
        grupo_id: grupoId,
        grupo: grupoNome,
        timestamp: timestamp,
        enviado: false,
        metodo: 'pendente'
    });
    
    // === ENVIAR PARA GOOGLE SHEETS ===
    const resultado = await enviarParaGoogleSheets(dadosCompletos, grupoId, timestamp);
    
    if (resultado.sucesso) {
        dadosParaTasker[dadosParaTasker.length - 1].enviado = true;
        dadosParaTasker[dadosParaTasker.length - 1].metodo = 'google_sheets';
        dadosParaTasker[dadosParaTasker.length - 1].row = resultado.row;
        console.log(`✅ [${grupoNome}] Enviado para Google Sheets! Row: ${resultado.row}`);
    } else {
        console.log(`🔄 [${grupoNome}] Google Sheets falhou, usando WhatsApp backup...`);
        enviarViaWhatsAppTasker(dadosCompletos, grupoNome);
        dadosParaTasker[dadosParaTasker.length - 1].metodo = 'whatsapp_backup';
    }
    
    await salvarArquivoTasker(dadosCompletos, grupoNome, timestamp);
    
    if (dadosParaTasker.length > 100) {
        dadosParaTasker = dadosParaTasker.slice(-100);
    }
    
    return dadosCompletos;
}

// === FUNÇÃO AUXILIAR PARA CÁLCULO DE MEGAS ===
// Esta função deve ser implementada na classe WhatsAppAIAtacado
// Por enquanto, mantemos apenas a estrutura básica

// === FUNÇÃO PARA CONVERTER MEGAS ===
function converterMegasParaNumero(megas) {
    if (typeof megas === 'string') {
        // Remover espaços e converter para maiúsculas
        const megasLimpo = megas.trim().toUpperCase();
        
        // Padrões de conversão
        const padroes = [
            { regex: /(\d+(?:\.\d+)?)\s*GB?/i, multiplicador: 1024 },
            { regex: /(\d+(?:\.\d+)?)\s*MB?/i, multiplicador: 1 },
            { regex: /(\d+(?:\.\d+)?)\s*KB?/i, multiplicador: 1/1024 },
            { regex: /(\d+(?:\.\d+)?)\s*TB?/i, multiplicador: 1024 * 1024 }
        ];
        
        for (const padrao of padroes) {
            const match = megasLimpo.match(padrao.regex);
            if (match) {
                const numero = parseFloat(match[1]);
                const resultado = Math.round(numero * padrao.multiplicador);
                console.log(`🔄 Conversão: ${megas} → ${resultado} MB`);
                return resultado.toString();
            }
        }
        
        // Se não encontrar padrão, tentar extrair apenas números
        const apenasNumeros = megasLimpo.replace(/[^\d.]/g, '');
        if (apenasNumeros) {
            console.log(`🔄 Conversão direta: ${megas} → ${apenasNumeros} MB`);
            return apenasNumeros;
        }
    }
    
    // Se não conseguir converter, retornar o valor original
    console.log(`⚠️ Não foi possível converter: ${megas}`);
    return megas;
}

function enviarViaWhatsAppTasker(linhaCompleta, grupoNome, autorMensagem) {
    const item = {
        conteudo: linhaCompleta,
        autor: autorMensagem,
        grupo: grupoNome,
        timestamp: Date.now(),
        id: Date.now() + Math.random(),
        tipo: 'tasker_data_backup_atacado'
    };

    filaMensagens.push(item);
    console.log(`📱 WhatsApp Backup → Tasker: ${linhaCompleta}`);

    if (!processandoFila) {
        processarFila();
    }
}

async function salvarArquivoTasker(linhaCompleta, grupoNome, timestamp) {
    try {
        // Arquivo principal para Tasker (apenas a linha)
        await fs.appendFile('tasker_input_atacado.txt', linhaCompleta + '\n');
        
        // Log completo para histórico
        const logLine = `${timestamp} | ${grupoNome} | ${linhaCompleta}\n`;
        await fs.appendFile('tasker_log_atacado.txt', logLine);
        
        console.log(`📁 Arquivo → Backup: ${linhaCompleta}`);
        
    } catch (error) {
        console.error('❌ Erro ao salvar arquivo Tasker:', error);
    }
}

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

// === FUNÇÃO PARA EXTRAIR NÚMERO REAL DO USUÁRIO ===
function extrairNumeroReal(message) {
    // 1. Tentar pegar do notifyName se for número
    if (message._data && message._data.notifyName && /^8\d{8}$/.test(message._data.notifyName)) {
        return `258${message._data.notifyName}@c.us`;
    }
    
    // 2. Tentar extrair do author
    if (message.author) {
        const match = message.author.match(/258(\d{9})@c\.us/);
        if (match) {
            return message.author;
        }
        
        // Se for ID interno, tentar extrair número do contato
        if (message.author.includes('@lid')) {
            // Buscar número no contato
            if (message._data && message._data.notifyName && /^8\d{8}$/.test(message._data.notifyName)) {
                return `258${message._data.notifyName}@c.us`;
            }
        }
    }
    
    // 3. Fallback para o author original
    return message.author || message.from;
}

function isAdministrador(numero) {
    // Verificar direto na lista (inclui IDs internos agora)
    if (ADMINISTRADORES_GLOBAIS.includes(numero)) {
        return true;
    }
    
    // Tentar extrair apenas os dígitos do número para números tradicionais
    const digitos = numero.replace(/\D/g, '');
    if (digitos.length >= 9) {
        const numeroLimpo = digitos.slice(-9); // Pegar últimos 9 dígitos
        const numeroCompleto = `258${numeroLimpo}@c.us`;
        return ADMINISTRADORES_GLOBAIS.includes(numeroCompleto);
    }
    
    return false;
}

function isGrupoMonitorado(chatId) {
    return CONFIGURACAO_GRUPOS.hasOwnProperty(chatId);
}

// === SISTEMA DE COMANDOS PERSONALIZADOS ===

// Salvar comandos personalizados em arquivo
function salvarComandosPersonalizados() {
    try {
        const fs = require('fs');
        const dados = JSON.stringify(comandosPersonalizados, null, 2);
        fs.writeFileSync('comandos_personalizados.json', dados);
        console.log('💾 Comandos personalizados salvos');
    } catch (error) {
        console.error('❌ Erro ao salvar comandos personalizados:', error);
    }
}

// Carregar comandos personalizados do arquivo
function carregarComandosPersonalizados() {
    try {
        const fs = require('fs');
        if (fs.existsSync('comandos_personalizados.json')) {
            const dados = fs.readFileSync('comandos_personalizados.json', 'utf8');
            comandosPersonalizados = JSON.parse(dados);
            const totalComandos = Object.values(comandosPersonalizados)
                .reduce((total, grupo) => total + Object.keys(grupo).length, 0);
            console.log(`📋 ${totalComandos} comandos personalizados carregados`);
        }
    } catch (error) {
        console.error('❌ Erro ao carregar comandos personalizados:', error);
        comandosPersonalizados = {};
    }
}

// Adicionar comando personalizado
function adicionarComandoPersonalizado(grupoId, comando, resposta, criadorId, criadorNome) {
    if (!comandosPersonalizados[grupoId]) {
        comandosPersonalizados[grupoId] = {};
    }
    
    comandosPersonalizados[grupoId][comando] = {
        resposta: resposta,
        criador: criadorId,
        criadorNome: criadorNome,
        timestamp: Date.now(),
        usos: 0
    };
    
    salvarComandosPersonalizados();
    console.log(`✅ Comando personalizado criado: ${comando} no grupo ${grupoId} por ${criadorNome}`);
}

// Remover comando personalizado
function removerComandoPersonalizado(grupoId, comando) {
    if (comandosPersonalizados[grupoId] && comandosPersonalizados[grupoId][comando]) {
        delete comandosPersonalizados[grupoId][comando];
        
        // Se não há mais comandos no grupo, remover o grupo
        if (Object.keys(comandosPersonalizados[grupoId]).length === 0) {
            delete comandosPersonalizados[grupoId];
        }
        
        salvarComandosPersonalizados();
        console.log(`🗑️ Comando personalizado removido: ${comando}`);
        return true;
    }
    return false;
}

// Verificar se existe comando personalizado
function existeComandoPersonalizado(grupoId, comando) {
    return comandosPersonalizados[grupoId] && comandosPersonalizados[grupoId][comando];
}

// Executar comando personalizado
function executarComandoPersonalizado(grupoId, comando) {
    if (existeComandoPersonalizado(grupoId, comando)) {
        const cmd = comandosPersonalizados[grupoId][comando];
        cmd.usos++;
        salvarComandosPersonalizados();
        return cmd.resposta;
    }
    return null;
}

// Listar comandos personalizados do grupo
function listarComandosPersonalizados(grupoId) {
    if (!comandosPersonalizados[grupoId]) {
        return null;
    }
    
    const comandos = comandosPersonalizados[grupoId];
    let lista = `📋 *COMANDOS PERSONALIZADOS DO GRUPO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
    
    Object.entries(comandos).forEach(([cmd, data]) => {
        const data_criacao = new Date(data.timestamp).toLocaleDateString('pt-BR');
        lista += `🔹 **${cmd}**\n`;
        lista += `   👤 Criado por: ${data.criadorNome}\n`;
        lista += `   📅 Data: ${data_criacao}\n`;
        lista += `   📊 Usos: ${data.usos}\n`;
        lista += `   💬 Prévia: "${data.resposta.substring(0, 50)}${data.resposta.length > 50 ? '...' : ''}"\n\n`;
    });
    
    lista += `📊 Total: ${Object.keys(comandos).length} comandos`;
    return lista;
}

function getConfiguracaoGrupo(chatId) {
    return CONFIGURACAO_GRUPOS[chatId] || null;
}

async function isAdminGrupo(chatId, participantId) {
    try {
        console.log(`🔍 Verificando admin do grupo: ${participantId} no grupo ${chatId}`);
        
        // Normalizar IDs para comparação
        function normalizarIds(ids, participantIdOriginal) {
            const normalized = new Set();
            
            ids.forEach(id => {
                normalized.add(id); // ID original
                
                // Se for ID @lid, tentar extrair número equivalente @c.us
                if (id.includes('@lid')) {
                    // Manter ID interno como está, pois pode não ter equivalente direto
                    normalized.add(id);
                } else if (id.includes('@c.us')) {
                    normalized.add(id);
                    // Extrair apenas os dígitos para comparação flexível
                    const digitos = id.replace(/\D/g, '');
                    if (digitos.length >= 11) {
                        normalized.add(digitos);
                        normalized.add(digitos.substring(3)); // sem código do país
                    }
                }
            });
            
            // Também normalizar o participantId para busca
            normalized.add(participantIdOriginal);
            if (participantIdOriginal.includes('@c.us') || participantIdOriginal.includes('@lid')) {
                normalized.add(participantIdOriginal);
                const digitos = participantIdOriginal.replace(/\D/g, '');
                if (digitos.length >= 9) {
                    normalized.add(digitos);
                    normalized.add(`258${digitos}@c.us`);
                }
            }
            
            return Array.from(normalized);
        }
        
        // Verificar cache (5 minutos)
        if (adminCache[chatId] && adminCache[chatId].timestamp > Date.now() - 300000) {
            console.log(`📋 Usando cache de admins para grupo ${chatId}`);
            
            // Verificação com normalização de IDs
            const todosIds = normalizarIds(adminCache[chatId].admins, participantId);
            const isAdmin = todosIds.some(id => adminCache[chatId].admins.includes(id)) || 
                           adminCache[chatId].admins.some(adminId => todosIds.includes(adminId));
            
            console.log(`   Cache resultado: ${isAdmin}`);
            console.log(`   Admins no cache: ${adminCache[chatId].admins.join(', ')}`);
            console.log(`   IDs normalizados para busca: ${todosIds.join(', ')}`);
            return isAdmin;
        }

        console.log(`🔄 Buscando admins do grupo ${chatId} (cache expirado ou inexistente)`);
        const chat = await client.getChatById(chatId);
        const participants = await chat.participants;
        
        console.log(`👥 Total de participantes: ${participants.length}`);
        
        // Buscar admins com diferentes formatos de ID
        const admins = [];
        participants.forEach(p => {
            if (p.isAdmin || p.isSuperAdmin) {
                const adminId = p.id._serialized;
                admins.push(adminId);
                console.log(`👨‍💼 Admin encontrado: ${adminId} (${p.isAdmin ? 'Admin' : 'Super Admin'})`);
            }
        });
        
        console.log(`🔒 Total de admins encontrados: ${admins.length}`);
        console.log(`📝 Lista de admins: ${admins.join(', ')}`);
        
        // Salvar no cache
        adminCache[chatId] = {
            admins: admins,
            timestamp: Date.now()
        };

        // Verificação com normalização de IDs
        const todosIds = normalizarIds(admins, participantId);
        const isAdmin = todosIds.some(id => admins.includes(id)) || 
                       admins.some(adminId => todosIds.includes(adminId));
        
        console.log(`🎯 Participante verificado: ${participantId}`);
        console.log(`🎯 IDs normalizados: ${todosIds.join(', ')}`);
        console.log(`🎯 Resultado final: ${isAdmin}`);
        
        return isAdmin;
        
    } catch (error) {
        console.error('❌ Erro ao verificar admin do grupo:', error);
        return false;
    }
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
        console.log('📊 Histórico atacado carregado!');
    } catch (error) {
        console.log('📊 Criando novo histórico atacado...');
        historicoCompradores = {};
    }
}

async function salvarHistorico() {
    try {
        await fs.writeFile(ARQUIVO_HISTORICO, JSON.stringify(historicoCompradores, null, 2));
        console.log('💾 Histórico atacado salvo!');
    } catch (error) {
        console.error('❌ Erro ao salvar histórico:', error);
    }
}

async function registrarComprador(grupoId, numeroComprador, nomeContato, megas) {
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
        megas: megas
    });

    if (historicoCompradores[grupoId].compradores[numeroComprador].historico.length > 10) {
        historicoCompradores[grupoId].compradores[numeroComprador].historico =
            historicoCompradores[grupoId].compradores[numeroComprador].historico.slice(-10);
    }

    await salvarHistorico();
    console.log(`💰 Comprador atacado registrado: ${nomeContato} (${numeroComprador}) - ${megas}`);
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
    console.log('📱 BOT ATACADO - Escaneie o QR Code:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ Bot ATACADO conectado e pronto!');
    console.log('🧠 IA WhatsApp ATACADO ativa!');
    console.log('📦 Sistema inteligente: Cálculo automático de megas!');
    console.log('📊 Google Sheets ATACADO configurado!');
    console.log('🔄 Bot de Divisão ATIVO - Múltiplos números automático!');
    console.log(`🔗 URL: ${GOOGLE_SHEETS_CONFIG_ATACADO.scriptUrl}`);
    
    // Carregar comandos personalizados
    carregarComandosPersonalizados();
    
    await carregarHistorico();
    
    console.log('\n🤖 Monitorando grupos ATACADO:');
    Object.keys(CONFIGURACAO_GRUPOS).forEach(grupoId => {
        const config = CONFIGURACAO_GRUPOS[grupoId];
        console.log(`   📋 ${config.nome} (${grupoId})`);
    });
    
    console.log('\n🔧 Comandos admin globais: .ia .stats .sheets .test_sheets .test_grupo .grupos_status .grupos .grupo_atual');
    console.log('🔧 Comandos admin de grupo: .f (fechar) .a (abrir) .atenção (mencionar todos) .silencio (ultra-discreto)');
    console.log('🔧 Comandos personalizados: .addcmd (criar) .delcmd (remover) .listcmd (listar)');
});

client.on('group-join', async (notification) => {
    try {
        const chatId = notification.chatId;
        
        // Detectar se o bot foi adicionado
        const addedParticipants = notification.recipientIds || [];
        const botInfo = client.info;
        
        if (botInfo && addedParticipants.includes(botInfo.wid._serialized)) {
            console.log(`\n🤖 BOT ATACADO ADICIONADO A UM NOVO GRUPO!`);
            await logGrupoInfo(chatId, 'BOT ATACADO ADICIONADO');
            
            setTimeout(async () => {
                try {
                    const isMonitorado = CONFIGURACAO_GRUPOS.hasOwnProperty(chatId);
                    const mensagem = isMonitorado ? 
                        `🤖 *BOT ATACADO ATIVO E CONFIGURADO!*\n\nEste grupo está monitorado e o sistema automático já está funcionando.\n\n📋 Digite: *tabela* (ver preços)\n💳 Digite: *pagamento* (ver formas)\n\n⚠️ *ATACADO: Cálculo automático de megas*` :
                        `🤖 *BOT ATACADO CONECTADO!*\n\n⚙️ Este grupo ainda não está configurado.\n🔧 Contacte o administrador para ativação.\n\n📝 ID do grupo copiado no console do servidor.`;
                    
                    await client.sendMessage(chatId, mensagem);
                    console.log(`✅ Mensagem de status enviada`);
                } catch (error) {
                    console.error('❌ Erro ao enviar mensagem de status:', error);
                }
            }, 3000);
        }
        
        // Código original do grupo já configurado
        const configGrupo = getConfiguracaoGrupo(chatId);
        if (configGrupo) {
            console.log(`👋 Novo membro no grupo ${configGrupo.nome}`);
            
            const mensagemBoasVindas = `
�� *SISTEMA ATACADO - CÁLCULO AUTOMÁTICO DE MEGAS* 

Bem-vindo(a) ao *${configGrupo.nome}*! 

✨ *Aqui usamos sistema atacado inteligente!*

🛒 *Como comprar:*
1️⃣ Faça o pagamento 
2️⃣ Envie comprovante + UM número
3️⃣ Sistema calcula megas automaticamente!
4️⃣ Receba megas no número!

📋 Digite: *tabela* (ver preços)
💳 Digite: *pagamento* (ver formas)

⚡ *Cálculo automático baseado na tabela!*
            `;
            
            setTimeout(async () => {
                try {
                    await client.sendMessage(chatId, mensagemBoasVindas);
                    console.log(`✅ Mensagem de boas-vindas enviada`);
                } catch (error) {
                    console.error('❌ Erro ao enviar boas-vindas:', error);
                }
            }, 2000);
        }
    } catch (error) {
        console.error('❌ Erro no evento group-join:', error);
    }
});

client.on('message', async (message) => {
    try {
        const isPrivado = !message.from.endsWith('@g.us');
        const isAdmin = isAdministrador(message.from);

        // === COMANDOS ADMINISTRATIVOS ===
        if (isAdmin) {
            const comando = message.body.toLowerCase().trim();

            if (comando === '.ia') {
                const statusIA = ia.getStatusDetalhado();
                await message.reply(statusIA);
                console.log(`🧠 Comando .ia executado`);
                return;
            }

            // NOVO COMANDO: Status do bot de divisão
            if (comando === '.divisao') {
                const status = botDivisao.getStatus();
                const resposta = `🔄 *BOT DE DIVISÃO STATUS*\n` +
                    `━━━━━━━━━━━━━━━━━━━━━━━\n\n` +
                    `💾 Comprovativos memorizados: ${status.comprovantesMemorizados}\n` +
                    `⚡ Divisões em processamento: ${status.processandoDivisoes}\n` +
                    `🏢 Grupos configurados: ${status.gruposConfigurados}\n\n` +
                    `✅ Sistema ativo e funcionando!`;
                
                await message.reply(resposta);
                return;
            }
            
            // NOVO COMANDO: Testar busca de pagamento
            if (comando.startsWith('.test_busca ')) {
                const parametros = comando.replace('.test_busca ', '').split(' ');
                if (parametros.length >= 2) {
                    const referencia = parametros[0];
                    const valor = parseFloat(parametros[1]);
                    
                    console.log(`🧪 Testando busca: ${referencia} - ${valor}MT`);
                    
                    const resultado = await botDivisao.buscarPagamentoNaPlanilha(referencia, valor);
                    
                    const resposta = resultado ? 
                        `✅ *PAGAMENTO ENCONTRADO*\n\n🔍 Referência: ${referencia}\n💰 Valor: ${valor}MT` :
                        `❌ *PAGAMENTO NÃO ENCONTRADO*\n\n🔍 Referência: ${referencia}\n💰 Valor: ${valor}MT`;
                    
                    await message.reply(resposta);
                } else {
                    await message.reply('❌ Uso: .test_busca REFERENCIA VALOR\nExemplo: .test_busca CHP4H5DMI1S 375');
                }
                return;
            }

            if (comando === '.stats') {
                let stats = `📊 *ESTATÍSTICAS ATACADO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
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

            // === COMANDOS GOOGLE SHEETS ===
            if (comando === '.test_sheets') {
                console.log(`🧪 Testando Google Sheets...`);
                
                const resultado = await enviarParaGoogleSheets('TEST123|1250|842223344|' + new Date().toLocaleString('pt-BR'), 'test_group', new Date().toLocaleString('pt-BR'));
                
                if (resultado.sucesso) {
                    await message.reply(`✅ *Google Sheets funcionando!*\n\n📊 URL: ${GOOGLE_SHEETS_CONFIG.scriptUrl}\n📝 Row: ${resultado.row}\n🎉 Dados enviados com sucesso!`);
                } else {
                    await message.reply(`❌ *Google Sheets com problema!*\n\n📊 URL: ${GOOGLE_SHEETS_CONFIG.scriptUrl}\n⚠️ Erro: ${resultado.erro}\n\n🔧 *Verifique:*\n• Script publicado corretamente\n• Permissões do Google Sheets\n• Internet funcionando`);
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
                
                const resultado = await enviarParaGoogleSheets('TEST999|1250|847777777|' + new Date().toLocaleString('pt-BR'), grupoAtual, new Date().toLocaleString('pt-BR'));
                
                if (resultado.sucesso) {
                    await message.reply(`✅ *Teste enviado para ${configGrupo.nome}!*\n\n📊 Row: ${resultado.row}\n🔍 O celular deste grupo deve processar em até 30 segundos.\n\n📱 *Grupo ID:* \`${grupoAtual}\``);
                } else {
                    await message.reply(`❌ *Erro no teste:* ${resultado.erro}`);
                }
                return;
            }

            if (comando === '.grupos_status') {
                let resposta = `📊 *STATUS DOS GRUPOS ATACADO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
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
                
                let resposta = `📊 *GOOGLE SHEETS STATUS ATACADO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
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
                await message.reply('🗑️ *Dados do Google Sheets atacado limpos!*');
                return;
            }

            // === COMANDOS PARA DETECÇÃO DE GRUPOS ===
            if (comando === '.grupos') {
                try {
                    let resposta = `📋 *GRUPOS DETECTADOS ATACADO*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    
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
                    `📋 *INFORMAÇÕES DESTE GRUPO ATACADO*\n\n` +
                    `🆔 ID: \`${message.from}\`\n` +
                    `📊 Status: ${status}\n\n` +
                    `${configGrupo ? `🏢 Nome: ${configGrupo.nome}` : '🔧 Precisa ser configurado'}\n\n` +
                    `📝 Verifique o console para detalhes completos`
                );
                return;
            }
        }

        // === COMANDOS ADMINISTRATIVOS DE GRUPO ===
        if (message.from.endsWith('@g.us')) {
            const autorMensagem = message.author || message.from;
            const isAdminGlobal = isAdministrador(autorMensagem);
            const isAdminDoGrupo = await isAdminGrupo(message.from, autorMensagem);
            
            console.log(`🔍 ADMIN CHECK: Usuário ${autorMensagem} no grupo ${message.from}`);
            console.log(`   🌍 Admin Global: ${isAdminGlobal} (verificando: ${autorMensagem})`);
            console.log(`   🏢 Admin do Grupo: ${isAdminDoGrupo}`);
            
            // Só admins globais OU admins do grupo podem usar estes comandos
            if (isAdminGlobal || isAdminDoGrupo) {
                const comando = message.body.toLowerCase().trim();
                
                // COMANDO: .f (Fechar grupo)
                if (comando === '.f') {
                    try {
                        const chat = await client.getChatById(message.from);
                        await chat.setMessagesAdminsOnly(true);
                        console.log(`🔒 Grupo ${chat.name} fechado por admin`);
                        await message.reply('🔒 *GRUPO FECHADO*\n\nApenas administradores podem enviar mensagens.');
                    } catch (error) {
                        console.error('❌ Erro ao fechar grupo:', error);
                        await message.reply('❌ *Erro ao fechar grupo*\n\nVerifique se o bot tem permissões de administrador.');
                    }
                    return;
                }
                
                // COMANDO: .a (Abrir grupo)
                if (comando === '.a') {
                    try {
                        const chat = await client.getChatById(message.from);
                        await chat.setMessagesAdminsOnly(false);
                        console.log(`🔓 Grupo ${chat.name} aberto por admin`);
                        await message.reply('🔓 *GRUPO ABERTO*\n\nTodos os membros podem enviar mensagens.');
                    } catch (error) {
                        console.error('❌ Erro ao abrir grupo:', error);
                        await message.reply('❌ *Erro ao abrir grupo*\n\nVerifique se o bot tem permissões de administrador.');
                    }
                    return;
                }
                
                // COMANDO: .atenção (Mencionar todos)
                if (comando === '.atenção' || comando === '.atencao') {
                    try {
                        const chat = await client.getChatById(message.from);
                        const participants = await chat.participants;
                        
                        // Primeiro, apagar a mensagem do comando discretamente
                        try {
                            await message.delete(true);
                            console.log(`🗑️ Mensagem do comando .atenção apagada discretamente`);
                        } catch (deleteError) {
                            console.log(`⚠️ Não foi possível apagar a mensagem do comando (pode não ter permissão)`);
                        }
                        
                        // Criar lista de menções
                        let mencoes = [];
                        let textoMencoes = '';
                        
                        for (const participant of participants) {
                            // Não mencionar o próprio bot
                            if (participant.id._serialized !== client.info.wid._serialized) {
                                mencoes.push(participant.id._serialized);
                                const nome = participant.pushname || participant.id.user;
                                textoMencoes += `@${nome} `;
                            }
                        }
                        
                        const mensagemAtencao = `🚨 *ATENÇÃO GERAL* 🚨\n\n${textoMencoes}\n\n📢 Mensagem importante para todos os membros do grupo!`;
                        
                        // Enviar mensagem mencionando todos
                        const mensagemEnviada = await chat.sendMessage(mensagemAtencao, {
                            mentions: mencoes
                        });
                        
                        console.log(`📢 Comando .atenção executado no grupo ${chat.name} - ${participants.length} membros mencionados`);
                        
                        // Opcional: Apagar a mensagem de menção após alguns segundos
                        setTimeout(async () => {
                            try {
                                await mensagemEnviada.delete(true);
                                console.log(`🗑️ Mensagem de menção apagada após 10 segundos`);
                            } catch (autoDeleteError) {
                                console.log(`⚠️ Não foi possível auto-apagar a mensagem de menção`);
                            }
                        }, 10000); // 10 segundos
                        
                    } catch (error) {
                        console.error('❌ Erro ao executar comando atenção:', error);
                        await message.reply('❌ *Erro ao mencionar membros*\n\nVerifique se o bot tem permissões adequadas.');
                    }
                    return;
                }
                
                // COMANDO: .addcmd (Criar comando personalizado)
                if (comando.startsWith('.addcmd ')) {
                    try {
                        const args = message.body.substring(8).trim(); // Remove ".addcmd "
                        const partes = args.split(' ');
                        
                        if (partes.length < 2) {
                            await message.reply('❌ *Formato incorreto*\n\nUso: `.addcmd nome_comando resposta completa`\n\nExemplo: `.addcmd regras As regras do grupo são: 1) Respeito 2) Sem spam`');
                            return;
                        }
                        
                        const nomeComando = partes[0].toLowerCase();
                        const resposta = partes.slice(1).join(' ');
                        
                        // Verificar se não conflita com comandos do sistema
                        const comandosSistema = ['.f', '.a', '.atenção', '.atencao', '.silencio', '.silêncio', '.addcmd', '.delcmd', '.listcmd', '.meunum'];
                        if (comandosSistema.includes(nomeComando)) {
                            await message.reply(`❌ *Comando reservado*\n\nO comando "${nomeComando}" é reservado do sistema.\n\nEscolha outro nome.`);
                            return;
                        }
                        
                        const autorMensagem = message.author || message.from;
                        const nomeAutor = message._data?.notifyName || 'Admin';
                        
                        adicionarComandoPersonalizado(message.from, nomeComando, resposta, autorMensagem, nomeAutor);
                        
                        await message.reply(`✅ *Comando criado com sucesso!*\n\n🔹 **Comando:** ${nomeComando}\n👤 **Criado por:** ${nomeAutor}\n💬 **Resposta:** ${resposta.substring(0, 100)}${resposta.length > 100 ? '...' : ''}\n\n💡 Use \`${nomeComando}\` para executar`);
                        
                    } catch (error) {
                        console.error('❌ Erro ao criar comando personalizado:', error);
                        await message.reply('❌ *Erro ao criar comando*\n\nTente novamente.');
                    }
                    return;
                }
                
                // COMANDO: .delcmd (Remover comando personalizado)
                if (comando.startsWith('.delcmd ')) {
                    try {
                        const nomeComando = message.body.substring(8).trim().toLowerCase();
                        
                        if (!nomeComando) {
                            await message.reply('❌ *Nome do comando necessário*\n\nUso: `.delcmd nome_comando`\n\nExemplo: `.delcmd regras`');
                            return;
                        }
                        
                        if (removerComandoPersonalizado(message.from, nomeComando)) {
                            await message.reply(`✅ *Comando removido*\n\nO comando "${nomeComando}" foi removido do grupo.`);
                        } else {
                            await message.reply(`❌ *Comando não encontrado*\n\nO comando "${nomeComando}" não existe neste grupo.\n\nUse \`.listcmd\` para ver comandos disponíveis.`);
                        }
                        
                    } catch (error) {
                        console.error('❌ Erro ao remover comando personalizado:', error);
                        await message.reply('❌ *Erro ao remover comando*\n\nTente novamente.');
                    }
                    return;
                }
                
                // COMANDO: .listcmd (Listar comandos personalizados)
                if (comando === '.listcmd') {
                    try {
                        const lista = listarComandosPersonalizados(message.from);
                        
                        if (lista) {
                            await message.reply(lista);
                        } else {
                            await message.reply('📋 *Nenhum comando personalizado*\n\nEste grupo ainda não possui comandos personalizados.\n\n💡 Crie um com: `.addcmd nome_comando resposta`');
                        }
                        
                    } catch (error) {
                        console.error('❌ Erro ao listar comandos personalizados:', error);
                        await message.reply('❌ *Erro ao listar comandos*\n\nTente novamente.');
                    }
                    return;
                }

                // COMANDO: .silencio (Mencionar todos de forma ultra-discreta)
                if (comando === '.silencio' || comando === '.silêncio') {
                    try {
                        const chat = await client.getChatById(message.from);
                        const participants = await chat.participants;
                        
                        // Apagar a mensagem do comando imediatamente
                        try {
                            await message.delete(true);
                        } catch (deleteError) {
                            console.log(`⚠️ Não foi possível apagar comando .silencio`);
                        }
                        
                        // Criar lista de menções (sem texto visível)
                        let mencoes = [];
                        
                        for (const participant of participants) {
                            // Não mencionar o próprio bot
                            if (participant.id._serialized !== client.info.wid._serialized) {
                                mencoes.push(participant.id._serialized);
                            }
                        }
                        
                        // Mensagem mínima apenas com menções invisíveis
                        const mensagemSilenciosa = `📢`; // Apenas um emoji
                        
                        // Enviar e apagar rapidamente (3 segundos)
                        const mensagemEnviada = await chat.sendMessage(mensagemSilenciosa, {
                            mentions: mencoes
                        });
                        
                        console.log(`🤫 Comando .silencio executado - ${participants.length} membros notificados discretamente`);
                        
                        // Apagar a mensagem após 3 segundos
                        setTimeout(async () => {
                            try {
                                await mensagemEnviada.delete(true);
                                console.log(`🗑️ Mensagem silenciosa apagada`);
                            } catch (autoDeleteError) {
                                console.log(`⚠️ Não foi possível auto-apagar mensagem silenciosa`);
                            }
                        }, 3000); // 3 segundos apenas
                        
                    } catch (error) {
                        console.error('❌ Erro ao executar comando silencio:', error);
                    }
                    return;
                }
            } else {
                // COMANDO TEMPORÁRIO PARA DESCOBRIR O NÚMERO DO USUÁRIO
                const comando = message.body.toLowerCase().trim();
                if (comando === '.meunum') {
                    const autorMensagem = message.author || message.from;
                    const isAdmin = isAdministrador(autorMensagem);
                    
                    await message.reply(`📱 *INFORMAÇÕES DO USUÁRIO:*\n\n` +
                        `🆔 ID WhatsApp: \`${autorMensagem}\`\n` +
                        `👤 Admin Status: ${isAdmin ? '✅ É ADMIN' : '❌ NÃO É ADMIN'}\n` +
                        `📋 Nome/Contato: ${message._data?.notifyName || 'N/A'}\n\n` +
                        `📋 Lista de admins: ${ADMINISTRADORES_GLOBAIS.join(', ')}`);
                    
                    console.log(`📱 DEBUG USUÁRIO SIMPLES:`);
                    console.log(`   ID WhatsApp: ${autorMensagem}`);
                    console.log(`   É Admin: ${isAdmin}`);
                    return;
                }
                
                // Verificar se tentou usar comando admin sem ser admin
                const comandosAdmin = ['.f', '.a', '.atenção', '.atencao', '.silencio', '.silêncio', '.addcmd', '.delcmd', '.listcmd'];
                
                if (comandosAdmin.includes(comando)) {
                    const autorMensagem = message.author || message.from;
                    await message.reply(`🚫 *ACESSO NEGADO*\n\nApenas administradores podem usar este comando.\n\n📱 Seu número: \`${autorMensagem}\`\n💡 Digite \`.meunum\` para ver seu número completo.`);
                    return;
                }
            }
        }

        // === VERIFICAR COMANDOS PERSONALIZADOS ===
        if (message.from.endsWith('@g.us') && message.body.startsWith('.')) {
            const comando = message.body.toLowerCase().trim();
            const respostaPersonalizada = executarComandoPersonalizado(message.from, comando);
            
            if (respostaPersonalizada) {
                await message.reply(respostaPersonalizada);
                console.log(`🔹 Comando personalizado executado: ${comando} no grupo ${message.from}`);
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

        // ============================================================================
        // NOVA LÓGICA: BOT DE DIVISÃO TEM PRIORIDADE ABSOLUTA
        // Processa ANTES da IA para aplicar filtros inteligentes
        // ============================================================================
        
        const remetente = message.author || message.from;
        const resultadoDivisao = await botDivisao.processarMensagem(message, remetente, message.from);
        
        if (resultadoDivisao) {
            console.log('🔄 DIVISÃO: Mensagem processada pelo bot de divisão');
            
            // Se o bot de divisão retornou uma resposta, enviar
            if (resultadoDivisao.resposta) {
                await message.reply(resultadoDivisao.resposta);
            }
            
            // Se foi processado com sucesso, não continuar para o bot original
            if (resultadoDivisao.processado) {
                console.log(`✅ DIVISÃO: ${resultadoDivisao.sucessos}/${resultadoDivisao.total} pedidos criados`);
                return; // IMPORTANTE: Sair aqui, não processar no bot original
            }
            
            // Se retornou uma resposta mas não foi processado, também sair
            if (resultadoDivisao.resposta) {
                return;
            }
        }

        // === MODERAÇÃO ===
        if (message.type === 'chat') {
            const analise = contemConteudoSuspeito(message.body);
            
            if (analise.suspeito) {
                console.log(`🚨 Conteúdo suspeito detectado`);
                await aplicarModeracao(message, "Link detectado");
                return;
            }
        }

        // === PROCESSAMENTO DE IMAGENS ===
        if (message.type === 'image') {
            console.log(`�� Imagem recebida`);
            
            try {
                const media = await message.downloadMedia();
                
                if (!media || !media.data) {
                    throw new Error('Falha ao baixar imagem');
                }
                
                const legendaImagem = message.body || null;
                
                if (legendaImagem) {
                    console.log(`📝 Legenda da imagem detectada: ${legendaImagem.substring(0, 50)}...`);
                }
                
                const resultadoIA = await ia.processarMensagemBot(media.data, remetente, 'imagem', configGrupo, legendaImagem);
                
                // === VERIFICAÇÃO ESPECIAL: SE A IA DETECTOU MÚLTIPLOS NÚMEROS ===
                if (resultadoIA.tipo === 'multiplos_numeros_nao_permitido') {
                    console.log('🔄 IA detectou múltiplos números em imagem, redirecionando para bot de divisão...');
                    
                    // Criar mensagem simulada com os números detectados
                    const mensagemNumeros = resultadoIA.numeros.join('\n');
                    const messageSimulada = {
                        body: mensagemNumeros,
                        reply: message.reply.bind(message)
                    };
                    
                    const resultadoDivisaoImagem = await botDivisao.processarMensagem(
                        messageSimulada, 
                        remetente, 
                        message.from
                    );
                    
                    if (resultadoDivisaoImagem && resultadoDivisaoImagem.resposta) {
                        await message.reply(resultadoDivisaoImagem.resposta);
                    }
                    
                    return;
                }
                
                if (resultadoIA.sucesso) {
                    
                    if (resultadoIA.tipo === 'comprovante_imagem_recebido') {
                        await message.reply(
                            `✅ *Comprovante da imagem processado!*\n\n` +
                            `💰 Referência: ${resultadoIA.referencia}\n` +
                            `📊 Megas: ${resultadoIA.megas}\n\n` +
                            `📱 *Agora envie UM número que vai receber ${resultadoIA.megas}!*`
                        );
                        return;
                        
                    } else if (resultadoIA.tipo === 'numero_processado') {
                        const dadosCompletos = resultadoIA.dadosCompletos;
                        const [referencia, megas, numero] = dadosCompletos.split('|');
                        const nomeContato = message._data.notifyName || 'N/A';
                        const autorMensagem = message.author || 'Desconhecido';
                        
                        // Converter megas para formato numérico
                        const megasConvertido = converterMegasParaNumero(megas);
                        
                        await enviarParaTasker(referencia, megasConvertido, numero, message.from);
                        await registrarComprador(message.from, numero, nomeContato, resultadoIA.valorPago || megas);
                        
                        if (message.from === ENCAMINHAMENTO_CONFIG.grupoOrigem) {
                            const timestampMensagem = new Date().toLocaleString('pt-BR');
                            adicionarNaFila(dadosCompletos, autorMensagem, configGrupo.nome, timestampMensagem);
                        }
                        
                        await message.reply(
                            `✅ *Screenshot + Número processados!*\n\n` +
                            `💰 Referência: ${referencia}\n` +
                            `📊 Megas: ${megas}\n` +
                            `📱 Número: ${numero}\n\n` +
                            `⏳ *Aguarde uns instantes enquanto o sistema executa a transferência*`
                        );
                        return;
                    }
                } else {
                    await message.reply(
                        `❌ *Não consegui processar o comprovante da imagem!*\n\n` +
                        `📝 Envie o comprovante como texto.`
                    );
                }
                
            } catch (error) {
                console.error('❌ Erro ao processar imagem:', error);
                await message.reply(`❌ *Erro ao processar imagem!* Envie como texto.`);
            }
            
            return;
        }

        if (message.type !== 'chat') {
            return;
        }

        // Comandos de tabela e pagamento
        if (/tabela/i.test(message.body)) {
            await message.reply(configGrupo.tabela);
            return;
        }

        if (/pagamento/i.test(message.body)) {
            await message.reply(configGrupo.pagamento);
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
                `• UM número que vai receber\n\n` +
                `🤖 *Sistema atacado - valor integral!*`
            );
            return;
        }

        // === PROCESSAMENTO COM IA ===
        const resultadoIA = await ia.processarMensagemBot(message.body, remetente, 'texto', configGrupo);
        
        if (resultadoIA.erro) {
            console.error(`❌ Erro na IA:`, resultadoIA.mensagem);
            return;
        }

        if (resultadoIA.sucesso) {
            
            if (resultadoIA.tipo === 'comprovante_recebido') {
                await message.reply(
                    `✅ *Comprovante processado!*\n\n` +
                    `💰 Referência: ${resultadoIA.referencia}\n` +
                    `📊 Megas: ${resultadoIA.megas}\n\n` +
                    `📱 *Envie UM número que vai receber ${resultadoIA.megas}!*`
                );
                return;
                
            } else if (resultadoIA.tipo === 'numero_processado') {
                const dadosCompletos = resultadoIA.dadosCompletos;
                const [referencia, megas, numero] = dadosCompletos.split('|');
                const nomeContato = message._data.notifyName || 'N/A';
                const autorMensagem = message.author || 'Desconhecido';
                
                // Converter megas para formato numérico
                const megasConvertido = converterMegasParaNumero(megas);
                
                await enviarParaTasker(referencia, megasConvertido, numero, message.from);
                await registrarComprador(message.from, numero, nomeContato, resultadoIA.valorPago || megas);
                
                if (message.from === ENCAMINHAMENTO_CONFIG.grupoOrigem) {
                    const timestampMensagem = new Date().toLocaleString('pt-BR');
                    adicionarNaFila(dadosCompletos, autorMensagem, configGrupo.nome, timestampMensagem);
                }
                
                await message.reply(
                    `✅ *Pedido processado!*\n\n` +
                    `💰 Referência: ${referencia}\n` +
                    `📊 Megas: ${megas}\n` +
                    `📱 Número: ${numero}\n\n` +
                    `⏳ *Aguarde uns instantes enquanto o sistema executa a transferência*`
                );
                return;
            }
        }

        // === TRATAMENTO DE ERROS/CASOS ESPECIAIS ===
        if (resultadoIA.tipo === 'numero_sem_comprovante') {
            await message.reply(
                `📱 *Número detectado*\n\n` +
                `❌ Não encontrei seu comprovante.\n\n` +
                `📝 Envie primeiro o comprovante de pagamento.`
            );
            return;
            
        } else if (resultadoIA.tipo === 'multiplos_numeros_nao_permitido') {
            console.log('🔄 IA detectou múltiplos números, redirecionando para bot de divisão...');
            
            const resultadoDivisaoTexto = await botDivisao.processarMensagem(
                message, 
                remetente, 
                message.from
            );
            
            if (resultadoDivisaoTexto && resultadoDivisaoTexto.resposta) {
                await message.reply(resultadoDivisaoTexto.resposta);
            } else {
                // Fallback para a mensagem original se o bot de divisão não processar
                await message.reply(
                    `📱 *${resultadoIA.numeros.length} números detectados*\n\n` +
                    `❌ Sistema atacado aceita apenas UM número por vez.\n\n` +
                    `📝 Envie apenas um número para receber o valor integral.`
                );
            }
            
            return;
        }

    } catch (error) {
        console.error('❌ Erro ao processar mensagem:', error);
    }
});

client.on('disconnected', (reason) => {
    console.log('❌ Bot atacado desconectado:', reason);
});

// === INICIALIZAÇÃO ===
client.initialize();

// Salvar histórico a cada 5 minutos
setInterval(salvarHistorico, 5 * 60 * 1000);

// Limpar dados antigos do Tasker a cada hora
setInterval(() => {
    if (dadosParaTasker.length > 200) {
        dadosParaTasker = dadosParaTasker.slice(-100);
        console.log('🗑️ Dados antigos do Tasker atacado removidos');
    }
}, 60 * 60 * 1000);

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
    console.log('\n💾 Salvando antes de sair...');
    await salvarHistorico();
    
    // Salvar dados finais do Tasker
    if (dadosParaTasker.length > 0) {
        const dadosFinais = dadosParaTasker.map(d => d.dados).join('\n');
        await fs.writeFile('tasker_backup_final_atacado.txt', dadosFinais);
        console.log('💾 Backup final do Tasker atacado salvo!');
    }
    
    console.log('🧠 IA: ATIVA');
    console.log('📦 Sistema atacado: CÁLCULO AUTOMÁTICO DE MEGAS');
    console.log('📊 Google Sheets ATACADO: CONFIGURADO');
    console.log(`🔗 URL: ${GOOGLE_SHEETS_CONFIG_ATACADO.scriptUrl}`);
    console.log(ia.getStatus());
    process.exit(0);

});


