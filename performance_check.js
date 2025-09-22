#!/usr/bin/env node

/**
 * Script de Monitoramento de Performance do Bot
 * Executa verificações de recursos do sistema
 */

const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

function bytesToMB(bytes) {
    return Math.round(bytes / 1024 / 1024);
}

function checkSystemResources() {
    console.log('🔍 === MONITORAMENTO DE PERFORMANCE ===\n');

    // Memória
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memUsagePercent = Math.round((usedMem / totalMem) * 100);

    console.log('💾 MEMÓRIA:');
    console.log(`   Total: ${bytesToMB(totalMem)}MB`);
    console.log(`   Usada: ${bytesToMB(usedMem)}MB (${memUsagePercent}%)`);
    console.log(`   Livre: ${bytesToMB(freeMem)}MB`);

    if (memUsagePercent > 85) {
        console.log('   ⚠️  ALERTA: Uso de memória alto!');
    } else if (bytesToMB(freeMem) < 1000) {
        console.log('   ⚠️  ALERTA: Pouca memória livre disponível!');
    } else {
        console.log('   ✅ Memória OK');
    }

    // CPU
    const cpus = os.cpus();
    const loadAvg = os.loadavg();

    console.log('\n🖥️  CPU:');
    console.log(`   Cores: ${cpus.length}`);
    console.log(`   Modelo: ${cpus[0].model}`);
    console.log(`   Load Average: ${loadAvg[0].toFixed(2)} (1min)`);

    if (loadAvg[0] > cpus.length) {
        console.log('   ⚠️  ALERTA: CPU sobrecarregada!');
    } else if (loadAvg[0] > cpus.length * 0.8) {
        console.log('   ⚠️  AVISO: CPU com uso alto');
    } else {
        console.log('   ✅ CPU OK');
    }

    // Disco
    try {
        const stats = fs.statSync('./');
        console.log('\n💿 ARMAZENAMENTO:');

        // Verificar espaço usado pelos arquivos do bot
        const nodeModulesSize = getDirSize('./node_modules') || 0;
        const cacheSize = getDirSize('./.wwebjs_cache') || 0;
        const authSize = getDirSize('./.wwebjs_auth') || 0;

        console.log(`   node_modules: ${bytesToMB(nodeModulesSize)}MB`);
        console.log(`   Cache WhatsApp: ${bytesToMB(cacheSize)}MB`);
        console.log(`   Auth data: ${bytesToMB(authSize)}MB`);
        console.log(`   Total estimado: ${bytesToMB(nodeModulesSize + cacheSize + authSize)}MB`);

        if (cacheSize > 500 * 1024 * 1024) { // > 500MB
            console.log('   ⚠️  AVISO: Cache WhatsApp grande, considere limpar');
        } else {
            console.log('   ✅ Armazenamento OK');
        }

    } catch (error) {
        console.log('\n💿 ARMAZENAMENTO: Não foi possível verificar');
    }

    // Recomendações
    console.log('\n📋 RECOMENDAÇÕES:');

    if (memUsagePercent > 85) {
        console.log('   • Aumentar RAM do servidor');
        console.log('   • Verificar vazamentos de memória');
    }

    if (loadAvg[0] > cpus.length * 0.8) {
        console.log('   • Upgrade de CPU ou adicionar cores');
        console.log('   • Verificar processos em background');
    }

    if (cpus.length < 2) {
        console.log('   • Recomendado mínimo 2 cores para o bot');
    }

    if (bytesToMB(totalMem) < 2048) {
        console.log('   • Recomendado mínimo 2GB RAM');
    }

    console.log('\n🎯 CONFIGURAÇÃO IDEAL PARA SEU BOT:');
    console.log('   • RAM: 4GB+ (atual: ' + bytesToMB(totalMem) + 'MB)');
    console.log('   • CPU: 2+ cores (atual: ' + cpus.length + ' cores)');
    console.log('   • SSD: 10GB+ livres');
    console.log('   • Conexão estável com baixa latência');
}

function getDirSize(dirPath) {
    try {
        if (!fs.existsSync(dirPath)) return 0;

        let totalSize = 0;
        const items = fs.readdirSync(dirPath);

        for (const item of items) {
            const itemPath = `${dirPath}/${item}`;
            const stats = fs.statSync(itemPath);

            if (stats.isDirectory()) {
                totalSize += getDirSize(itemPath);
            } else {
                totalSize += stats.size;
            }
        }

        return totalSize;
    } catch (error) {
        return 0;
    }
}

// Executar verificação
checkSystemResources();

// Verificação específica do processo Node.js se estiver rodando
if (process.argv.includes('--process')) {
    console.log('\n🔍 PROCESSO NODE.JS ATUAL:');
    const memUsage = process.memoryUsage();

    console.log(`   RSS: ${bytesToMB(memUsage.rss)}MB`);
    console.log(`   Heap Total: ${bytesToMB(memUsage.heapTotal)}MB`);
    console.log(`   Heap Usado: ${bytesToMB(memUsage.heapUsed)}MB`);
    console.log(`   External: ${bytesToMB(memUsage.external)}MB`);

    if (memUsage.heapUsed > 800 * 1024 * 1024) { // > 800MB
        console.log('   ⚠️  ALERTA: Uso de heap alto!');
    }
}