#!/usr/bin/env node

/**
 * LIMPEZA COMPLETA DE CACHE DO BOT
 * ⚠️  AVISO: Este script irá limpar TODOS os caches
 * Certifique-se de que o bot está parado antes de executar
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Cores para output
const colors = {
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    reset: '\x1b[0m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatBytes(bytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (bytes === 0) return '0 Bytes';
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
}

function getDirSize(dirPath) {
    let totalSize = 0;
    if (!fs.existsSync(dirPath)) return 0;

    try {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                totalSize += getDirSize(itemPath);
            } else {
                totalSize += stats.size;
            }
        }
    } catch (error) {
        // Ignorar erros de permissão
    }

    return totalSize;
}

function removeDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;

    const sizeBefore = getDirSize(dirPath);

    try {
        fs.rmSync(dirPath, { recursive: true, force: true });
        log(`  ✅ Removido: ${dirPath} (${formatBytes(sizeBefore)})`, 'green');
        return sizeBefore;
    } catch (error) {
        log(`  ❌ Erro ao remover ${dirPath}: ${error.message}`, 'red');
        return 0;
    }
}

function removeFile(filePath) {
    if (!fs.existsSync(filePath)) return 0;

    try {
        const stats = fs.statSync(filePath);
        const size = stats.size;
        fs.unlinkSync(filePath);
        log(`  ✅ Removido: ${filePath} (${formatBytes(size)})`, 'green');
        return size;
    } catch (error) {
        log(`  ❌ Erro ao remover ${filePath}: ${error.message}`, 'red');
        return 0;
    }
}

function cleanOldFiles(dirPath, maxAgeHours = 24) {
    if (!fs.existsSync(dirPath)) return 0;

    let removedSize = 0;
    const maxAge = maxAgeHours * 60 * 60 * 1000; // em millisegundos
    const now = Date.now();

    try {
        const items = fs.readdirSync(dirPath);
        for (const item of items) {
            const itemPath = path.join(dirPath, item);
            const stats = fs.statSync(itemPath);

            if (now - stats.mtime.getTime() > maxAge) {
                if (stats.isDirectory()) {
                    removedSize += removeDirectory(itemPath);
                } else {
                    removedSize += removeFile(itemPath);
                }
            }
        }
    } catch (error) {
        log(`  ❌ Erro ao limpar arquivos antigos em ${dirPath}: ${error.message}`, 'red');
    }

    return removedSize;
}

async function main() {
    log('🧹 === LIMPEZA COMPLETA DE CACHE DO BOT ===', 'cyan');
    log('⚠️  Certifique-se de que o bot está PARADO antes de continuar!', 'yellow');

    // Verificar se o bot está rodando
    try {
        const pm2Status = execSync('pm2 jlist', { encoding: 'utf8' });
        const processes = JSON.parse(pm2Status);
        const botProcess = processes.find(p => p.name === 'bot-revendedores');

        if (botProcess && botProcess.pm2_env.status === 'online') {
            log('❌ BOT ESTÁ RODANDO! Pare o bot primeiro com: pm2 stop bot-revendedores', 'red');
            process.exit(1);
        }
    } catch (error) {
        log('ℹ️  PM2 não encontrado ou bot não está rodando via PM2', 'blue');
    }

    let totalCleaned = 0;

    // 1. CACHE WHATSAPP
    log('\n📱 Limpando cache do WhatsApp...', 'magenta');
    totalCleaned += removeDirectory('./.wwebjs_cache');
    totalCleaned += removeDirectory('./.wwebjs_auth');
    totalCleaned += removeDirectory('./session_data');

    // 2. LOGS
    log('\n📝 Limpando logs...', 'magenta');
    totalCleaned += removeDirectory('./logs');
    totalCleaned += removeFile('./combined.log');
    totalCleaned += removeFile('./error.log');
    totalCleaned += removeFile('./out.log');

    // 3. ARQUIVOS TEMPORÁRIOS
    log('\n🗂️  Limpando arquivos temporários...', 'magenta');
    totalCleaned += removeFile('./tasker_input.txt');
    totalCleaned += removeFile('./tasker_log.txt');
    totalCleaned += cleanOldFiles('./backup_historico', 168); // 7 dias

    // 4. CACHE NODE.JS
    log('\n⚙️  Limpando cache Node.js...', 'magenta');
    try {
        // Limpar cache npm local se existir
        if (fs.existsSync('./node_modules/.cache')) {
            totalCleaned += removeDirectory('./node_modules/.cache');
        }
    } catch (error) {
        log(`  ⚠️  Erro ao limpar cache Node.js: ${error.message}`, 'yellow');
    }

    // 5. ARQUIVOS DE RANKING TEMPORÁRIOS (opcional - preservar dados importantes)
    log('\n📊 Verificando arquivos de ranking...', 'magenta');
    const rankingFiles = [
        './ranking_diario.json',
        './ranking_semanal.json',
        './ranking_diario_megas.json',
        './mensagens_ranking.json'
    ];

    for (const file of rankingFiles) {
        if (fs.existsSync(file)) {
            const stats = fs.statSync(file);
            const ageHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);

            if (ageHours > 24) { // Só remove se tem mais de 24h
                log(`  ⚠️  Arquivo de ranking antigo encontrado: ${file} (${ageHours.toFixed(1)}h)`, 'yellow');
                log(`  ℹ️  Mantendo para preservar dados. Para remover manualmente: rm ${file}`, 'blue');
            } else {
                log(`  ✅ Arquivo de ranking recente preservado: ${file}`, 'green');
            }
        }
    }

    // 6. LIMPAR CACHE DO SISTEMA (se em Linux/Mac)
    log('\n🖥️  Limpando cache do sistema...', 'magenta');
    try {
        if (process.platform === 'linux') {
            execSync('sync && echo 3 > /proc/sys/vm/drop_caches', { stdio: 'ignore' });
            log('  ✅ Cache do sistema limpo (Linux)', 'green');
        } else if (process.platform === 'darwin') {
            execSync('sudo purge', { stdio: 'ignore' });
            log('  ✅ Cache do sistema limpo (macOS)', 'green');
        } else {
            log('  ℹ️  Cache do sistema não limpo (Windows)', 'blue');
        }
    } catch (error) {
        log('  ⚠️  Não foi possível limpar cache do sistema (requer sudo)', 'yellow');
    }

    // RESUMO
    log('\n📈 === RESUMO DA LIMPEZA ===', 'cyan');
    log(`💾 Total liberado: ${formatBytes(totalCleaned)}`, 'green');

    if (totalCleaned > 0) {
        log('✅ Limpeza concluída com sucesso!', 'green');
        log('\n📋 Próximos passos:', 'blue');
        log('  1. pm2 start ecosystem.config.js', 'blue');
        log('  2. pm2 logs bot-revendedores', 'blue');
        log('  3. node performance_check.js', 'blue');
    } else {
        log('ℹ️  Nenhum cache encontrado para limpar', 'blue');
    }

    // CRIAR DIRETÓRIOS NECESSÁRIOS
    log('\n📁 Recriando diretórios necessários...', 'magenta');
    const dirsToCreate = ['./logs', './backup_historico'];

    for (const dir of dirsToCreate) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            log(`  ✅ Criado: ${dir}`, 'green');
        }
    }

    log('\n🎉 LIMPEZA COMPLETA FINALIZADA!', 'green');
}

// Executar se chamado diretamente
if (require.main === module) {
    main().catch(error => {
        log(`❌ Erro durante limpeza: ${error.message}`, 'red');
        process.exit(1);
    });
}

module.exports = { main };