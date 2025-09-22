#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');

console.log('🧹 Iniciando limpeza manual de cache...');

async function limparCache() {
    try {
        // Limpar cache do WhatsApp Web
        const cacheDir = './.wwebjs_cache';
        const authDir = './.wwebjs_auth';

        // Verificar se existem e limpar
        try {
            await fs.access(cacheDir);
            await fs.rmdir(cacheDir, { recursive: true });
            console.log('✅ Cache WhatsApp Web removido');
        } catch (error) {
            console.log('ℹ️ Cache WhatsApp Web não encontrado');
        }

        // NÃO remover .wwebjs_auth para manter sessão
        console.log('ℹ️ Dados de autenticação preservados');

        // Forçar garbage collection se disponível
        if (global.gc) {
            global.gc();
            console.log('✅ Garbage collection executado');
        }

        console.log('🎉 Limpeza de cache concluída!');
        console.log('💡 Reinicie o bot para aplicar as otimizações');

    } catch (error) {
        console.error('❌ Erro na limpeza:', error.message);
    }
}

limparCache();