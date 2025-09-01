# 📦 SISTEMA DE PACOTES AUTOMÁTICOS

## Visão Geral
Sistema completo para gerenciar pacotes de dados com renovação automática de 24h. Cada cliente pode ter pacotes de 3, 5, 15 ou 20 dias com envio automático de 100MB diário.

## 🎯 Funcionamento

### Como Funciona
1. **Cliente compra pacote**: Você cria o pacote usando comando administrativo
2. **Primeira transferência**: Sistema cria PEDIDO (100MB) + PAGAMENTO (12.5MT) nas respectivas planilhas
3. **Renovações automáticas**: Todo dia, 2h ANTES do horário anterior, cria novo PEDIDO + PAGAMENTO
4. **Controle automático**: Sistema para quando acaba os dias do pacote

### Tipos de Pacotes
- **3DIAS**: 3 transferências de 100MB (300MB total)
- **5DIAS**: 5 transferências de 100MB (500MB total)  
- **15DIAS**: 15 transferências de 100MB (1.5GB total)
- **30DIAS**: 30 transferências de 100MB (3GB total)

## 🔧 Configuração

### Arquivo .env
```env
# Sistema de Pacotes Automáticos
SISTEMA_PACOTES_ENABLED=true
VERIFICACAO_INTERVAL=3600000

# URLs das planilhas
GOOGLE_SHEETS_SCRIPT_URL_RETALHO=sua_url_pedidos_retalho  # Pedidos vão para MESMA planilha do bot retalho
GOOGLE_SHEETS_PAGAMENTOS=sua_url_pagamentos_universal     # Pagamentos vão para planilha universal
```

### Inicialização Automática
O sistema inicia automaticamente com o bot e:
- Carrega clientes ativos de `dados_pacotes_clientes.json`
- Carrega histórico de `historico_renovacoes.json`
- Inicia verificação automática (padrão: 1 hora)

## 📱 Comandos Administrativos

### Criar Pacote
```
.pacote DIAS REF NUMERO
```
**Exemplos:**
- `.pacote 3 ABC123 845123456`
- `.pacote 30 XYZ789 847654321`

### Gerenciar Pacotes
```
.pacotes_ativos      # Listar todos os clientes com pacotes ativos
.pacotes_stats       # Estatísticas detalhadas do sistema
.sistema_pacotes     # Status geral do sistema
```

### Cancelar Pacote
```
.cancelar_pacote NUMERO REFERENCIA
```
**Exemplo:** `.cancelar_pacote 845123456 ABC123`

### Integração Tasker
```
.pacotes_tasker      # Dados dos pacotes para o Tasker
.renovacoes_tasker   # Renovações pendentes para o Tasker
```

## 🔄 Fluxo Operacional

### 1. Cliente Quer Pacote
1. Cliente solicita um pacote
2. Você escolhe referência única e dias do pacote
3. Usa comando `.pacote DIAS REF NUMERO`

### 2. Sistema Processa
1. **Verifica referência única**: Confirma que não foi usada antes
2. **Cria primeiro envio**: Adiciona PEDIDO (REFD1) na planilha PEDIDOS + PAGAMENTO (REFD1) na planilha PAGAMENTOS
3. **Agenda renovações**: Programa próximos pedidos/pagamentos automáticos (REFD2, D3, etc.) 2h antes do horário no dia seguinte
4. **Confirma ativação**: Envia mensagem detalhada

### 3. Renovações Automáticas
1. **Verifica horário**: A cada hora, verifica se algum cliente precisa renovar
2. **Cria ambos**: Adiciona PEDIDO na planilha PEDIDOS + PAGAMENTO na planilha PAGAMENTOS (mesma referência)
3. **Atualiza dados**: Diminui dias restantes e calcula próxima renovação (2h antes do atual, amanhã)
4. **Para automaticamente**: Quando acabam os dias, para de renovar

## 📊 Integração com Planilhas

### Planilha de Pedidos (MESMA do bot retalho)
- **Recebe**: Pedidos normais do retalho + pedidos de pacotes automáticos
- **Formato**: `REFERENCIA|MEGAS|NUMERO|TIMESTAMP` (coluna dados)
- **Pacotes usam**: `REFD1`, `REFD2`, etc.
- **Integração**: Pedidos de pacotes aparecem junto com pedidos normais

### Planilha de Pagamentos (Universal)
- **Recebe**: Pagamentos de todos os bots (retalho + atacado + pacotes)  
- **Formato**: `REFERENCIA|VALOR_MT|NUMERO` (coluna transacao)
- **Pacotes usam**: `REFD1`, `REFD2`, etc. (mesmas referências dos pedidos)
- **Status**: PENDENTE → PROCESSADO (como pagamentos normais)

### Para o Tasker
- **Encontra pedido**: `ABC123D1|100|845123456|01/09/2025 15:00:00` na planilha (coluna dados)
- **Encontra pagamento**: `ABC123D1|12.5|845123456` na planilha (coluna transacao)
- **Processa transferência**: Como faz normalmente (pedido + pagamento = transferência)

### Vantagens da Integração Completa
- **Uma só planilha**: Tudo junto (pedidos + pagamentos + pacotes)
- **Formato idêntico**: Zero diferenciação para o Tasker
- **Referências únicas**: `REFD1`, `REFD2` evitam conflitos
- **Status comum**: PENDENTE → PROCESSADO como sempre
- **Simplicidade total**: Sem configurações extras

## 💾 Integração com Tasker

### Arquivos Gerados
- `tasker_pacotes.json`: Dados dos clientes ativos (atualizado a cada 30min)
- `tasker_renovacoes.json`: Renovações pendentes nas próximas 6h
- `dados_pacotes_clientes.json`: Backup completo dos clientes
- `historico_renovacoes.json`: Histórico de todas as renovações

### Dados Disponíveis
```json
{
  "numero": "845123456",
  "referenciaOriginal": "ABC123", 
  "tipoPacote": "15DIAS",
  "diasRestantes": 12,
  "proximaRenovacao": "2025-01-02T15:30:00.000Z",
  "status": "ativo"
}
```

## 🛠️ Resolução de Problemas

### Pacote Não Ativa
1. Verificar se pagamento existe na planilha
2. Confirmar dias válidos (3, 5, 15, 30)
3. Verificar conectividade com Google Sheets

### Renovação Não Acontece
1. Verificar se sistema está rodando (`.sistema_pacotes`)
2. Conferir se cliente ainda tem dias restantes
3. Verificar logs do console para erros

### Dados Inconsistentes  
1. Verificar arquivos JSON não estão corrompidos
2. Usar `.pacotes_stats` para ver estatísticas
3. Reiniciar bot se necessário (dados são persistidos)

## 🔍 Monitoramento

### Logs Importantes
```
📦 Sistema de Pacotes Automáticos ATIVADO
📦 X clientes ativos carregados
🔄 PACOTES: Verificando renovações...
✅ PACOTES: Renovação REF_D2 criada para 845123456
💾 Dados Tasker salvos: X pacotes, Y renovações
```

### Comandos de Debug
- `.sistema_pacotes`: Status completo
- `.pacotes_stats`: Estatísticas detalhadas  
- `.pacotes_ativos`: Lista completa de clientes
- `.renovacoes_tasker`: Próximas renovações

## 🚀 Vantagens do Sistema

1. **100% Automático**: Após ativar, não precisa intervenção manual
2. **Sincronizado**: Usa as mesmas planilhas do sistema existente
3. **Confiável**: Sistema de retry e backup em arquivos
4. **Integrado**: Funciona junto com sistema de referências
5. **Flexível**: 4 tipos de pacotes diferentes
6. **Tasker Ready**: Dados sempre atualizados para automação

## ⚠️ Importante

- **Backup**: Arquivos JSON são salvos automaticamente
- **24h Válidos**: Cada 100MB tem validade de 24h no sistema da operadora
- **2h Antecipação**: Sistema renova 2h antes para garantir continuidade
- **Planilhas**: Usa as mesmas planilhas do sistema principal
- **Verificação**: Sistema verifica a cada 1 hora por padrão