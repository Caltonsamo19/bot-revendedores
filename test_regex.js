// Teste para debugar o problema de extração de preços do SPC

const tabelaSPC = `🔥 MEGA PROMO VODACOM
━━━━━━━━━━━━━━━

PACOTES DIÁRIOS 24h
✅ 1050MB – 18MT
✅ 1200MB – 20MT
✅ 2400MB – 40MT
✅ 3600MB – 60MT
✅ 10240MB – 180MT

━━━━━━━━━━━━━━

PLANO SEMANAL (7 DIAS)
✅ 3GB – 97MT
✅ 5GB – 147MT
✅ 7GB – 196MT
✅ 10GB – 296MT`;

console.log('🧪 Testando extração de preços...');
console.log('📋 Tabela:', tabelaSPC);

const linhas = tabelaSPC.split('\n');
console.log(`📝 Total de linhas: ${linhas.length}`);

// Testar o padrão SPC específico
const padraoSPC = /✅\s*(\d+)MB\s*[–—-]\s*(\d+)MT/gi;

for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    console.log(`\n🔍 Linha ${i}: "${linha}"`);
    
    // Resetar regex
    padraoSPC.lastIndex = 0;
    const match = padraoSPC.exec(linha);
    
    if (match) {
        console.log(`   ✅ MATCH encontrado: ${match[0]}`);
        console.log(`   📊 Quantidade: ${match[1]}MB`);
        console.log(`   💰 Preço: ${match[2]}MT`);
    } else {
        console.log(`   ❌ Nenhum match`);
    }
}