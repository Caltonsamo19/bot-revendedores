require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs').promises;
const axios = require('axios'); // npm install axios

// === IMPORTAR A IA ===
const WhatsAppAI = require('./whatsapp_ai');

// === CONFIGURAÇÃO GOOGLE SHEETS - BOT RETALHO (SCRIPT PRÓPRIO) ===
const GOOGLE_SHEETS_CONFIG = {
    scriptUrl: process.env.GOOGLE_SHEETS_SCRIPT_URL_RETALHO || 'https://script.google.com/macros/s/AKfycbyMilUC5bYKGXV95LR4MmyaRHzMf6WCmXeuztpN0tDpQ9_2qkgCxMipSVqYK_Q6twZG/exec',
    planilhaUrl: 'https://docs.google.com/spreadsheets/d/1vIv1Y0Hiu6NHEG37ubbFoa_vfbEe6sAb9I4JH-P38BQ/edit',
    planilhaId: '1vIv1Y0Hiu6NHEG37ubbFoa_vfbEe6sAb9I4JH-P38BQ',
    timeout: 30000,
    retryAttempts: 3,
    retryDelay: 2000
};

console.log(`📊 Google Sheets configurado: ${GOOGLE_SHEETS_CONFIG.scriptUrl}`);

// Criar instância do cliente
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "bot_retalho_modificado" // Diferente do bot atacado
    }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

// === INICIALIZAR A IA ===
require('dotenv').config();
const ia = new WhatsAppAI(process.env.OPENAI_API_KEY);

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

// Base de dados de compradores
let historicoCompradores = {};
const ARQUIVO_HISTORICO = 'historico_compradores.json';

// Cache de administradores dos grupos
let adminCache = {};

// Cache para evitar logs repetidos de grupos
let gruposLogados = new Set();

// Configuração de administradores GLOBAIS
const ADMINISTRADORES_GLOBAIS = [
    '258874100607@c.us',
    '258871112049@c.us',
    '258845356399@c.us', 
    '258840326152@c.us', 
    '258852118624@c.us'
];

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
        tabela: `PROMOÇÃO DE 🛜ⓂEGAS✅ VODACOM A MELHOR PREÇO DO MERCADO

🛜🔥 TABELA🔥🛜

- DIÁRIOS
- 1024MB  💎 16MT💵💽
- 2048MB  💎 32MT💵💽
- 3072MB  💎 48MT💵💽
- 5120MB 💎  80MT💵💽
- 10240MB 💎  160MT💵💽

 MENSAIS
- 12.8GB 💎 250MT💵💽
- 22.8GB 💎 430MT💵💽
- 32.8GB 💎 600MT💵💽
- 52.8GB 💎 940MT💵💽
- 102.8GB 💎 1785MT💵💽

DIAMANTE SEMANAL
- CHAMADAS + SMS ILIMITADAS + 8.5GB 💎 290MT💵 

DIAMANTE MENSAL
- CHAMADAS + SMS ILIMITADAS + 12GB 💎 460MT💵
- CHAMADAS + SMS ILIMITADAS + 24GB 💎 820MT💵
- CHAMADAS + SMS ILIMITADAS + 50GB 💎 1550MT💵
- CHAMADAS + SMS ILIMITADAS + 100GB 💎 2250MT💵

NB: SO PARA VODACOM⚠⚠⚠`,

        pagamento: `FORMAS DE PAGAMENTO ATUALIZADAS
 
1- M-PESA 
NÚMERO: 848715208
NOME:  NATACHA ALICE

NÚMERO: 871112049
NOME: NATACHA ALICE`
    },

    '120363402160265624@g.us': {
        nome: 'Treinamento IA',
        tabela: `MEGA PROMO  VODACOM 
 ━━━━━━━━━━━━━━━
📅 PACOTES DIÁRIOS 📅 24h 


✅ 1G + 200MB ➔ 20MT 📶
✅ 2G + 400MB ➔ 40MT 📶
✅ 3G + 600MB 💳 60MT 
✅ 4G + 800MB  💳 80MT 
✅ 5G +1000MB 💳 100MT 
✅ 10G +240MB 💳 180MT 

 *_________________* 
💎 PACOTES MENSAIS 💎
   
📲 5G   ➔ 150MT 💳
📲 10G  ➔ 280MT 💳
📲 15G  ➔ 385MT 💳
📲 20G  ➔ 480MT 💳
━━━━━━━━━━━━━━━


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
        tabela: `___________________________
TABEL ACTUALIZADA

 ..PACOTE DIÁRIO ( 24H) 
1024MB    - 17,00 MT
2048MB   - 34,00 MT
3072MB    - 51,00 MT
5120MB     - 85,00 MT
6144MB    - 102,00 MT
10240MB  - 170,00 MT

PACOTE SEMANAL (7 Dias)
857MB - 30,00MT
1.7GB - 45,00MT
2.9GB - 95,00MT
3.4GB - 110,00MT
5.2GB - 160,00MT

PACOTE MENSAL(30 dias)
3GB    - 95,00MT
5GB     - 180,00MT
12.8GB    - 250,00MT
22.8GB   - 400,00MT
32.8GB   - 550,00MT
51.2GB   - 950,00MT
___________________________
CHAMADAS TODAS REDES + SMS + NET:
Mensal(30dias):
450MT - Ilimitado + 11.5GB.
500MT - Ilimitado + 14.5GB.
700MT - Ilimitado + 26.5GB.
1000MT - Ilimitado + 37.5GB.
1500MT - Ilimitado + 53.5GB
2150MT - Ilimitado + 102.5GB
PARA OS PACOTES MENSAIS, NÃO PODE TER TXUNA CRÉDITO.
___________________________
Serviços de Streamin
PLANOS PREMIUM

Netflix 
AMADOR - 99MT | 7 dias 
NOOB - 250MT | 30 dias 
PREMIUM - 549MT | 35 dias 
ELITE - 1499MT | 40 dias 

SPOTIFY 
AMADOR - 149MT | 30 dias
ELITE - 447MT | 3 meses 
APPLE MUSIC 

AMADOR - 199MT | 30 dias
ELITE - 597MT | 3 meses 

Temos muito mais serviço…
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
╰━━━━━━━━━━━━━━━━━━━━━  
       🚀 O futuro é agora. Vamos?`
    },
    '120363023150137820@g.us': {
    nome: 'NET VODACOM ACESSÍVEL',
    tabela: `🚨📱 INTERNET VODACOM COM OS MELHORES PREÇOS!
Mega Promoção da NET DA VODACOM ACESSÍVEL — Conecte-se já! 🚀

📅 PACOTES DIÁRIOS (24h de validade)

✅ 1GB - 17MT
✅ 2GB - 34MT
✅ 3GB - 51MT
✅ 4GB - 68MT
✅ 5GB - 85MT
✅ 6GB - 102MT
✅ 7GB - 119MT
✅ 8GB - 136MT
✅ 9GB - 153MT
✅ 10GB - 170MT


📅 PACOTES SEMANAIS 
⚠ Vai receber 100MB por dia durante 7 dias, totalizando +0.7GB

✅ 2GB – 55MT
✅ 3GB – 75MT
✅ 5GB – 130MT
✅ 10GB – 220MT



📅 PACOTES MENSAIS 
⚠ Não deve ter txuna crédito ⚠

✅ 5GB – 165MT
✅ 10GB – 280MT
✅ 20GB – 480MT
✅ 30GB – 760MT
✅ 50GB – 960MT
✅ 100GB – 1940MT
✅ 200GB – 3420MT

FORMAS DE PAGAMENTO💰💶

📌 M-PESA:  858891101
   Nome:  ISAC DA LURDES

📌 E-MOLA: 866291101
    Nome:   ISAC LURDES 

🚀 O futuro é agora! Vamos? 🔥🛒
`,
    pagamento: `FORMAS DE PAGAMENTO💰💶

📌 M-PESA:  858891101
   Nome:  ISAC DA LURDES

📌 E-MOLA: 866291101
    Nome:  ISAC LURDES 

📮 Após a transferência enviei o comprovante em forma do cópia junto com seu número.
 
> 1. 🚨Não mande comprovativo em formato de imagem 📸🚨

> 2.  🚨 Não mande valor que não têm na tabela🚨

🚀 O futuro é agora! Vamos? 🔥🛒
`
},'120363022366545020@g.us': {
        nome: 'Megas VIP',
        tabela: `🚨📢MEGABYTES DA VODACOM📢🚨

📦PACOTE DIÁRIO📦

🛜512MB = 10MT
🛜768MB = 16MT
🛜1024MB = 18MT
🛜1280MB = 26MT
🛜2048MB = 36MT
🛜3072MB = 54MT
🛜4096MB = 72MT
🛜5120MB = 90MT
🛜6144MB = 108MB
🛜7168MB = 126MB
🛜8192MB = 144MB
🛜9216MB = 162MB
🛜10240MB = 180MT

PACOTE SEMANAL🛒📦
⚠ Vai receber 100MB por dia durante 6 dias, totalizando +0.6GB. ⚠

🛜2.0GB = 65MT
🛜3.0GB = 85MT
🛜5.0GB = 130MT
🛜7.0GB = 175MT 
🛜10.0GB = 265MT
🛜14.0GB = 362MT
━━━━━━━━━━━━━━━━━━━━
🚨Para pacote MENSAL é só entrar em contato com o número abaixo 👇👇🚨

https://wa.me/258865627840?text=%20Quero%20pacote%20mensal?%20
━━━━━━━━━━━━━━━━━━━━
🚨Para pacote ILIMITADO é só entrar em contato com o número abaixo 👇👇🚨
https://wa.me/258865627840?text=%20Quero%20pacote%20ilimitado?%20
━━━━━━━━━━━━━━━━━━━━

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

📮 Após a transferência enviei o comprovante em forma do cópia junto com seu número.
 
> 1. 🚨Não mande comprovativo em formato de imagem 📸🚨

> 2.  🚨 Não mande valor que não têm na tabela🚨

🚀 O futuro é agora! Vamos? 🔥🛒
`
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
        console.log(`📊 Enviando para Google Sheets [${grupoNome}]: ${referencia}|${valor}|${numero}`);
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
        
        // Google Apps Script retorna texto simples: "Sucesso! REF|MEGAS|NUM [PENDENTE]"
        const responseText = String(response.data || '');
        console.log(`📥 Resposta Google Sheets: ${responseText}`);

        if (responseText.includes('Sucesso!')) {
            console.log(`✅ Google Sheets: Dados enviados! | Grupo: ${grupoNome}`);
            return { sucesso: true, row: 'N/A' };
        } else if (responseText.includes('Erro:')) {
            throw new Error(responseText);
        } else {
            throw new Error(`Resposta inesperada: ${responseText}`);
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
    } else {
        // Fallback para WhatsApp se Google Sheets falhar
        console.log(`🔄 [${grupoNome}] Google Sheets falhou, usando WhatsApp backup...`);
        enviarViaWhatsAppTasker(linhaCompleta, grupoNome, autorMensagem);
        dadosParaTasker[dadosParaTasker.length - 1].metodo = 'whatsapp_backup';
    }
    
    // Backup em arquivo
    await salvarArquivoTasker(linhaCompleta, grupoNome, timestamp);
    
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

async function salvarArquivoTasker(linhaCompleta, grupoNome, timestamp) {
    try {
        // Arquivo principal para Tasker (apenas a linha)
        await fs.appendFile('tasker_input.txt', linhaCompleta + '\n');
        
        // Log completo para histórico
        const logLine = `${timestamp} | ${grupoNome} | ${linhaCompleta}\n`;
        await fs.appendFile('tasker_log.txt', logLine);
        
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

function isAdministrador(numero) {
    return ADMINISTRADORES_GLOBAIS.includes(numero);
}

function isGrupoMonitorado(chatId) {
    return CONFIGURACAO_GRUPOS.hasOwnProperty(chatId);
}

function getConfiguracaoGrupo(chatId) {
    return CONFIGURACAO_GRUPOS[chatId] || null;
}

async function isAdminGrupo(chatId, participantId) {
    try {
        if (adminCache[chatId] && adminCache[chatId].timestamp > Date.now() - 300000) {
            return adminCache[chatId].admins.includes(participantId);
        }

        const chat = await client.getChatById(chatId);
        const participants = await chat.participants;
        const admins = participants.filter(p => p.isAdmin || p.isSuperAdmin).map(p => p.id._serialized);
        
        adminCache[chatId] = {
            admins: admins,
            timestamp: Date.now()
        };

        return admins.includes(participantId);
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
        console.log('📊 Histórico carregado!');
    } catch (error) {
        console.log('📊 Criando novo histórico...');
        historicoCompradores = {};
    }
}

async function salvarHistorico() {
    try {
        await fs.writeFile(ARQUIVO_HISTORICO, JSON.stringify(historicoCompradores, null, 2));
        console.log('💾 Histórico salvo!');
    } catch (error) {
        console.error('❌ Erro ao salvar histórico:', error);
    }
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

    await salvarHistorico();
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
    console.log('📱 Escaneie o QR Code:');
    qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
    console.log('✅ Bot conectado e pronto!');
    console.log('🧠 IA WhatsApp ativa!');
    console.log('📊 Google Sheets configurado!');
    console.log(`🔗 URL: ${GOOGLE_SHEETS_CONFIG.scriptUrl}`);
    console.log('🤖 Bot Retalho - Lógica simples igual ao Bot Atacado!');
    
    await carregarHistorico();
    
    console.log('\n🤖 Monitorando grupos:');
    Object.keys(CONFIGURACAO_GRUPOS).forEach(grupoId => {
        const config = CONFIGURACAO_GRUPOS[grupoId];
        console.log(`   📋 ${config.nome} (${grupoId})`);
    });
    
    console.log('\n🔧 Comandos admin: .ia .stats .sheets .test_sheets .test_grupo .grupos_status .grupos .grupo_atual');
});

client.on('group-join', async (notification) => {
    try {
        const chatId = notification.chatId;
        
        // Detectar se o bot foi adicionado
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
        }
        
        // Código original do grupo já configurado
        const configGrupo = getConfiguracaoGrupo(chatId);
        if (configGrupo) {
            console.log(`👋 Novo membro no grupo ${configGrupo.nome}`);
            
            const mensagemBoasVindas = `
🤖 *SISTEMA DE VENDA AUTOMÁTICA 24/7* 

Bem-vindo(a) ao *${configGrupo.nome}*! 

✨ *Aqui usamos sistema automático!*

🛒 *Como comprar:*
1️⃣ Faça o pagamento 
2️⃣ Envie comprovante + número
3️⃣ Receba automaticamente!

📋 Digite: *tabela* (ver preços)
💳 Digite: *pagamento* (ver formas)

⚡ *Atendimento instantâneo!*
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

            if (comando === '.stats') {
                let stats = `📊 *ESTATÍSTICAS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
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
                
                const resultado = await enviarParaGoogleSheets('TEST123', '99', '842223344', 'test_group', 'Teste Admin', 'TestUser');
                
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
                
                const resultado = await enviarParaGoogleSheets('TEST999', '88', '847777777', grupoAtual, configGrupo.nome, 'TestAdmin');
                
                if (resultado.sucesso) {
                    await message.reply(`✅ *Teste enviado para ${configGrupo.nome}!*\n\n📊 Row: ${resultado.row}\n🔍 O celular deste grupo deve processar em até 30 segundos.\n\n📱 *Grupo ID:* \`${grupoAtual}\``);
                } else {
                    await message.reply(`❌ *Erro no teste:* ${resultado.erro}`);
                }
                return;
            }

            if (comando === '.grupos_status') {
                let resposta = `📊 *STATUS DOS GRUPOS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                
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
                
                let resposta = `📊 *GOOGLE SHEETS STATUS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
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

            // === NOVOS COMANDOS PARA DETECÇÃO DE GRUPOS ===
            if (comando === '.grupos') {
                try {
                    let resposta = `📋 *GRUPOS DETECTADOS*\n━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                    
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
            console.log(`📸 Imagem recebida`);
            
            try {
                const media = await message.downloadMedia();
                
                if (!media || !media.data) {
                    throw new Error('Falha ao baixar imagem');
                }
                
                const remetente = message.author || message.from;
                const legendaImagem = message.body || null;
                
                if (legendaImagem) {
                    console.log(`📝 Legenda da imagem detectada: ${legendaImagem.substring(0, 50)}...`);
                }
                
                const resultadoIA = await ia.processarMensagemBot(media.data, remetente, 'imagem', configGrupo, legendaImagem);
                
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
                        
                        await enviarParaTasker(referencia, megas, numero, message.from, autorMensagem);
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
                `• Número que vai receber os megas\n\n` +
                `🤖 *Sistema automático 24/7!*`
            );
            return;
        }

        // === PROCESSAMENTO COM IA (LÓGICA SIMPLES IGUAL AO BOT ATACADO) ===
        const remetente = message.author || message.from;
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
                
                await enviarParaTasker(referencia, megas, numero, message.from, autorMensagem);
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

// === INICIALIZAÇÃO ===
client.initialize();

// Salvar histórico a cada 5 minutos
setInterval(salvarHistorico, 5 * 60 * 1000);

// Limpar dados antigos do Tasker a cada hora
setInterval(() => {
    if (dadosParaTasker.length > 200) {
        dadosParaTasker = dadosParaTasker.slice(-100);
        console.log('🗑️ Dados antigos do Tasker removidos');
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
        await fs.writeFile('tasker_backup_final.txt', dadosFinais);
        console.log('💾 Backup final do Tasker salvo!');
    }
    
    console.log('🧠 IA: ATIVA');
    console.log('📊 Google Sheets: CONFIGURADO');
    console.log(`🔗 URL: ${GOOGLE_SHEETS_CONFIG.scriptUrl}`);
    console.log('🤖 Bot Retalho - Funcionamento igual ao Bot Atacado');
    console.log(ia.getStatus());
    process.exit(0);
});










